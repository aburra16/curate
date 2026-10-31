/**
 * The one place Curate signs. Every event goes through `signTemplate`, which
 * tags it as Curate's and refuses a signature that isn't from the account the
 * person connected.
 *
 * The signer in use lives here, in memory only. Curate never holds the person's
 * private key: the browser extension (or, later, a remote signer) does the
 * signing, and `activate` is how a signer becomes the one in use.
 */

import type { ISigner } from "applesauce-signers";
import { ExtensionMissingError, ExtensionSigner } from "applesauce-signers/signers/extension-signer";
import type { EventTemplate, NostrEvent } from "nostr-tools";
import { verifyEvent } from "nostr-tools/pure";

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

let active: { signer: ISigner; method: SignerMethod; pubkey: string } | null = null;

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
function failureOf(err: unknown, action: "connect" | "sign"): SignerError {
  if (err instanceof SignerError) return err;
  if (err instanceof ExtensionMissingError) return noExtension();
  return new SignerError("refused", `The signer didn't ${action}: ${messageOf(err)}`);
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

/** Make `signer` the one in use for `pubkey`'s account, in place of any other. */
export function activate(signer: ISigner, method: SignerMethod, pubkey: string): void {
  active = { signer, method, pubkey };
}

/** Forget the signer in use. */
export async function disconnect(): Promise<void> {
  active = null;
}

/**
 * Sign a template as the connected account. The event carries one
 * `["client","Curate"]` tag in place of any other `client` tag, is stamped with
 * the time of signing, and is refused unless its signature checks out and it
 * is from the account that connected: an extension can switch accounts under
 * an open page.
 */
export async function signTemplate(template: EventTemplate): Promise<NostrEvent> {
  const current = active;
  if (!current) throw new SignerError("not-connected", "Connect a signer to write.");

  const stamped: EventTemplate = {
    kind: template.kind,
    content: template.content,
    tags: [...template.tags.filter((tag) => tag[0] !== "client"), [...CLIENT_TAG]],
    created_at: Math.floor(Date.now() / 1000),
  };

  let event: NostrEvent;
  try {
    event = await current.signer.signEvent(stamped);
  } catch (err) {
    throw failureOf(err, "sign");
  }
  if (!checks(event)) {
    throw new SignerError("refused", "The signer didn't sign: the event it returned doesn't check out.");
  }
  if (event.pubkey !== current.pubkey) {
    throw new SignerError(
      "account-changed",
      "Your signer is now signing as a different account. Connect again to write.",
    );
  }
  return event;
}
