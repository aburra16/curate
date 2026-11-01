/**
 * The one place Curate signs. Every event goes through `signTemplate`, which
 * tags it as Curate's and refuses a signature that isn't from the account the
 * person connected.
 *
 * The signer in use lives here, in memory only. Curate never holds the person's
 * private key: the browser extension or a remote signer (`remoteSigner.ts`)
 * does the signing, and `activate` is how a signer becomes the one in use.
 */

import type { ISigner } from "applesauce-signers";
import { ExtensionMissingError, ExtensionSigner } from "applesauce-signers/signers/extension-signer";
import type { EventTemplate as StampedTemplate, NostrEvent } from "nostr-tools";
import { verifyEvent } from "nostr-tools/pure";
import type { EventTemplate } from "@/lib/conceptCopy";
import { forgetRemote, REQUEST_TIMEOUT_MS } from "@/services/remoteSigner";

export type SignerMethod = "extension" | "remote";

/** The tag every event Curate signs carries, once. */
export const CLIENT_TAG = ["client", "Curate"] as const;

export type SignerFailure = "no-extension" | "not-connected" | "refused" | "account-changed" | "timeout";

/** A signing or connecting failure. `reason` says which; `message` is plain words for the person. */
export class SignerError extends Error {
  readonly reason: SignerFailure;

  constructor(reason: SignerFailure, message: string) {
    super(message);
    this.name = "SignerError";
    this.reason = reason;
  }
}

type Active = { signer: ISigner; method: SignerMethod; pubkey: string };

let active: Active | null = null;

/** A remote signer listens on relays until it is closed. */
type Closable = ISigner & { close(): Promise<void> };

const isClosable = (signer: ISigner): signer is Closable =>
  typeof (signer as Partial<Closable>).close === "function";

function hasExtension(): boolean {
  return typeof window !== "undefined" && Boolean((window as { nostr?: unknown }).nostr);
}

function noExtension(): SignerError {
  return new SignerError("no-extension", "No Nostr signer extension found in this browser.");
}

/** What a signer said when it said no. Extensions reject with an Error, a bare string, or a `{ message }`. */
function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === "string" && message ? message : "no reason given";
}

/** A failure from the signer as a `SignerError`: one the signer already named stands as it is. */
export function failureOf(err: unknown, action: "connect" | "sign"): SignerError {
  if (err instanceof SignerError) return err;
  if (err instanceof ExtensionMissingError) return noExtension();
  return new SignerError("refused", `The signer didn't ${action}: ${messageOf(err)}`);
}

/**
 * `work`, or a `timeout` SignerError saying `message` once `ms` have passed
 * without it settling. An answer that comes later is dropped.
 */
export function withinTime<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SignerError("timeout", message)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** Whether the event carries Curate's client tag once, and no other client tag. */
function taggedOnce(event: NostrEvent): boolean {
  const clients = event.tags.filter((tag) => tag[0] === "client");
  return clients.length === 1 && clients[0].length === CLIENT_TAG.length && clients[0][1] === CLIENT_TAG[1];
}

/** Stop listening to a remote signer that is no longer in use. */
async function closeRemote(outgoing: Active | null): Promise<void> {
  if (outgoing?.method === "remote" && isClosable(outgoing.signer)) await outgoing.signer.close();
}

/** The signer that started a signature is no longer the one in use. */
function replaced(): SignerError {
  return new SignerError("not-connected", "The signer was disconnected before it signed.");
}

/** Whether the event's id and signature are right. An event too malformed to check doesn't pass. */
function checks(event: NostrEvent): boolean {
  try {
    return verifyEvent(event);
  } catch {
    return false;
  }
}

/**
 * Connect the browser's signer extension (NIP-07) and make it the signer in
 * use. Returns the account's pubkey.
 */
export async function connectExtension(): Promise<string> {
  if (!hasExtension()) throw noExtension();
  const signer = new ExtensionSigner();
  let pubkey: string;
  try {
    pubkey = await signer.getPublicKey();
  } catch (err) {
    throw failureOf(err, "connect");
  }
  activate(signer, "extension", pubkey);
  return pubkey;
}

/** The signer in use, or null when none is connected. */
export function activeSigner(): { method: SignerMethod; pubkey: string } | null {
  return active ? { method: active.method, pubkey: active.pubkey } : null;
}

/**
 * Make `signer` the one in use for `pubkey`'s account, in place of any other.
 * A remote signer it replaces is closed and its session forgotten.
 */
export function activate(signer: ISigner, method: SignerMethod, pubkey: string): void {
  const outgoing = active;
  active = { signer, method, pubkey };
  // Only the signer in use has a session kept; a remote signer keeps its own after this.
  forgetRemote();
  // The outgoing signer is no longer used, so a failure to close it changes nothing.
  if (outgoing?.signer !== signer) closeRemote(outgoing).catch(() => {});
}

/** Forget the signer in use. A remote signer is closed and its session forgotten. */
export async function disconnect(): Promise<void> {
  const outgoing = active;
  active = null;
  forgetRemote();
  await closeRemote(outgoing);
}

/**
 * Sign a template (a kind, content and tags: it has no time of its own) as the
 * connected account. The event carries one `["client","Curate"]` tag in place
 * of any other `client` tag, is stamped with the time of signing, and is
 * refused unless its signature checks out, it is from the account that
 * connected (an extension can switch accounts under an open page), and the
 * signer left that tag as it was. A remote signer that hasn't answered within
 * `REQUEST_TIMEOUT_MS` is given up on. Nothing is returned when the signer was
 * disconnected or replaced while it was signing.
 */
export async function signTemplate(template: EventTemplate): Promise<NostrEvent> {
  const current = active;
  if (!current) throw new SignerError("not-connected", "Connect a signer to write.");

  const stamped: StampedTemplate = {
    kind: template.kind,
    content: template.content,
    tags: [...template.tags.filter((tag) => tag[0] !== "client"), [...CLIENT_TAG]],
    created_at: Math.floor(Date.now() / 1000),
  };

  let event: NostrEvent;
  try {
    const signing = current.signer.signEvent(stamped);
    event = await (current.method === "remote"
      ? withinTime(signing, REQUEST_TIMEOUT_MS, "The signer didn't answer in time.")
      : signing);
  } catch (err) {
    if (active !== current) throw replaced();
    throw failureOf(err, "sign");
  }
  if (active !== current) throw replaced();
  if (!checks(event)) {
    throw new SignerError("refused", "The signer didn't sign: the event it returned doesn't check out.");
  }
  if (event.pubkey !== current.pubkey) {
    throw new SignerError(
      "account-changed",
      "Your signer is now signing as a different account. Connect again to write.",
    );
  }
  if (!taggedOnce(event)) {
    throw new SignerError("refused", "The signer changed the event it was asked to sign.");
  }
  return event;
}
