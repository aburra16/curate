/**
 * The events Curate writes about an item, as unsigned templates: a vote, a
 * deletion, an edit that keeps every tag the item carries, and the count a
 * vote button shows once the reader has voted.
 */
import type { EventTemplate } from "@/lib/conceptCopy";
import { endorsementTemplate } from "@/lib/itemEngagement";
import { DCOSL } from "@/services/relays";

/** A reader's vote on an item: NIP-25's "+" is up and "-" is down. */
export type Vote = "+" | "-";

/** An item's up and down votes, and the reader's own vote on it. */
export interface ReactionCount {
  up: number;
  down: number;
  mine: Vote | null;
}

type Signed = { id: string; kind: number; pubkey: string; tags: string[][]; content: string };

/**
 * The reaction a reader signs to vote on an item: the endorsement, with the
 * vote as its content. Every pointer is hinted at `relayHint`, the list relay
 * by default.
 */
export function voteTemplate(item: Signed, vote: Vote, relayHint: string = DCOSL): EventTemplate {
  return { ...endorsementTemplate(item, relayHint), content: vote };
}

/**
 * The deletion of an item: each version's id once, in the order given, then
 * the item's address when it is a kind 39999 with a `d` (so a version a relay
 * holds but the reader never saw goes too), then its kind.
 */
export function deletionTemplate(item: Signed, versionIds: string[]): EventTemplate {
  const tags: string[][] = [...new Set(versionIds)].map((id) => ["e", id]);
  const d = item.tags.find((t) => t[0] === "d")?.[1];
  if (item.kind === 39999 && d != null) tags.push(["a", `${item.kind}:${item.pubkey}:${d}`]);
  tags.push(["k", String(item.kind)]);
  return { kind: 5, content: "", tags };
}

/**
 * An item's tags with some fields changed, every other tag kept in place.
 * A value replaces the value of the field's first tag and keeps whatever
 * follows it on that tag; an empty value removes that first tag only; a field
 * with no tag yet is appended as `[name, value]`, unless the value is empty.
 * The tags it is given are not changed.
 */
export function patchItemTags(tags: string[][], changes: Record<string, string>): string[][] {
  const patched = tags.map((t) => [...t]);
  for (const [name, value] of Object.entries(changes)) {
    const at = patched.findIndex((t) => t[0] === name);
    if (at >= 0 && value === "") patched.splice(at, 1);
    else if (at >= 0) patched[at][1] = value;
    else if (value !== "") patched.push([name, value]);
  }
  return patched;
}

/**
 * The item republished with some fields changed: the same kind 39999 and
 * content, and every tag it has (its `d`, `z`, `alt`, repeated and
 * undeclared tags) kept, only the changed fields' tags different.
 */
export function editedItemTemplate(item: Signed, changes: Record<string, string>): EventTemplate {
  return { kind: 39999, content: item.content, tags: patchItemTags(item.tags, changes) };
}

/**
 * The count after the reader votes `next`. The same vote again changes
 * nothing. Otherwise `mine` is `next`, and when the reader is one of the
 * people the count is made of (`readerCounts`), their old vote leaves its side
 * and the new one joins the other. A side never goes below zero, though the
 * count it started from was stale.
 */
export function applyVote(count: ReactionCount, next: Vote, readerCounts: boolean): ReactionCount {
  if (next === count.mine) return count;
  if (!readerCounts) return { ...count, mine: next };
  let { up, down } = count;
  if (count.mine === "+") up = Math.max(0, up - 1);
  if (count.mine === "-") down = Math.max(0, down - 1);
  if (next === "+") up += 1;
  else down += 1;
  return { up, down, mine: next };
}
