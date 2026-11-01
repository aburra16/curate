// @vitest-environment jsdom
/**
 * Signing with a remote signer: a pasted bunker link, a pairing code a phone
 * answers, and the session kept for the browser session until disconnect.
 */
import { NostrConnectSigner, PrivateKeySigner } from "applesauce-signers";
import { parseNostrConnectURI } from "applesauce-signers/helpers/nostr-connect";
import { nip19, verifyEvent } from "nostr-tools";
import { generateSecretKey } from "nostr-tools/pure";
import { bytesToHex } from "nostr-tools/utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventTemplate } from "@/lib/conceptCopy";
import { clearOutboxCache } from "@/services/outbox";
import { signAndPublish } from "@/services/publish";
import {
  connectBunker,
  NIP46_RELAYS,
  PAIRING_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  restoreRemote,
  SESSION_KEY,
  SIGNED_KINDS,
  startPairing,
} from "@/services/remoteSigner";
import { activeSigner, disconnect, SignerError, signTemplate } from "@/services/signer";
import { setTransport } from "@/services/transport";
import { fakeBunker } from "@/test/fakeBunker";
import { fakeTransport } from "@/test/fakeTransport";

const CURATOR_KEY = generateSecretKey();
const CURATOR = new PrivateKeySigner(CURATOR_KEY);
const OTHER = new PrivateKeySigner(generateSecretKey());

const VOTE: EventTemplate = { kind: 7, content: "+", tags: [["e", "e".repeat(64)]] };

/** The error a call ends in, failing the test when it doesn't fail. */
async function failure(call: Promise<unknown>): Promise<SignerError> {
  try {
    await call;
  } catch (err) {
    expect(err).toBeInstanceOf(SignerError);
    return err as SignerError;
  }
  throw new Error("expected the call to fail");
}

/** The session the page keeps, parsed; null when there is none. */
function keptSession(): Record<string, unknown> | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
}

/** Whether a promise has settled once everything already queued has run. Needs fake timers. */
async function hasSettled(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  await vi.advanceTimersByTimeAsync(0);
  return settled;
}

afterEach(async () => {
  vi.useRealTimers();
  await disconnect();
  sessionStorage.clear();
});

describe("connectBunker", () => {
  it("connects from a pasted bunker link and signs through it", async () => {
    const bunker = fakeBunker(CURATOR);

    const pubkey = await connectBunker(bunker.bunkerUri(), bunker.methods);
    const event = await signTemplate(VOTE);

    expect(pubkey).toBe(await CURATOR.getPublicKey());
    expect(activeSigner()).toEqual({ method: "remote", pubkey });
    expect(event).toMatchObject({ kind: 7, content: "+", pubkey });
    expect(verifyEvent(event)).toBe(true);
    expect(bunker.requests).toEqual(["connect", "get_public_key", "sign_event"]);
  });

  it("refuses a link that isn't a bunker:// link, and asks nobody", async () => {
    const bunker = fakeBunker(CURATOR);
    const npub = nip19.npubEncode(await CURATOR.getPublicKey());

    const err = await failure(connectBunker(`nostr:${npub}`, bunker.methods));

    expect(err.message).toBe("That isn't a bunker:// link.");
    expect(bunker.requests).toEqual([]);
    expect(activeSigner()).toBeNull();
    expect(keptSession()).toBeNull();
  });

  it("gives up on a bunker that never answers, and keeps nothing", async () => {
    const bunker = fakeBunker(CURATOR);
    bunker.silence();
    vi.useFakeTimers();

    const connecting = connectBunker(bunker.bunkerUri(), bunker.methods);
    const outcome = failure(connecting);
    expect(await hasSettled(connecting)).toBe(false);
    await vi.advanceTimersByTimeAsync(PAIRING_TIMEOUT_MS);

    expect((await outcome).reason).toBe("timeout");
    expect(bunker.requests).toEqual(["connect"]);
    expect(activeSigner()).toBeNull();
    expect(keptSession()).toBeNull();
  });
});

describe("startPairing", () => {
  it("pairs with the signer that answers the code, and signs as its account", async () => {
    const bunker = fakeBunker(CURATOR);

    const { uri, done } = startPairing(bunker.methods);
    bunker.pair(uri);
    const pubkey = await done;

    expect(uri.startsWith("nostrconnect://")).toBe(true);
    expect(pubkey).toBe(await CURATOR.getPublicKey());
    expect(activeSigner()).toEqual({ method: "remote", pubkey });
    expect((await signTemplate(VOTE)).pubkey).toBe(pubkey);
    expect(bunker.requests).toEqual(["get_public_key", "sign_event"]);
  });

  it("names Curate, the page, the relays to answer on, and the kinds it will ask to sign", () => {
    const bunker = fakeBunker(CURATOR);

    const { uri, cancel } = startPairing(bunker.methods);
    cancel();

    expect(parseNostrConnectURI(uri)).toMatchObject({
      relays: NIP46_RELAYS,
      metadata: {
        name: "Curate",
        url: location.origin,
        permissions: ["get_public_key", ...SIGNED_KINDS.map((kind) => `sign_event:${kind}`)],
      },
    });
  });

  it("turns away an answer that doesn't carry the code's secret", async () => {
    const bunker = fakeBunker(CURATOR);
    vi.useFakeTimers();

    const { uri, done, cancel } = startPairing(bunker.methods);
    bunker.pair(uri, "ack");

    expect(await hasSettled(done)).toBe(false);
    expect(bunker.requests).toEqual([]);
    cancel();
    await failure(done);
    expect(activeSigner()).toBeNull();
  });

  it("stops when cancelled, connecting nobody", async () => {
    const bunker = fakeBunker(CURATOR);

    const { uri, done, cancel } = startPairing(bunker.methods);
    cancel();
    bunker.pair(uri);

    expect((await failure(done)).reason).toBe("not-connected");
    expect(activeSigner()).toBeNull();
    expect(keptSession()).toBeNull();
  });

  it("gives up when no signer answers in time", async () => {
    const bunker = fakeBunker(CURATOR);
    vi.useFakeTimers();

    const { done } = startPairing(bunker.methods);
    const outcome = failure(done);
    await vi.advanceTimersByTimeAsync(PAIRING_TIMEOUT_MS - 1);
    expect(await hasSettled(done)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect((await outcome).reason).toBe("timeout");
    expect(activeSigner()).toBeNull();
  });

  it("does nothing when cancelled after it paired", async () => {
    const bunker = fakeBunker(CURATOR);
    const { uri, done, cancel } = startPairing(bunker.methods);
    bunker.pair(uri);
    const pubkey = await done;

    cancel();

    expect(activeSigner()).toEqual({ method: "remote", pubkey });
    expect((await signTemplate(VOTE)).pubkey).toBe(pubkey);
    expect(bunker.requests).toEqual(["get_public_key", "sign_event"]);
  });
});

describe("the session", () => {
  it("keeps exactly the client key, the bunker, its relays and the account", async () => {
    const bunker = fakeBunker(CURATOR);
    const { remote, relays } = NostrConnectSigner.parseBunkerURI(bunker.bunkerUri());

    const pubkey = await connectBunker(bunker.bunkerUri(), bunker.methods);
    const session = keptSession();

    expect(Object.keys(session ?? {}).sort()).toEqual(["clientKey", "pubkey", "relays", "remote"]);
    expect(session).toMatchObject({ remote, relays, pubkey });
    expect(session?.clientKey).toMatch(/^[0-9a-f]{64}$/);
    expect(session?.clientKey).not.toBe(bytesToHex(CURATOR_KEY));
  });

  it("keeps the pairing relays for a paired signer", async () => {
    const bunker = fakeBunker(CURATOR);
    const { uri, done } = startPairing(bunker.methods);
    bunker.pair(uri);

    await done;

    expect(keptSession()?.relays).toEqual(NIP46_RELAYS);
  });

  it("is restored after a reload, and the first signature asks to sign without connecting again", async () => {
    const bunker = fakeBunker(CURATOR);
    const pubkey = await connectBunker(bunker.bunkerUri(), bunker.methods);
    const kept = sessionStorage.getItem(SESSION_KEY) ?? "";
    // A reload empties the page's memory, and the browser session keeps the pairing.
    await disconnect();
    sessionStorage.setItem(SESSION_KEY, kept);
    const before = bunker.requests.length;

    expect(await restoreRemote(bunker.methods)).toBe(pubkey);
    expect(activeSigner()).toEqual({ method: "remote", pubkey });
    expect((await signTemplate(VOTE)).pubkey).toBe(pubkey);
    expect(bunker.requests.slice(before)).toEqual(["sign_event"]);
    expect(sessionStorage.getItem(SESSION_KEY)).toBe(kept);
  });

  it("restores nothing when there is no session", async () => {
    const bunker = fakeBunker(CURATOR);

    expect(await restoreRemote(bunker.methods)).toBeNull();
    expect(activeSigner()).toBeNull();
  });

  it("forgets a session it can't read, and restores nothing", async () => {
    const bunker = fakeBunker(CURATOR);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ clientKey: "not a key" }));

    expect(await restoreRemote(bunker.methods)).toBeNull();
    expect(keptSession()).toBeNull();
  });

  it("is forgotten on disconnect", async () => {
    const bunker = fakeBunker(CURATOR);
    await connectBunker(bunker.bunkerUri(), bunker.methods);

    await disconnect();

    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(activeSigner()).toBeNull();
  });
});

describe("signing with a remote signer", () => {
  it("gives up on a silent signer after REQUEST_TIMEOUT_MS, and publishes nothing", async () => {
    const bunker = fakeBunker(CURATOR);
    await connectBunker(bunker.bunkerUri(), bunker.methods);
    const transport = fakeTransport({});
    setTransport(transport);
    clearOutboxCache();
    bunker.silence();
    vi.useFakeTimers();

    const write = signAndPublish(VOTE);
    const outcome = failure(write);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(await hasSettled(write)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect((await outcome).reason).toBe("timeout");
    expect(bunker.requests.at(-1)).toBe("sign_event");
    expect(transport.published).toEqual({});
  });

  it("refuses a signature from another account", async () => {
    // The signer app says it holds the curator's account, then signs with another key.
    const twoFaced = new PrivateKeySigner(CURATOR_KEY);
    twoFaced.signEvent = (template) => OTHER.signEvent(template);
    const bunker = fakeBunker(twoFaced);
    await connectBunker(bunker.bunkerUri(), bunker.methods);

    const err = await failure(signTemplate(VOTE));

    expect(err.reason).toBe("account-changed");
  });
});
