/**
 * Where an author keeps their own events: the relays their kind 10002 (NIP-65)
 * marks for writing. A write goes to the list relay and to these, so the
 * author's own followers find it on the relays they already read.
 *
 * The index and the tag hub have jobs of their own and the list relay is
 * written to anyway, so none of the three is ever one of an author's relays.
 */

import type { NostrEvent } from "nostr-tools";
import { newestPerAddress } from "@/lib/newestPerAddress";
import { isValidRelayUrl, normalizeRelayUrl } from "@/lib/nostr/relays";
import { readRelaysReporting } from "@/services/nostr";
import { DCOSL, INDEX, PROFILE_RELAYS, relayKey, TAG_HUB } from "@/services/relays";

/** The most of an author's own relays a write goes to, in the order their list gives them. */
export const MAX_WRITE_RELAYS = 4;

/** Relays an author's list never adds: the list relay is written to already, and the others do other work. */
const NOT_THEIRS = new Set([DCOSL, INDEX, TAG_HUB].map(relayKey));

/**
 * The value as a relay address, or null when it isn't a `wss://` address with a
 * host. `isValidRelayUrl` takes anything after `wss://`, so `wss:///` gets past
 * it; parsing is what finds there is no host.
 */
function secureRelay(value: unknown): string | null {
  if (typeof value !== "string" || !isValidRelayUrl(value)) return null;
  const url = normalizeRelayUrl(value);
  try {
    new URL(url);
    return url;
  } catch {
    return null;
  }
}

/** The relays a kind 10002 marks for writing: unmarked or `write`, kept in tag order, each once, at most `MAX_WRITE_RELAYS`. */
function writeRelaysIn(event: NostrEvent | undefined): string[] {
  const relays: string[] = [];
  const seen = new Set<string>();
  for (const tag of event?.tags ?? []) {
    if (relays.length >= MAX_WRITE_RELAYS) break;
    const [name, value, marker] = tag;
    if (name !== "r" || (marker !== undefined && marker !== "write")) continue;
    const url = secureRelay(value);
    if (!url) continue;
    const key = relayKey(url);
    if (NOT_THEIRS.has(key) || seen.has(key)) continue;
    seen.add(key);
    relays.push(url);
  }
  return relays;
}

/**
 * The author's write relays, or null when no profile relay answered: a read
 * where every relay failed says nothing about whether they have a list.
 */
async function readWriteRelays(pubkey: string): Promise<string[] | null> {
  const { events, outcomes } = await readRelaysReporting([...PROFILE_RELAYS], [
    { kinds: [10002], authors: [pubkey], limit: 5 },
  ]);
  if (!Object.values(outcomes).some((outcome) => outcome.end.state === "eose")) return null;
  // A relay may send an event the filter didn't ask for. Only the author's own list counts.
  const theirs = events.filter((ev) => ev.kind === 10002 && ev.pubkey === pubkey);
  return writeRelaysIn(newestPerAddress(theirs)[0]);
}

/** Author -> the read of their relays, kept for the visit. A read nobody answered is dropped. */
const asked = new Map<string, Promise<string[] | null>>();

/**
 * The relays the author writes to, from their newest kind 10002 on the profile
 * relays: `wss://` addresses marked `write` or not marked at all, each once,
 * never the list relay, the index or the tag hub, at most `MAX_WRITE_RELAYS`.
 * Kept per author for the visit, and callers that ask while the read is on its
 * way share it. An author with no list, or whose list has no usable relay,
 * has none. So does one whose profile relays all failed, but that answer isn't
 * kept: the next call asks again.
 */
export function writeRelaysOf(pubkey: string): Promise<string[]> {
  let answer = asked.get(pubkey);
  if (!answer) {
    const fresh = readWriteRelays(pubkey).catch(() => null);
    asked.set(pubkey, fresh);
    void fresh.then((relays) => {
      if (relays === null && asked.get(pubkey) === fresh) asked.delete(pubkey);
    });
    answer = fresh;
  }
  return answer.then((relays) => [...(relays ?? [])]);
}

/** Forget what was found about each author's relays. Tests start each case from here. */
export function clearOutboxCache(): void {
  asked.clear();
}
