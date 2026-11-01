// @vitest-environment jsdom
/**
 * Signing with a remote signer: a pasted bunker link, a pairing code a phone
 * answers, and the session kept for the browser session until disconnect.
 */
import { nip44 as libraryNip44 } from "applesauce-core/helpers/encryption";
import type { PublishResponse } from "applesauce-relay";
import { NostrConnectSigner, PrivateKeySigner, type ISigner } from "applesauce-signers";
import { parseNostrConnectURI } from "applesauce-signers/helpers/nostr-connect";
import { nip19, verifyEvent, type Filter, type NostrEvent } from "nostr-tools";
import { generateSecretKey } from "nostr-tools/pure";
import { bytesToHex } from "nostr-tools/utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventTemplate } from "@/lib/conceptCopy";
import { clearOutboxCache } from "@/services/outbox";
import { signAndPublish } from "@/services/publish";
import {
  connectBunker,
  NIP46_RELAYS,
  onRemoteAuth,
  PAIRING_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  restoreRemote,
  SESSION_KEY,
  SIGNED_KINDS,
  startPairing,
} from "@/services/remoteSigner";
import { activate, activeSigner, connectExtension, disconnect, SignerError, signTemplate } from "@/services/signer";
import { setTransport } from "@/services/transport";
import { fakeBunker, type FakeBunker } from "@/test/fakeBunker";
import { fakeTransport } from "@/test/fakeTransport";

// The page's relay pool, which a test reaches only by setting `pool.current`.
const pool = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/nostr/ndk", () => ({
  getPool: () => {
    if (!pool.current) throw new Error("this test has no relay pool");
    return pool.current;
  },
}));

const CURATOR_KEY = generateSecretKey();
const CURATOR = new PrivateKeySigner(CURATOR_KEY);
const OTHER = new PrivateKeySigner(generateSecretKey());

const VOTE: EventTemplate = { kind: 7, content: "+", tags: [["e", "e".repeat(64)]] };

/** A relay that takes nothing and never answers. */
const SILENT_RELAY = "wss://silent.example.test";

const APPROVAL_LINK = "https://signer.example.test/approve?request=1";

type Page = { nostr?: unknown };

/**
 * The parts of the relay pool a remote signer can use, carrying the bunker's
 * traffic. A publish to `SILENT_RELAY` never answers; like the real pool's,
 * `publish` to several relays waits for every one of them.
 */
function poolReaching(bunker: FakeBunker) {
  const publishTo = (url: string, event: NostrEvent): Promise<PublishResponse> =>
    url === SILENT_RELAY
      ? new Promise<never>(() => {})
      : Promise.resolve(bunker.methods.publishMethod([url], event)).then(() => ({ ok: true, from: url }));
  return {
    subscription: (relays: string[], filters: Filter[]) => bunker.methods.subscriptionMethod(relays, filters),
    publish: (relays: string[], event: NostrEvent) => Promise.all(relays.map((url) => publishTo(url, event))),
    relay: (url: string) => ({ publish: (event: NostrEvent) => publishTo(url, event) }),
  };
}

/** A signer extension on the page, signing as `account`. */
function installExtension(account: ISigner): void {
  (window as unknown as Page).nostr = {
    getPublicKey: () => account.getPublicKey(),
    signEvent: (template: Parameters<ISigner["signEvent"]>[0]) => account.signEvent(template),
  };
}

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

/** Whether a promise has settled once `ms` have passed and everything queued has run. Needs fake timers. */
async function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  await vi.advanceTimersByTimeAsync(ms);
  return settled;
}

/** Whether a promise has settled once everything already queued has run. Needs fake timers. */
const hasSettled = (promise: Promise<unknown>) => settledWithin(promise, 0);

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await disconnect();
  sessionStorage.clear();
  pool.current = null;
  delete (window as unknown as Page).nostr;
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

  it("lets go of a bunker that connects after a disconnect, and keeps nothing", async () => {
    const bunker = fakeBunker(CURATOR);

    const connecting = connectBunker(bunker.bunkerUri(), bunker.methods);
    await disconnect();

    expect((await failure(connecting)).reason).toBe("not-connected");
    expect(activeSigner()).toBeNull();
    expect(keptSession()).toBeNull();
  });

  it("leaves an extension connected meanwhile in use", async () => {
    const bunker = fakeBunker(CURATOR);
    installExtension(OTHER);

    const connecting = connectBunker(bunker.bunkerUri(), bunker.methods);
    const extension = await connectExtension();

    expect((await failure(connecting)).reason).toBe("not-connected");
    expect(activeSigner()).toEqual({ method: "extension", pubkey: extension });
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

  it("turns away a bare ack when the answer can't be read", async () => {
    const bunker = fakeBunker(CURATOR);
    vi.useFakeTimers();
    vi.spyOn(libraryNip44.v2, "decrypt").mockImplementationOnce(() => {
      throw new Error("could not decrypt");
    });

    const { uri, done, cancel } = startPairing(bunker.methods);
    bunker.pair(uri, "ack");

    expect(await hasSettled(done)).toBe(false);
    expect(bunker.requests).toEqual([]);
    cancel();
    await failure(done);
    expect(activeSigner()).toBeNull();
  });

  it("leaves a signer connected during pairing in use", async () => {
    const bunker = fakeBunker(CURATOR);
    const { uri, done } = startPairing(bunker.methods);

    activate(OTHER, "extension", await OTHER.getPublicKey());
    bunker.pair(uri);

    expect((await failure(done)).reason).toBe("not-connected");
    expect(activeSigner()).toEqual({ method: "extension", pubkey: await OTHER.getPublicKey() });
    expect(keptSession()).toBeNull();
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

  it("is not restored when the signer in use changes while it reopens", async () => {
    const bunker = fakeBunker(CURATOR);
    await connectBunker(bunker.bunkerUri(), bunker.methods);
    const kept = sessionStorage.getItem(SESSION_KEY) ?? "";
    await disconnect();
    sessionStorage.setItem(SESSION_KEY, kept);

    const restoring = restoreRemote(bunker.methods);
    await disconnect();

    expect((await failure(restoring)).reason).toBe("not-connected");
    expect(activeSigner()).toBeNull();
    expect(keptSession()).toBeNull();
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

describe("reaching a remote signer through the relay pool", () => {
  it("sends each request on as soon as one relay takes it, whatever the others do", async () => {
    const bunker = fakeBunker(CURATOR);
    pool.current = poolReaching(bunker);
    vi.useFakeTimers();
    const link = `${bunker.bunkerUri()}&relay=${encodeURIComponent(SILENT_RELAY)}`;

    const connecting = connectBunker(link);
    expect(await settledWithin(connecting, 1_000)).toBe(true);
    const signing = signTemplate(VOTE);
    expect(await settledWithin(signing, 1_000)).toBe(true);

    expect((await signing).pubkey).toBe(await connecting);
    expect(bunker.requests).toEqual(["connect", "get_public_key", "sign_event"]);
  });
});

describe("approval links", () => {
  it("hands a signer's https approval link to the page, and opens nothing", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const heard: string[] = [];
    const stop = onRemoteAuth((url) => heard.push(url));
    const bunker = fakeBunker(CURATOR);
    await connectBunker(bunker.bunkerUri(), bunker.methods);

    bunker.askApproval(APPROVAL_LINK);
    await signTemplate(VOTE);
    stop();
    bunker.askApproval(APPROVAL_LINK);
    await signTemplate(VOTE);

    expect(heard).toEqual([APPROVAL_LINK]);
    expect(open).not.toHaveBeenCalled();
  });

  it("passes on no link that isn't https", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const heard: string[] = [];
    const stop = onRemoteAuth((url) => heard.push(url));
    const bunker = fakeBunker(CURATOR);
    await connectBunker(bunker.bunkerUri(), bunker.methods);

    bunker.askApproval("javascript:alert(1)");
    await signTemplate(VOTE);
    bunker.askApproval("http://signer.example.test/approve");
    await signTemplate(VOTE);
    stop();

    expect(heard).toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });
});
