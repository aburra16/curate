/**
 * What an item or a list is connected to, read from the list relays (and
 * the tag hub, for tags) through the reader's web of trust:
 *
 * - **Lists:** the lists an item names in its `z`, each by its header's name.
 * - **Copies:** curation copies of it, 39999s whose `d` starts `copy-` and
 *   whose `q` names it.
 * - **Tags:** taggings of it, counted as Brainstorm counts them
 *   (lib/tagging): only under a header that joins an honoured namespace, and
 *   only people inside the line, each once. The reader's own stance is
 *   returned whether or not it counts, so a tag only they applied stays in
 *   sight.
 * - **Mentions:** other list items (39999, 9999) whose `e` or `a` names it,
 *   not counting copies, taggings or a header's own items.
 * - **Names:** its own `p`, `e`, `a` and `t` values.
 *
 * A list header has no lists and no copies. What names the item is its id,
 * its address, and, for a curation copy (`itemIdentity`), its original.
 *
 * A relay may send what it wasn't asked for, so every event read is checked
 * against what was asked. A relay that doesn't answer reads as nothing and
 * is named in `unread`. What was read is kept per event for the session; who
 * counts is decided on each call, so ranks that arrive later fold anew
 * without a read. Copies and mentions fold only for authors the scorer
 * answered for. Ranks never leave this module.
 */
import type { Filter, NostrEvent } from "nostr-tools";
import { HONORED_TAGGING_AUTHORITIES } from "@/config/tagging";
import { isBlankEvent } from "@/lib/blankEvent";
import { coordinateOf, isDListHeader, isDListItem, parseCoordinate } from "@/lib/dlistFields";
import { newestPerAddress } from "@/lib/newestPerAddress";
import { classifyEventTaggings, type ClassifiedTag, type TagRef } from "@/lib/tagging/classify";
import { filterTagsAppliedToEvent } from "@/lib/tagging/filters";
import { tagElementAddr } from "@/lib/tagging/handles";
import { itemIdentity } from "@/services/concepts";
import { jsonDataOf, namesOf } from "@/services/jsonData";
import { readRelaysReporting, type RelayRead } from "@/services/nostr";
import { listRelays, TAG_HUB } from "@/services/relays";
import { inWebOfTrust } from "@/services/trust";

/** A copy or a mention, with the list it is on: its first `z`, by name when that header was read. */
export interface Related {
  event: NostrEvent;
  listName: string | null;
  listRef: string | null;
}

/** A tag on the item: how many people inside the line applied and disputed it, and the reader's own stance. */
export interface TagSummary {
  name: string;
  /** The tag element's coordinate. */
  address: string;
  applied: number;
  disputed: number;
  mine: "apply" | "dispute" | null;
}

export interface Relationships {
  /** The lists the item names in its `z`, in its order; [] for a header. */
  lists: { ref: string; name: string | null }[];
  copies: Related[];
  tags: TagSummary[];
  mentions: Related[];
  names: { tag: "p" | "e" | "a" | "t"; value: string }[];
  /** Copies and mentions by authors the scorer answered for, outside the line. */
  folded: { copies: Related[]; mentions: Related[] };
  /** The relays that didn't answer a read. */
  unread: string[];
}

/** Values per filter: a filter of thousands of values is one no relay takes. */
const CHUNK = 100;
const HEX64 = /^[0-9a-f]{64}$/i;
/** A tagging names its per-tag header in a `z` of this shape (lib/tagging/handles `taggingHeaderAddr`). */
const DESCRIPTOR = /^39999:[0-9a-f]{64}:tagging:.+-tagging$/;
const NAMED_TAGS = ["p", "e", "a", "t"] as const;
type NamedTag = (typeof NAMED_TAGS)[number];
const isNamedTag = (tag: string): tag is NamedTag => (NAMED_TAGS as readonly string[]).includes(tag);

/** What a header can be named by: a coordinate or an event id. Anything else in a `z` is a hint. */
const isHandle = (value: string | undefined): value is string =>
  !!value && (parseCoordinate(value) !== null || HEX64.test(value));

const chunks = <T>(values: T[]): T[][] =>
  Array.from({ length: Math.ceil(values.length / CHUNK) }, (_, i) => values.slice(i * CHUNK, (i + 1) * CHUNK));

const unique = <T>(values: Iterable<T>): T[] => [...new Set(values)];

/** The address of an addressable event; null for any other, whatever `d` it carries. */
const addressOfEvent = (ev: NostrEvent): string | null =>
  ev.kind >= 30000 && ev.kind < 40000 ? coordinateOf(ev) : null;

const zHandles = (ev: NostrEvent): string[] =>
  ev.tags.filter((t) => t[0] === "z" && isHandle(t[1])).map((t) => t[1]);

const isTagging = (ev: NostrEvent): boolean => ev.tags.some((t) => t[0] === "z" && DESCRIPTOR.test(t[1] ?? ""));

/** Filters for the events at these coordinates: one per kind and author, its `d`s in chunks. */
function coordinateFilters(coordinates: string[]): Filter[] {
  const groups = new Map<string, { kind: number; pubkey: string; ds: string[] }>();
  for (const value of coordinates) {
    const c = parseCoordinate(value);
    if (!c) continue;
    const key = `${c.kind}:${c.pubkey}`;
    const group = groups.get(key) ?? { kind: c.kind, pubkey: c.pubkey, ds: [] };
    group.ds.push(c.d);
    groups.set(key, group);
  }
  return [...groups.values()].flatMap((g) =>
    chunks(g.ds).map((ds): Filter => ({ kinds: [g.kind], authors: [g.pubkey], "#d": ds })),
  );
}

/** Of these events, the newest at each of the coordinates or ids asked for, by the reference that asked. */
function atReferences(events: NostrEvent[], refs: string[]): Map<string, NostrEvent> {
  const wanted = new Set(refs);
  const refsOf = (ev: NostrEvent) => [ev.id, addressOfEvent(ev)].filter((r): r is string => !!r && wanted.has(r));
  const found = new Map<string, NostrEvent>();
  for (const ev of newestPerAddress(events.filter((e) => refsOf(e).length))) {
    for (const ref of refsOf(ev)) found.set(ref, ev);
  }
  return found;
}

/** A tag element's name: its `name` tag, its `names`, the name in its content (as Brainstorm writes one), else null. */
function elementName(el: NostrEvent): string | null {
  const tagged = (name: string) => el.tags.find((t) => t[0] === name)?.[1]?.trim() || null;
  const json = jsonDataOf(el, "tag")?.name;
  return tagged("name") ?? tagged("names") ?? (typeof json === "string" && json.trim() ? json.trim() : null);
}

/** What was read about one event, before anyone's trust is applied. */
interface Gathered {
  header: boolean;
  copies: NostrEvent[];
  mentions: NostrEvent[];
  taggings: NostrEvent[];
  taggingHeaders: NostrEvent[];
  /** Tag element coordinate -> its name, for the elements found. */
  tagNames: Map<string, string>;
  /** List reference -> its header's plural name, for the headers found. */
  listNames: Map<string, string>;
  unread: string[];
}

async function gather(event: NostrEvent): Promise<Gathered> {
  const header = isDListHeader(event);
  const own = addressOfEvent(event);
  const named = new Set<string>([event.id, ...(own ? [own] : [])]);
  // A curation copy is its original too, by every handle its `q` gives for it: its id and its address.
  if (itemIdentity(event) !== (coordinateOf(event) ?? event.id)) {
    for (const t of event.tags) if (t[0] === "q" && isHandle(t[1])) named.add(t[1]);
  }
  const ids = [...named].filter((v) => HEX64.test(v));
  const addresses = [...named].filter((v) => parseCoordinate(v));

  const lists = listRelays();
  const tagRelays = unique([...lists, TAG_HUB]);
  const unread = new Set<string>();

  /** One read; the relays that didn't end it with EOSE are unread. */
  const read = async (relays: string[], filters: Filter[]): Promise<NostrEvent[]> => {
    if (!filters.length) return [];
    const empty: RelayRead = { events: [], outcomes: {} };
    const answer = await readRelaysReporting(relays, filters).catch(() => empty);
    for (const relay of relays) if (answer.outcomes[relay]?.end.state !== "eose") unread.add(relay);
    return answer.events;
  };

  const isSelf = (ev: NostrEvent) => ev.id === event.id || (own !== null && addressOfEvent(ev) === own);
  const live = (events: NostrEvent[]) => newestPerAddress(events).filter((ev) => !isSelf(ev) && !isBlankEvent(ev));
  const namesThis = (ev: NostrEvent, letter: string) => ev.tags.some((t) => t[0] === letter && named.has(t[1]));
  /** A header's own items name it too (by `z`, or by `e` with no `z`): they are its items, not mentions. */
  const filedHere = (ev: NostrEvent) => {
    if (!header) return false;
    const z = ev.tags.filter((t) => t[0] === "z");
    return z.length ? z.some((t) => named.has(t[1])) : namesThis(ev, "e");
  };

  const kinds = [39999, 9999];
  const [copyEvents, mentionEvents, taggingEvents] = await Promise.all([
    header ? [] : read(lists, [{ kinds: [39999], "#q": [...named] }]),
    read(lists, [
      ...(ids.length ? [{ kinds, "#e": ids }] : []),
      ...(addresses.length ? [{ kinds, "#a": addresses }] : []),
    ]),
    read(tagRelays, [
      ...ids.map((id) => filterTagsAppliedToEvent({ target: { id } })),
      ...addresses.map((address) => filterTagsAppliedToEvent({ target: { address } })),
    ]),
  ]);

  const copies = live(copyEvents).filter(
    (ev) => ev.kind === 39999 && !!ev.tags.find((t) => t[0] === "d")?.[1]?.startsWith("copy-") && namesThis(ev, "q"),
  );
  const copyIds = new Set(copies.map((ev) => ev.id));
  const mentions = live(mentionEvents).filter(
    (ev) =>
      isDListItem(ev) &&
      (namesThis(ev, "e") || namesThis(ev, "a")) &&
      !copyIds.has(ev.id) &&
      !isTagging(ev) &&
      !filedHere(ev),
  );
  const taggings = live(taggingEvents).filter((ev) => ev.kind === 39999 && (namesThis(ev, "e") || namesThis(ev, "a")));

  const listRefs = unique([
    ...(header ? [] : zHandles(event)),
    ...[...copies, ...mentions].map((ev) => zHandles(ev)[0]).filter((ref) => ref !== undefined),
  ]);
  const readListNames = async () => {
    const coordinates = listRefs.filter((ref) => parseCoordinate(ref));
    const headerIds = listRefs.filter((ref) => HEX64.test(ref));
    const byId = chunks(headerIds).map((chunk): Filter => ({ ids: chunk }));
    const found = await read(lists, [...coordinateFilters(coordinates), ...byId]);
    const byRef = new Map<string, string>();
    for (const [ref, h] of atReferences(found, listRefs)) {
      const name = namesOf(h).plural.trim();
      if (name) byRef.set(ref, name);
    }
    return byRef;
  };

  const readTags = async () => {
    const descriptors = unique(
      taggings.flatMap((ev) => ev.tags.filter((t) => t[0] === "z" && DESCRIPTOR.test(t[1] ?? "")).map((t) => t[1])),
    );
    const headersRead = await read(tagRelays, coordinateFilters(descriptors));
    const taggingHeaders = [...atReferences(headersRead, descriptors).values()];
    // Every tag a tagging here could count for, whoever is trusted: the names are read once, whatever the ranks.
    const { tags } = classifyEventTaggings({
      candidates: taggings,
      headers: taggingHeaders,
      honoredAuthorities: HONORED_TAGGING_AUTHORITIES,
      isAsserterTrusted: () => true,
    });
    const elements = unique(tags.map((t) => tagElementAddr(t.tag.authorPubkey, t.tag.slug)));
    const tagNames = new Map<string, string>();
    const elementsRead = await read(tagRelays, coordinateFilters(elements));
    for (const [address, el] of atReferences(elementsRead, elements)) {
      const name = elementName(el);
      if (name) tagNames.set(address, name);
    }
    return { taggingHeaders, tagNames };
  };

  const [listNames, { taggingHeaders, tagNames }] = await Promise.all([readListNames(), readTags()]);
  return { header, copies, mentions, taggings, taggingHeaders, tagNames, listNames, unread: [...unread] };
}

/** People, not events: each person's latest stance on the tag. */
function countPeople(tag: ClassifiedTag): { applied: number; disputed: number } {
  const latest = new Map<string, { at: number; applies: boolean }>();
  const note = (author: string, at: number, applies: boolean) => {
    const held = latest.get(author);
    if (!held || at > held.at) latest.set(author, { at, applies });
  };
  for (const e of tag.applications) note(e.authorPubkey, e.createdAt, true);
  for (const e of tag.disputes) note(e.authorPubkey, e.createdAt, false);
  const applied = [...latest.values()].filter((s) => s.applies).length;
  return { applied, disputed: latest.size - applied };
}

function relationshipsOf(
  event: NostrEvent,
  g: Gathered,
  ranks: Map<string, number>,
  answered: ReadonlySet<string>,
  reader: string | null,
): Relationships {
  const trusted = (pubkey: string) => inWebOfTrust(ranks, pubkey);
  const outside = (ev: NostrEvent) => answered.has(ev.pubkey) && !trusted(ev.pubkey);
  const related = (ev: NostrEvent): Related => {
    const listRef = zHandles(ev)[0] ?? null;
    return { event: ev, listRef, listName: listRef ? (g.listNames.get(listRef) ?? null) : null };
  };
  const shown = (events: NostrEvent[]) => events.filter((ev) => !outside(ev)).map(related);
  const folded = (events: NostrEvent[]) => events.filter(outside).map(related);

  const { tags, mine } = classifyEventTaggings({
    candidates: g.taggings,
    headers: g.taggingHeaders,
    honoredAuthorities: HONORED_TAGGING_AUTHORITIES,
    isAsserterTrusted: trusted,
    viewerPubkey: reader ?? undefined,
  });
  const summaries = new Map<string, TagSummary>();
  const summaryOf = (ref: TagRef): TagSummary => {
    const address = tagElementAddr(ref.authorPubkey, ref.slug);
    const held = summaries.get(address);
    if (held) return held;
    const name = g.tagNames.get(address) ?? ref.slug;
    const fresh: TagSummary = { name, address, applied: 0, disputed: 0, mine: null };
    summaries.set(address, fresh);
    return fresh;
  };
  for (const t of tags) Object.assign(summaryOf(t.tag), countPeople(t));
  for (const m of mine) summaryOf(m.tag).mine = m.stance;

  const seen = new Set<string>();
  const names: Relationships["names"] = [];
  for (const [tag, value] of event.tags) {
    if (!isNamedTag(tag) || typeof value !== "string" || !value) continue;
    const key = `${tag}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    names.push({ tag, value });
  }

  return {
    lists: g.header ? [] : unique(zHandles(event)).map((ref) => ({ ref, name: g.listNames.get(ref) ?? null })),
    copies: shown(g.copies),
    tags: [...summaries.values()].sort((a, b) => b.applied - a.applied || a.name.localeCompare(b.name)),
    mentions: shown(g.mentions),
    names,
    folded: { copies: folded(g.copies), mentions: folded(g.mentions) },
    unread: [...g.unread],
  };
}

/** Event id -> what was read about it, this session. */
const gathered = new Map<string, Promise<Gathered>>();

/**
 * What `event` is connected to, as the reader sees it. `ranks` and
 * `answered` are the reader's scorer's (the list page's `useAuthorRanks`):
 * a copy or mention folds when its author was answered for and is outside
 * the line, and a tagging counts only when its author is inside it.
 * `reader` is who is reading, null when no one is signed in.
 */
export async function loadRelationships(
  event: NostrEvent,
  ranks: Map<string, number>,
  answered: ReadonlySet<string>,
  reader: string | null,
): Promise<Relationships> {
  let read = gathered.get(event.id);
  if (!read) {
    read = gather(event);
    gathered.set(event.id, read);
    read.catch(() => gathered.delete(event.id));
  }
  return relationshipsOf(event, await read, ranks, answered, reader);
}

/** Forget what was read. Tests start each case from here. */
export function clearRelationshipsCache(): void {
  gathered.clear();
}
