/**
 * Reactions to a list's items, read correctly:
 *
 * - **By `#e` and by `#a`.** An addressable item is edited by republishing,
 *   which changes its id, so a reaction to an earlier version reaches it
 *   only by its address (NIP-25's `a`). An item without one is reached by
 *   its id.
 * - **One per person per item:** their latest vote. NIP-25's "+" is up and
 *   "-" is down; an empty reaction is a "+". An emoji is no vote, and
 *   doesn't take one back.
 * - **Only people inside the verified line count** (`inWebOfTrust`). Ranks
 *   decide who counts here and are never shown.
 *
 * Counts are kept by item identity (`itemIdentity`), so a reaction to a
 * curation copy counts for its original. Kind-5 deletions of reactions are
 * not read. A relay that fails reads as no reactions.
 *
 * Who reacted is known only once the reactions are read, so a caller holding
 * ranks for some people (a list's authors) passes `rankMore`, which is asked
 * once for the ranks of the voters it doesn't hold.
 */
import type { Filter, NostrEvent } from "nostr-tools";
import { coordinateOf, parseCoordinate } from "@/lib/dlistFields";
import { itemIdentity, type ItemEvent } from "@/services/concepts";
import { readRelays } from "@/services/nostr";
import { listRelays } from "@/services/relays";
import { inWebOfTrust } from "@/services/trust";

export interface ReactionCount {
  up: number;
  down: number;
}

/** Values per `#e` or `#a` filter: a filter of thousands of values is one no relay takes. */
const CHUNK = 100;
const HEX64 = /^[0-9a-f]{64}$/i;

type Vote = "+" | "-";

/** A reaction's vote, or null for one that isn't (an emoji, a word). */
function voteOf(ev: NostrEvent): Vote | null {
  const content = ev.content.trim();
  if (content === "+" || content === "") return "+";
  if (content === "-") return "-";
  return null;
}

const chunked = (values: string[], tag: "#e" | "#a"): Filter[] =>
  Array.from({ length: Math.ceil(values.length / CHUNK) }, (_, i): Filter => {
    const filter: Filter = { kinds: [7] };
    filter[tag] = values.slice(i * CHUNK, (i + 1) * CHUNK);
    return filter;
  });

/**
 * How many people in the reader's web of trust voted each item up and down,
 * keyed by item identity, with an entry for every item. `ranks` are the
 * reader's scorer's (services/trust `fetchAuthorRanks`); `rankMore`, when
 * given, ranks the voters `ranks` doesn't hold. If it fails, those voters
 * are unranked, so they don't count.
 */
export async function loadReactions(
  items: ItemEvent[],
  ranks: Map<string, number>,
  rankMore?: (pubkeys: string[]) => Promise<Map<string, number>>,
): Promise<Map<string, ReactionCount>> {
  const counts = new Map<string, ReactionCount>();
  /** What a reaction may name, to the identity it reaches: an id by `e`, an address by `a`. */
  const byId = new Map<string, string>();
  const byAddress = new Map<string, string>();
  for (const item of items) {
    const identity = itemIdentity(item);
    counts.set(identity, { up: 0, down: 0 });
    byId.set(item.id, identity);
    const address = coordinateOf(item);
    if (address) byAddress.set(address, identity);
    // A curation copy's identity is its original: a reaction to the original counts too.
    if (parseCoordinate(identity)) byAddress.set(identity, identity);
    else if (HEX64.test(identity)) byId.set(identity, identity);
  }
  if (!items.length) return counts;

  const filters = [...chunked([...byId.keys()], "#e"), ...chunked([...byAddress.keys()], "#a")];
  const reactions = await readRelays(listRelays(), filters).catch(() => [] as NostrEvent[]);

  /** The item a reaction reaches: by its address when it names one we hold, else by an id. */
  const reached = (ev: NostrEvent): string | null => {
    const named = (tag: string, map: Map<string, string>) =>
      ev.tags
        .filter((t) => t[0] === tag && typeof t[1] === "string")
        .map((t) => map.get(t[1]))
        .filter((identity): identity is string => !!identity);
    return named("a", byAddress).at(-1) ?? named("e", byId).at(-1) ?? null;
  };

  /** The votes, each with the item it reaches. */
  const votes = reactions.flatMap((ev) => {
    const vote = ev.kind === 7 ? voteOf(ev) : null;
    const identity = vote ? reached(ev) : null;
    return vote && identity ? [{ ev, vote, identity }] : [];
  });

  let known = ranks;
  const unranked = [...new Set(votes.map((v) => v.ev.pubkey))].filter((pk) => !ranks.has(pk));
  if (rankMore && unranked.length) {
    const more = await rankMore(unranked).catch(() => new Map<string, number>());
    known = new Map([...ranks, ...more]);
  }

  /** Each person's latest vote on each item. */
  const latest = new Map<string, { identity: string; vote: Vote; at: NostrEvent }>();
  for (const { ev, vote, identity } of votes) {
    if (!inWebOfTrust(known, ev.pubkey)) continue;
    const key = JSON.stringify([identity, ev.pubkey]);
    const held = latest.get(key)?.at;
    if (!held || ev.created_at > held.created_at || (ev.created_at === held.created_at && ev.id < held.id)) {
      latest.set(key, { identity, vote, at: ev });
    }
  }

  for (const { identity, vote } of latest.values()) {
    const count = counts.get(identity);
    if (count) count[vote === "+" ? "up" : "down"] += 1;
  }
  return counts;
}
