/**
 * How every list read reaches the relays: the search index and the hub (dcosl,
 * plus any relay the reader added) are asked at once and the answers merged.
 * The index can lag behind the hub, and "not indexed yet" looks the same as
 * "doesn't exist", so asking it alone, or asking the hub only when it comes
 * back empty, would hide an event published since. Asked in parallel, a list
 * event shows wherever it already is, at no extra wait.
 *
 * The index may also refuse (its CLOSED is recorded in the relay-status
 * store); lists then load from the hub alone.
 *
 * A side that fails is an empty answer from that side, so a failing relay
 * never makes the read reject. It rejects only when `onFirst` throws: the
 * caller's own error, handed back to it.
 */

import type { Filter, NostrEvent } from "nostr-tools";
import { isBlankEvent } from "@/lib/blankEvent";
import { readIndex, readRelays } from "@/services/nostr";
import { listRelays } from "@/services/relays";

export interface ReadListEventsOptions {
  /** How long each relay may take before it is given up on. Defaults to the relay layer's. */
  timeoutMs?: number;
  /**
   * Handed the first side's answer the moment it lands, when it holds anything
   * to show: a heavy list (books, 1-2 MB) shows from the faster side instead of
   * waiting for the slower one. Called at most once. The merged answer is
   * still what the read resolves to.
   */
  onFirst?: (events: NostrEvent[]) => void;
}

export async function readListEvents(
  filters: Filter[],
  { timeoutMs, onFirst }: ReadListEventsOptions = {},
): Promise<NostrEvent[]> {
  if (!filters.length) return [];

  let handed = false;
  const early = (events: NostrEvent[]) => {
    if (onFirst && !handed) {
      const kept = dedupe(events);
      if (kept.length) {
        handed = true;
        onFirst(kept);
      }
    }
    return events;
  };

  const [indexed, hub] = await Promise.all([
    readIndex(filters, timeoutMs)
      .catch(() => [] as NostrEvent[])
      .then(early),
    readRelays(listRelays(), filters, timeoutMs)
      .catch(() => [] as NostrEvent[])
      .then(early),
  ]);
  return dedupe([...indexed, ...hub]);
}

/** Each event once, blank ones (lib/blankEvent) left out. */
function dedupe(events: NostrEvent[]): NostrEvent[] {
  const byId = new Map<string, NostrEvent>();
  for (const ev of events) if (!isBlankEvent(ev)) byId.set(ev.id, ev);
  return [...byId.values()];
}
