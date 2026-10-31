import type { Filter, NostrEvent } from "nostr-tools";
import { matchFilter } from "nostr-tools/filter";
import type { RelayTransport } from "@/services/transport";

/**
 * What one relay holds: events it answers from, or a refusal (a CLOSED with
 * this reason) or a failure for every request.
 */
export type HeldRelay = NostrEvent[] | { refuses: string } | { fails: string };

export interface RelayCall {
  op: "req" | "count" | "live";
  relay: string;
  filters: Filter[];
}

/**
 * Newest first, ties in id order: the order a relay sends a filter's answer
 * in, so `limit` keeps the same first events every time.
 */
const newestFirst = (a: NostrEvent, b: NostrEvent) =>
  b.created_at - a.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * What a relay sends for one filter: the matching events, newest first, up to
 * its `limit`, and never more than `max`, the most the relay sends for one
 * filter whatever it's asked.
 */
export function answerTo(events: NostrEvent[], filter: Filter, max = Infinity): NostrEvent[] {
  const matching = events.filter((ev) => matchFilter(filter, ev)).sort(newestFirst);
  return matching.slice(0, Math.min(filter.limit ?? Infinity, max));
}

/** Each filter answered on its own, then each event once, as a relay sends one subscription's answer. */
function answerAll(events: NostrEvent[], filters: Filter[], max = Infinity): NostrEvent[] {
  const out = new Map<string, NostrEvent>();
  for (const filter of filters) for (const ev of answerTo(events, filter, max)) out.set(ev.id, ev);
  return [...out.values()];
}

/**
 * A transport whose relays hold events and answer the way a relay does,
 * where `fakeTransport` answers every request with the same script: each
 * filter is matched (kinds, authors, ids, tags, since, until; a `search` is
 * not matched, as the index's words are not), sent newest first and cut at
 * its `limit`. COUNT counts what the filters match. A live subscription
 * sends what matches, once, then nothing more. A relay missing from `held`
 * fails. A relay listed in `ignoringFilters` sends everything it holds
 * whatever it was asked, as a buggy or hostile relay would. A relay in
 * `maxLimit` sends at most that many events for one filter, however high its
 * `limit`, and still ends in EOSE, as the index does at 5,000. Every request
 * is recorded in `calls`.
 */
export function relayCorpus(
  held: Record<string, HeldRelay>,
  { ignoringFilters = [], maxLimit = {} }: { ignoringFilters?: string[]; maxLimit?: Record<string, number> } = {},
): { transport: RelayTransport; calls: RelayCall[] } {
  const calls: RelayCall[] = [];
  const answer = (relay: string, have: NostrEvent[], filters: Filter[]) =>
    ignoringFilters.includes(relay) ? have : answerAll(have, filters, maxLimit[relay]);
  const transport: RelayTransport = {
    async req(relay, filters, onEvent) {
      calls.push({ op: "req", relay, filters });
      const have = held[relay];
      if (!have) return { state: "error", reason: `relayCorpus: nothing held on ${relay}` };
      if ("refuses" in have) return { state: "closed", reason: have.refuses };
      if ("fails" in have) return { state: "error", reason: have.fails };
      for (const ev of answer(relay, have, filters)) onEvent(ev);
      return { state: "eose" };
    },
    async count(relay, filters) {
      calls.push({ op: "count", relay, filters });
      const have = held[relay];
      if (!have || !Array.isArray(have)) return null;
      // COUNT counts everything that matches: a filter's limit caps what it sends, not what it counts.
      const uncapped = filters.map((f) => ({ ...f, limit: undefined }));
      return answerAll(have, uncapped).length;
    },
    live(relay, filters, onEvent) {
      calls.push({ op: "live", relay, filters });
      let open = true;
      queueMicrotask(() => {
        const have = held[relay];
        if (!open || !Array.isArray(have)) return;
        for (const ev of answer(relay, have, filters)) onEvent(ev);
      });
      return () => {
        open = false;
      };
    },
  };
  return { transport, calls };
}
