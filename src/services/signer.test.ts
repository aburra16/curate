// @vitest-environment jsdom
import { PrivateKeySigner, type ISigner } from "applesauce-signers";
import type { EventTemplate } from "nostr-tools";
import { generateSecretKey, verifyEvent } from "nostr-tools/pure";
import { afterEach, describe, expect, it } from "vitest";
import { SESSION_KEY } from "./remoteSigner";
import {
  activate,
  activeSigner,
  CLIENT_TAG,
  connectExtension,
  disconnect,
  SignerError,
  signTemplate,
} from "./signer";

const CURATOR = new PrivateKeySigner(generateSecretKey());
const OTHER = new PrivateKeySigner(generateSecretKey());

const NOTE: EventTemplate = { kind: 1, content: "hello", tags: [["t", "reading"]], created_at: 0 };

type Page = { nostr?: unknown };

/** What a signer extension puts on the page. `behind` is swapped to simulate the person switching accounts. */
function installExtension(first: ISigner) {
  const shim = {
    behind: first,
    getPublicKey: () => shim.behind.getPublicKey(),
    signEvent: (template: EventTemplate) => shim.behind.signEvent(template),
  };
  (window as unknown as Page).nostr = shim;
  return shim;
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

/** A signer whose signing waits until the test lets it finish. */
function waitingSigner(behind: ISigner): { signer: ISigner; finish: () => void } {
  let finish = () => {};
  const signer: ISigner = {
    getPublicKey: () => behind.getPublicKey(),
    signEvent: (template) =>
      new Promise((resolve) => {
        finish = () => resolve(behind.signEvent(template));
      }),
  };
  return { signer, finish: () => finish() };
}

/** A remote signer stand-in that counts how often it was closed. */
function closableSigner(behind: ISigner): ISigner & { close: () => Promise<void>; closed: number } {
  const signer = {
    closed: 0,
    getPublicKey: () => behind.getPublicKey(),
    signEvent: (template: EventTemplate) => behind.signEvent(template),
    close: async () => {
      signer.closed += 1;
    },
  };
  return signer;
}

afterEach(async () => {
  delete (window as unknown as Page).nostr;
  await disconnect();
  sessionStorage.clear();
});

describe("connectExtension", () => {
  it("returns the account's pubkey and makes the extension the active signer", async () => {
    installExtension(CURATOR);

    const pubkey = await connectExtension();

    expect(pubkey).toBe(await CURATOR.getPublicKey());
    expect(activeSigner()).toEqual({ method: "extension", pubkey });
  });

  it("reports no extension when the page has none", async () => {
    const err = await failure(connectExtension());

    expect(err.reason).toBe("no-extension");
    expect(err.message).toBe("No Nostr signer extension found in this browser.");
    expect(activeSigner()).toBeNull();
  });

  it("reports a refusal when the extension won't share the account", async () => {
    const shim = installExtension(CURATOR);
    shim.getPublicKey = () => Promise.reject(new Error("The person said no"));

    const err = await failure(connectExtension());

    expect(err.reason).toBe("refused");
    expect(err.message).toBe("The signer didn't connect: The person said no");
    expect(activeSigner()).toBeNull();
  });
});

describe("signTemplate", () => {
  it("adds the client tag once, replacing any other", async () => {
    installExtension(CURATOR);
    await connectExtension();

    const event = await signTemplate({
      ...NOTE,
      tags: [["client", "Brainstorm"], ["t", "reading"], ["client", "Curate"], ["client", "Other", "wss://x.test"]],
    });

    expect(event.tags.filter((t) => t[0] === "client")).toEqual([["client", "Curate"]]);
    expect(event.tags).toContainEqual(["t", "reading"]);
    expect(event.tags).toHaveLength(2);
  });

  it("signs the template's kind and content, stamped with the time of signing and valid", async () => {
    installExtension(CURATOR);
    const pubkey = await connectExtension();
    const before = Math.floor(Date.now() / 1000);

    // A template that still carries a time: the signer ignores it.
    const withATime = { ...NOTE, kind: 7, content: "+", created_at: 12 };

    const event = await signTemplate(withATime);

    expect(event).toMatchObject({ kind: 7, content: "+", pubkey });
    expect(event.created_at).toBeGreaterThanOrEqual(before);
    expect(event.created_at).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    expect(verifyEvent(event)).toBe(true);
  });

  it("does not change the template it was given", async () => {
    installExtension(CURATOR);
    await connectExtension();
    const tags = [["client", "Brainstorm"]];

    await signTemplate({ ...NOTE, tags });

    expect(tags).toEqual([["client", "Brainstorm"]]);
  });

  it("tags with the constant it exports", () => {
    expect(CLIENT_TAG).toEqual(["client", "Curate"]);
  });

  it("refuses an event signed by another account", async () => {
    const shim = installExtension(CURATOR);
    await connectExtension();
    shim.behind = OTHER;

    const err = await failure(signTemplate(NOTE));

    expect(err.reason).toBe("account-changed");
    expect(err.message).toBe("Your signer is now signing as a different account. Connect again to write.");
  });

  it("refuses an event whose signature doesn't check out", async () => {
    const pubkey = await CURATOR.getPublicKey();
    const forger: ISigner = {
      getPublicKey: () => CURATOR.getPublicKey(),
      signEvent: async (template) => {
        const { id, pubkey, sig, kind, tags, created_at } = await CURATOR.signEvent(template);
        return { id, pubkey, sig, kind, tags, created_at, content: "changed after signing" };
      },
    };
    activate(forger, "remote", pubkey);

    const err = await failure(signTemplate(NOTE));

    expect(err.reason).toBe("refused");
  });

  it("reports no extension when it goes away after connecting", async () => {
    installExtension(CURATOR);
    await connectExtension();
    delete (window as unknown as Page).nostr;

    const err = await failure(signTemplate(NOTE));

    expect(err.reason).toBe("no-extension");
  });

  it("reports a refusal with the signer's own words", async () => {
    const shim = installExtension(CURATOR);
    await connectExtension();
    shim.signEvent = () => Promise.reject(new Error("User rejected the request"));

    const err = await failure(signTemplate(NOTE));

    expect(err.reason).toBe("refused");
    expect(err.message).toBe("The signer didn't sign: User rejected the request");
  });

  it("reports a refusal when the signer rejects with plain text", async () => {
    const shim = installExtension(CURATOR);
    await connectExtension();
    shim.signEvent = () => Promise.reject("denied");

    const err = await failure(signTemplate(NOTE));

    expect(err.message).toBe("The signer didn't sign: denied");
  });

  it("passes on a failure the signer already named", async () => {
    const slow: ISigner = {
      getPublicKey: () => CURATOR.getPublicKey(),
      signEvent: () => Promise.reject(new SignerError("timeout", "The signer didn't answer in time.")),
    };
    activate(slow, "remote", await CURATOR.getPublicKey());

    const err = await failure(signTemplate(NOTE));

    expect(err.reason).toBe("timeout");
    expect(err.message).toBe("The signer didn't answer in time.");
  });

  it("returns nothing when the signer is disconnected while it signs", async () => {
    const { signer, finish } = waitingSigner(CURATOR);
    activate(signer, "extension", await CURATOR.getPublicKey());

    const signing = signTemplate(NOTE);
    await disconnect();
    finish();

    const err = await failure(signing);
    expect(err.reason).toBe("not-connected");
  });

  it("returns nothing when another signer takes over while it signs", async () => {
    const { signer, finish } = waitingSigner(CURATOR);
    activate(signer, "extension", await CURATOR.getPublicKey());

    const signing = signTemplate(NOTE);
    activate(OTHER, "extension", await OTHER.getPublicKey());
    finish();

    expect((await failure(signing)).reason).toBe("not-connected");
  });

  it.each([
    ["drops the client tag", (t: EventTemplate) => ({ ...t, tags: t.tags.filter((tag) => tag[0] !== "client") })],
    ["repeats the client tag", (t: EventTemplate) => ({ ...t, tags: [...t.tags, ["client", "Curate"]] })],
    ["adds a client tag of its own", (t: EventTemplate) => ({ ...t, tags: [...t.tags, ["client", "Other"]] })],
    ["changes the content", (t: EventTemplate) => ({ ...t, content: "something else" })],
    ["changes the kind", (t: EventTemplate) => ({ ...t, kind: t.kind + 1 })],
    ["changes another tag", (t: EventTemplate) => ({ ...t, tags: t.tags.map((tag) => (tag[0] === "t" ? ["t", "x"] : tag)) })],
  ])("refuses an event from a signer that %s", async (_, change) => {
    const meddler: ISigner = {
      getPublicKey: () => CURATOR.getPublicKey(),
      signEvent: (template) => CURATOR.signEvent(change(template)),
    };
    activate(meddler, "extension", await CURATOR.getPublicKey());

    const err = await failure(signTemplate(NOTE));

    expect(err.reason).toBe("refused");
    expect(err.message).toBe("The signer changed the event it was asked to sign.");
  });

  it("reports not connected when no signer is active", async () => {
    installExtension(CURATOR);

    const err = await failure(signTemplate(NOTE));

    expect(err.reason).toBe("not-connected");
  });
});

describe("activate", () => {
  it("closes a remote signer it replaces, and forgets its session", async () => {
    const remote = closableSigner(CURATOR);
    activate(remote, "remote", await CURATOR.getPublicKey());
    sessionStorage.setItem(SESSION_KEY, "{}");

    activate(OTHER, "extension", await OTHER.getPublicKey());

    expect(remote.closed).toBe(1);
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("makes a signer of another kind the active one", async () => {
    const pubkey = await OTHER.getPublicKey();

    activate(OTHER, "remote", pubkey);

    expect(activeSigner()).toEqual({ method: "remote", pubkey });
    const event = await signTemplate(NOTE);
    expect(event.pubkey).toBe(pubkey);
  });
});

describe("disconnect", () => {
  it("forgets the signer", async () => {
    installExtension(CURATOR);
    await connectExtension();

    await disconnect();

    expect(activeSigner()).toBeNull();
    expect((await failure(signTemplate(NOTE))).reason).toBe("not-connected");
  });

  it("closes a remote signer and forgets its session", async () => {
    const remote = closableSigner(CURATOR);
    activate(remote, "remote", await CURATOR.getPublicKey());
    sessionStorage.setItem(SESSION_KEY, "{}");

    await disconnect();

    expect(remote.closed).toBe(1);
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });
});
