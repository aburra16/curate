/**
 * How Curate talks to one relay. The reading services take their relays
 * through this interface, so tests swap in a script (`src/test/fakeTransport.ts`)
 * and need no sockets.
 *
 * The default is applesauce's RelayPool. Every request ends in exactly one way:
 * EOSE, the relay's CLOSED (applesauce raises the refusals as errors), our own
 * timeout, or a failure. Reading never signs, so a relay that wants a sign-in
 * is reported as closed instead of waited on. A publish ends as the relay's
 * OK, its refusal, or a failure, and is never retried here.
 */

import { TimeoutError } from "applesauce-core/observable";
import { RelayClosedError } from "applesauce-relay";
import type { Filter, NostrEvent } from "nostr-tools";
import type { Subscription } from "rxjs";
import { getPool } from "@/lib/nostr/ndk";
import type { PublishOutcome } from "@/lib/publishQuorum";

/**
 * What a publish says when the relay never answered in time. The publish
 * service tells a silent relay from a refusing one by this exact text, so every
 * transport words a timeout this way.
 */
export const PUBLISH_TIMED_OUT = "timed out";

export type ReqEnd =
  | { state: "eose" }
  | { state: "closed"; reason: string }
  | { state: "timeout" }
  | { state: "error"; reason: string };

export interface RelayTransport {
  /** Ask one relay and wait for it to end: EOSE, CLOSED, `timeoutMs`, or a failure. Never rejects. */
  req(relay: string, filters: Filter[], onEvent: (ev: NostrEvent) => void, timeoutMs: number): Promise<ReqEnd>;
  /** NIP-45 COUNT. null when the relay refuses, doesn't answer within `timeoutMs`, or fails. */
  count(relay: string, filters: Filter[], timeoutMs: number): Promise<number | null>;
  /** Keep a subscription open for new events. Returns the function that closes it. */
  live(relay: string, filters: Filter[], onEvent: (ev: NostrEvent) => void): () => void;
  /**
   * Send one signed event to one relay and wait for its OK, a refusal, or `timeoutMs`.
   * One attempt, no retries. Never rejects: a failure is `{ok:false}` with the reason.
   */
  publish(relay: string, event: NostrEvent, timeoutMs: number): Promise<PublishOutcome>;
}

let current: RelayTransport | null = null;

/** Replace the transport. Tests only. */
export function setTransport(t: RelayTransport): void {
  current = t;
}

/** The transport in use: the one a test set, else the applesauce pool. */
export function transport(): RelayTransport {
  return (current ??= poolTransport);
}

function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  // A failed WebSocket surfaces as an Event, which has no message.
  return "the connection failed";
}

/** A relay's CLOSED reaches us as an error with the relay's `reason`. */
function endOfError(err: unknown): ReqEnd {
  if (err instanceof RelayClosedError) return { state: "closed", reason: err.reason };
  return { state: "error", reason: messageOf(err) };
}

/** The message the relay library puts in the result of a publish no relay answered. */
const LIBRARY_TIMEOUT = "Timeout";

const poolTransport: RelayTransport = {
  req(relay, filters, onEvent, timeoutMs) {
    return new Promise<ReqEnd>((resolve) => {
      let done = false;
      let sub: Subscription | undefined;

      const finish = (end: ReqEnd) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        sub?.unsubscribe();
        resolve(end);
      };

      const timer = setTimeout(() => finish({ state: "timeout" }), timeoutMs);
      try {
        sub = getPool()
          .relay(relay)
          .req(filters, { waitForAuth: false })
          .subscribe({
            next: (message) => {
              if (done) return;
              if (message.type === "EVENT") onEvent(message.event);
              else if (message.type === "EOSE") finish({ state: "eose" });
              else if (message.type === "CLOSED") finish({ state: "closed", reason: message.reason });
            },
            error: (err) => finish(endOfError(err)),
            complete: () => finish({ state: "error", reason: "the relay ended the request without EOSE" }),
          });
        // `finish` may have run before `sub` was assigned.
        if (done) sub.unsubscribe();
      } catch (err) {
        finish(endOfError(err));
      }
    });
  },

  count(relay, filters, timeoutMs) {
    return new Promise<number | null>((resolve) => {
      let done = false;
      let sub: Subscription | undefined;

      const finish = (n: number | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        sub?.unsubscribe();
        resolve(n);
      };

      const timer = setTimeout(() => finish(null), timeoutMs);
      try {
        sub = getPool()
          .relay(relay)
          .count(filters)
          .subscribe({
            next: (response) => finish(typeof response.count === "number" ? response.count : null),
            error: () => finish(null),
            complete: () => finish(null),
          });
        if (done) sub.unsubscribe();
      } catch {
        finish(null);
      }
    });
  },

  live(relay, filters, onEvent) {
    let sub: Subscription | undefined;
    try {
      sub = getPool()
        .relay(relay)
        .subscription(filters, { waitForAuth: false })
        .subscribe({
          next: (message) => {
            if (message !== "EOSE") onEvent(message);
          },
          // A live subscription that fails just stops; reads report the relay's state.
          error: () => {},
        });
    } catch {
      // No pool (server render): nothing to subscribe to.
    }
    return () => sub?.unsubscribe();
  },

  async publish(relay, event, timeoutMs) {
    try {
      const res = await getPool().relay(relay).publish(event, { retries: false, timeout: timeoutMs });
      if (res.ok) return { ok: true, from: relay };
      // The relay library answers a silent relay with a plain "Timeout" result.
      return { ok: false, from: relay, message: res.message === LIBRARY_TIMEOUT ? PUBLISH_TIMED_OUT : res.message };
    } catch (err) {
      // Our own `timeoutMs` ends the wait with a TimeoutError.
      return { ok: false, from: relay, message: err instanceof TimeoutError ? PUBLISH_TIMED_OUT : messageOf(err) };
    }
  },
};
