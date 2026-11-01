/**
 * Signing with a remote signer (NIP-46): a signer app on the person's phone,
 * paired by scanning a `nostrconnect://` code, or a bunker the person names by
 * pasting its `bunker://` link.
 *
 * The person's key stays in that signer. The page holds only a throwaway client
 * key it talks to the signer with, kept in `sessionStorage` with the rest of
 * the session, so the pairing lasts across a reload until the person
 * disconnects or closes the tab.
 *
 * A connect that finishes after the signer in use has changed (the person
 * disconnected, or connected another signer meanwhile) is let go rather than
 * put in use. A signer's approval links are handed to the page through
 * `onRemoteAuth`; nothing here opens them.
 */

import { isHexKey } from "applesauce-core/helpers/string";
import { NostrConnectSigner, PrivateKeySigner, type NostrConnectSignerOptions } from "applesauce-signers";
import { isNIP04 } from "applesauce-signers/helpers/encryption";
import type { NostrEvent } from "nostr-tools";
import { bytesToHex } from "nostr-tools/utils";
import { publishUntilEnough } from "@/lib/publishQuorum";
import { getPool } from "@/services/pool";
import { activate, failureOf, SignerError, signerGeneration, withinTime } from "@/services/signer";

/** The relays a pairing code asks the signer to answer on. nsec.app answers on its own relay only. */
export const NIP46_RELAYS = ["wss://relay.nsec.app", "wss://relay.primal.net"];

/** The kinds Curate asks a remote signer to sign: deletions, votes, lists and their items. */
export const SIGNED_KINDS = [5, 7, 39998, 39999];

/** How long pairing waits: long enough to find the phone, open the signer and approve. */
export const PAIRING_TIMEOUT_MS = 180_000;

/** How long a remote signer has to answer one request before Curate gives up on it. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Where the session is kept in `sessionStorage`. */
export const SESSION_KEY = "curate-remote-signer";

/** What is kept of a remote signer between reloads. */
export interface RemoteSession {
  /** The throwaway client key, hex. Never the person's key. */
  clientKey: string;
  /** The remote signer's own pubkey. */
  remote: string;
  /** The relays the signer is reached on. */
  relays: string[];
  /** The account it signs for. */
  pubkey: string;
}

/** How a remote signer reaches the relays. Tests pass a fake bunker's; the page uses the relay pool. */
type Methods = Pick<NostrConnectSignerOptions, "subscriptionMethod" | "publishMethod">;

/** What every remote signer Curate builds is given: how it reaches the relays, and where approval links go. */
type SharedOptions = Methods & Pick<NostrConnectSignerOptions, "onAuth">;

const PERMISSIONS = NostrConnectSigner.buildSigningPermissions(SIGNED_KINDS);

const NO_ANSWER = "The signer didn't answer in time.";

const approvalListeners = new Set<(url: string) => void>();

/**
 * Hear the approval links remote signers send (NIP-46 `auth_url`: the signer
 * wants its owner to approve a request on a web page). Only `https:` links are
 * passed on, and Curate never opens one itself: the page shows it for the
 * person to click. Returns the function that stops listening.
 */
export function onRemoteAuth(listener: (url: string) => void): () => void {
  approvalListeners.add(listener);
  return () => {
    approvalListeners.delete(listener);
  };
}

/** A signer's approval link, passed to the listeners when it is an `https:` link, and otherwise dropped. */
async function passOnApproval(url: string): Promise<void> {
  let link: URL;
  try {
    link = new URL(url);
  } catch {
    return;
  }
  if (link.protocol !== "https:") return;
  for (const listener of approvalListeners) {
    try {
      listener(link.href);
    } catch {
      // One listener's failure doesn't stop the others, or the request waiting on approval.
    }
  }
}

/**
 * A signer for a pairing Curate starts. NIP-46 makes the code's secret the
 * proof that an answer comes from the signer the code was shown to: the code
 * is on screen, and anyone watching the relays can see who waits for it. The
 * library also takes a bare "ack" as that proof. Until it has paired, this one
 * hears only an answer it can read and that carries the secret.
 */
class PairingSigner extends NostrConnectSigner {
  async handleEvent(event: NostrEvent): Promise<void> {
    if (!this.remote && !(await this.carriesSecret(event))) return;
    return super.handleEvent(event);
  }

  /** Whether the answer reads as the code's secret. One that can't be read doesn't. */
  private async carriesSecret(event: NostrEvent): Promise<boolean> {
    try {
      const plaintext = isNIP04(event.content)
        ? await this.signer.nip04.decrypt(event.pubkey, event.content)
        : await this.signer.nip44.decrypt(event.pubkey, event.content);
      return (JSON.parse(plaintext) as { result?: unknown } | null)?.result === this.secret;
    } catch {
      return false;
    }
  }
}

/**
 * The relay pool as a remote signer's methods. A request goes on as soon as
 * one relay has taken it, or every relay has failed or run out of time: the
 * pool's own publish waits for all of them, so one relay that never answers
 * would hold up every request.
 */
function poolMethods(): Methods {
  const pool = getPool();
  return {
    subscriptionMethod: (relays, filters) => pool.subscription(relays, filters),
    publishMethod: (relays, event) =>
      publishUntilEnough(relays, async (relay) => pool.relay(relay).publish(event, { timeout: REQUEST_TIMEOUT_MS }), {
        need: 1,
        timeoutMs: REQUEST_TIMEOUT_MS,
      }),
  };
}

/** What every signer is built with: the test's methods or the relay pool, and approval links to the page. */
function shared(methods?: Methods): SharedOptions {
  return { ...(methods ?? poolMethods()), onAuth: passOnApproval };
}

function keep(session: RemoteSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Not kept: the signer still works until the page is reloaded.
  }
}

/** The kept session, or null when there is none or it can't be read. One that can't be read is forgotten. */
function keptSession(): RemoteSession | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const { clientKey, remote, relays, pubkey } = JSON.parse(raw) as Partial<RemoteSession>;
    const readable =
      isHexKey(clientKey) &&
      isHexKey(remote) &&
      isHexKey(pubkey) &&
      Array.isArray(relays) &&
      relays.length > 0 &&
      relays.every((relay) => typeof relay === "string");
    if (readable) return { clientKey, remote, relays, pubkey } as RemoteSession;
  } catch {
    // Not a session: forgotten below.
  }
  forgetRemote();
  return null;
}

/**
 * Make `signer` the one in use for `pubkey`, and keep its session, unless the
 * signer in use has changed since the connect began (`started`, from
 * `signerGeneration`). Then it is closed instead, and the connect fails.
 */
async function adopt(signer: NostrConnectSigner, pubkey: string, started: number): Promise<void> {
  if (signerGeneration() !== started) {
    await signer.close();
    throw new SignerError("not-connected", "The signer in use changed before this one connected.");
  }
  // `activate` forgets the session of the signer it replaces, so this one is kept after it.
  activate(signer, "remote", pubkey);
  const { remote, relays } = signer;
  if (remote) keep({ clientKey: bytesToHex(signer.signer.key), remote, relays, pubkey });
}

/**
 * Start pairing a signer app by code. `uri` is the `nostrconnect://` code to
 * show (as a QR code or to copy); it names Curate, this page and the kinds
 * Curate will ask to sign. `done` resolves to the account's pubkey once a
 * signer has answered with the code's secret, with that signer in use and its
 * session kept. It rejects with a `SignerError`: `timeout` when no signer has
 * paired within `PAIRING_TIMEOUT_MS`, `not-connected` after `cancel` or when
 * the signer in use changed meanwhile. A `cancel` once paired does nothing.
 */
export function startPairing(methods?: Methods): { uri: string; done: Promise<string>; cancel: () => void } {
  const started = signerGeneration();
  const signer = new PairingSigner({ relays: NIP46_RELAYS, signer: new PrivateKeySigner(), ...shared(methods) });
  const uri = signer.getNostrConnectURI({ name: "Curate", url: location.origin, permissions: PERMISSIONS });

  const stop = new AbortController();
  const stopped = new Promise<never>((_, reject) => {
    stop.signal.addEventListener("abort", () => reject(stop.signal.reason), { once: true });
  });
  const timer = setTimeout(
    () => stop.abort(new SignerError("timeout", "No signer paired in time.")),
    PAIRING_TIMEOUT_MS,
  );
  let settled = false;

  const paired = (async () => {
    await signer.waitForSigner(stop.signal);
    return signer.getPublicKey();
  })();

  const done = Promise.race([paired, stopped])
    .then(
      async (pubkey) => {
        settled = true;
        await adopt(signer, pubkey, started);
        return pubkey;
      },
      async (err: unknown) => {
        settled = true;
        await signer.close();
        throw stop.signal.aborted ? stop.signal.reason : failureOf(err, "connect");
      },
    )
    .finally(() => clearTimeout(timer));
  // A caller that cancels and stops listening leaves no unhandled rejection; one that listens still hears it.
  done.catch(() => {});

  const cancel = () => {
    if (!settled) stop.abort(new SignerError("not-connected", "Pairing was stopped."));
  };
  return { uri, done, cancel };
}

/**
 * Connect the bunker a pasted `bunker://` link names, and make it the signer in
 * use with its session kept. Returns the account's pubkey. Rejects with a
 * `SignerError` for anything that isn't a `bunker://` link, when the bunker
 * refuses, when it hasn't answered within `PAIRING_TIMEOUT_MS` (it may be
 * waiting for its owner to approve), or when the signer in use changed while
 * it waited.
 */
export async function connectBunker(uri: string, methods?: Methods): Promise<string> {
  const started = signerGeneration();
  const link = uri.trim();
  const notABunker = new SignerError("not-connected", "That isn't a bunker:// link.");
  if (!link.startsWith("bunker://")) throw notABunker;
  try {
    NostrConnectSigner.parseBunkerURI(link);
  } catch {
    throw notABunker;
  }

  const connecting = NostrConnectSigner.fromBunkerURI(link, {
    signer: new PrivateKeySigner(),
    permissions: PERMISSIONS,
    ...shared(methods),
  });
  let signer: NostrConnectSigner;
  try {
    signer = await withinTime(connecting, PAIRING_TIMEOUT_MS, NO_ANSWER);
  } catch (err) {
    // A bunker that answers after Curate gave up is let go, never put in use.
    void connecting.then((late) => late.close(), () => {});
    throw failureOf(err, "connect");
  }

  try {
    const pubkey = await withinTime(signer.getPublicKey(), REQUEST_TIMEOUT_MS, NO_ANSWER);
    await adopt(signer, pubkey, started);
    return pubkey;
  } catch (err) {
    await signer.close();
    throw failureOf(err, "connect");
  }
}

/**
 * Put the kept remote signer back in use after a reload. Returns its account's
 * pubkey, or null when no session is kept. The signer was paired already, so
 * nothing is sent to it until the first signature: a bunker's secret works
 * once, and connecting again would be refused. Rejects with a `SignerError`
 * when the signer in use changed while it reopened.
 */
export async function restoreRemote(methods?: Methods): Promise<string | null> {
  const started = signerGeneration();
  const session = keptSession();
  if (!session) return null;
  const signer = new NostrConnectSigner({
    relays: session.relays,
    remote: session.remote,
    pubkey: session.pubkey,
    signer: PrivateKeySigner.fromKey(session.clientKey),
    ...shared(methods),
  });
  await signer.open();
  signer.isConnected = true;
  await adopt(signer, session.pubkey, started);
  return session.pubkey;
}

/** Forget the kept session. */
export function forgetRemote(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // No storage: nothing was kept.
  }
}
