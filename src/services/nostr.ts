/**
 * Reading from the relays: every relay is asked, the read waits for every
 * relay to end, and a relay that refuses or stays silent is recorded rather
 * than hidden. Events that fail their signature check are dropped.
 */

import type { Filter, NostrEvent } from "nostr-tools";
import { getEventHash, verifyEvent } from "nostr-tools/pure";
import { useRelayStatus } from "@/stores/relay-status";
import { INDEX } from "@/services/relays";
import { transport, type ReqEnd } from "@/services/transport";

const DEFAULT_TIMEOUT_MS = 8000;

/** The NIP-50 token that makes the index answer the whole corpus, unranked. */
const SPAM_TOKEN = "include:spam";

/** Event id -> the relays that returned it, in the order they did. */
const seen = new Map<string, string[]>();

function noteSeen(eventId: string, relay: string): void {
  const relays = seen.get(eventId);
  if (!relays) seen.set(eventId, [relay]);
  else if (!relays.includes(relay)) relays.push(relay);
}

/** The relays that returned this event during this visit. */
export function seenOn(eventId: string): string[] {
  return [...(seen.get(eventId) ?? [])];
}

/** Forget which relays returned what. Tests start each case from here. */
export function clearSeenOn(): void {
  seen.clear();
}

function messageOf(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "the request failed";
}

/** The checked signature of each id checked during this visit. */
const verified = new Map<string, string>();

/**
 * The event as its author signed it, or null when it isn't. The signature
 * is checked once per id: a later copy (the same event from another relay,
 * or read again) only has its id recomputed, which proves it carries the
 * content the checked signature covers. A crowded second of a bulk import is
 * thousands of events, each sent by the hub and the index, and read again
 * to fill it; checking each copy's signature costs more than the read is
 * given. Such a copy is handed on with the checked signature, never its
 * own, so Raw never shows a signature nobody checked.
 */
function authentic(ev: NostrEvent): NostrEvent | null {
  const sig = verified.get(ev.id);
  if (sig === undefined) {
    if (!verifyEvent(ev)) return null;
    verified.set(ev.id, ev.sig);
    return ev;
  }
  try {
    if (getEventHash(ev) !== ev.id) return null;
  } catch {
    return null;
  }
  return ev.sig === sig ? ev : { ...ev, sig };
}

/** How one relay's part of a read went. */
export interface RelayOutcome {
  end: ReqEnd;
  /** How many events it sent, before the signature check: what a relay's cap on one filter counts. */
  sent: number;
  /** How many verified events it sent, repeats of other relays' included. */
  received: number;
  /** The oldest `created_at` among them, or null when it sent none. */
  oldest: number | null;
}

/** A read's events, each once, and how each relay's part of it went. */
export interface RelayRead {
  events: NostrEvent[];
  outcomes: Record<string, RelayOutcome>;
}

/**
 * Ask each relay the same filters and wait for every one to end (EOSE, CLOSED,
 * or `timeoutMs`). Events are deduped by id; each relay's outcome goes to the
 * relay-status store.
 */
export async function readRelays(
  relays: string[],
  filters: Filter[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<NostrEvent[]> {
  return (await readRelaysReporting(relays, filters, timeoutMs)).events;
}

/**
 * `readRelays`, also saying how each relay's part went: a reader that pages
 * needs to know a relay stopped partway (a timeout or a dropped connection
 * after some events), or it would go on past events it never got.
 */
export async function readRelaysReporting(
  relays: string[],
  filters: Filter[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<RelayRead> {
  const t = transport();
  const events = new Map<string, NostrEvent>();
  const outcomes: Record<string, RelayOutcome> = {};

  await Promise.all(
    [...new Set(relays)].map(async (relay) => {
      let sent = 0;
      let received = 0;
      let oldest: number | null = null;
      let end: ReqEnd;
      try {
        end = await t.req(
          relay,
          filters,
          (sentEvent) => {
            sent += 1;
            const ev = authentic(sentEvent);
            if (!ev) return;
            received += 1;
            if (oldest === null || ev.created_at < oldest) oldest = ev.created_at;
            noteSeen(ev.id, relay);
            if (!events.has(ev.id)) events.set(ev.id, ev);
          },
          timeoutMs,
        );
      } catch (err) {
        end = { state: "error", reason: messageOf(err) };
      }
      outcomes[relay] = { end, sent, received, oldest };
      useRelayStatus.getState().report(relay, end);
    }),
  );

  return { events: [...events.values()], outcomes };
}

/** The index refuses a filter without a `search`. Add the token, keeping any words already there. */
function withSpamToken(filters: Filter[]): Filter[] {
  return filters.map((f) => {
    const words = f.search?.trim() ?? "";
    if (/(^|\s)include:spam(\s|$)/.test(words)) return { ...f, search: words };
    return { ...f, search: words ? `${words} ${SPAM_TOKEN}` : SPAM_TOKEN };
  });
}

/** Read the search index. It carries `include:spam` on every filter. */
export function readIndex(filters: Filter[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<NostrEvent[]> {
  return readRelays([INDEX], withSpamToken(filters), timeoutMs);
}

/** `readIndex`, also saying how the index's part went (`readRelaysReporting`). */
export function readIndexReporting(filters: Filter[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<RelayRead> {
  return readRelaysReporting([INDEX], withSpamToken(filters), timeoutMs);
}

/** NIP-45 COUNT on the index. null when the index refuses or doesn't answer. */
export async function countIndex(filters: Filter[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<number | null> {
  try {
    return await transport().count(INDEX, withSpamToken(filters), timeoutMs);
  } catch {
    return null;
  }
}

/**
 * Keep listening for new events on every relay. Each verified event reaches
 * `onEvent` once, however many relays send it. Returns the function that stops.
 */
export function subscribeLive(
  relays: string[],
  filters: Filter[],
  onEvent: (ev: NostrEvent) => void,
): () => void {
  const t = transport();
  const delivered = new Set<string>();
  const stops = [...new Set(relays)].map((relay) =>
    t.live(relay, filters, (sentEvent) => {
      const ev = authentic(sentEvent);
      if (!ev) return;
      noteSeen(ev.id, relay);
      if (delivered.has(ev.id)) return;
      delivered.add(ev.id);
      onEvent(ev);
    }),
  );
  return () => {
    for (const stop of stops) stop();
  };
}
