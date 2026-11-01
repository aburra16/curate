/**
 * What an item or a list is connected to, read from the list relays (and
 * the tag hub, for tags) through the reader's web of trust:
 *
 * - **Lists:** the lists an item names in its `z`, each by its header's name.
 *   An item with no `z` is filed by its `e` under a 9998 list, once that id
 *   is read to be a list header.
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
 * its address, and, for a curation copy (`isCuration`), its original.
 *
 * A relay may send what it wasn't asked for, so every event read is checked
 * against what was asked. A relay that doesn't answer reads as nothing and
 * is named in `unread`. What was read is kept per event for the session,
 * unless a relay didn't answer: then the next call reads again. Who counts
 * is decided on each call, so ranks that arrive later fold anew without a
 * read. The people involved are known only once the reads are in, so a
 * caller whose ranks cover some people (a list's authors) passes `rankMore`,
 * asked once per call for everyone else. Copies and mentions fold only for
 * authors the scorer answered for. Ranks never leave this module.
 */
import type { Filter, NostrEvent } from "nostr-tools";
import { HONORED_TAGGING_AUTHORITIES } from "@/config/tagging";
import { isBlankEvent } from "@/lib/blankEvent";
import { coordinateOf, headerReferenceOf, isDListHeader, isDListItem, parseCoordinate } from "@/lib/dlistFields";
import { newestPerAddress } from "@/lib/newestPerAddress";
import { classifyEventTaggings, type ClassifiedTag, type TagRef } from "@/lib/tagging/classify";
import { filterTagsAppliedToEvent } from "@/lib/tagging/filters";
import { tagElementAddr } from "@/lib/tagging/handles";
import { isCuration } from "@/services/concepts";
import { jsonDataOf, namesOf } from "@/services/jsonData";
import { readRelaysReporting, type RelayRead } from "@/services/nostr";
import { listRelays, TAG_HUB } from "@/services/relays";
import { inWebOfTrust } from "@/services/trust";

/** A copy or a mention, with the list it is on: its first `z` (or, with none, the 9998 its `e` names), by name when that header was read. */
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

/**
 * What an event with no `z` at all is filed under: its `e`, as a 9998 list is
 * named by its header's id (`headerReferenceOf`, which `filedHere` follows
 * too). It is a list only once what it names is read to be a list header.
 */
const filedByE = (ev: NostrEvent): string | null => {
  if (ev.tags.some((t) => t[0] === "z")) return null;
  const ref = headerReferenceOf(ev);
  return isHandle(ref ?? undefined) ? ref : null;
};

/** Every handle an event may be filed under, in order: its `z`s, else its `e`. */
const listCandidates = (ev: NostrEvent): string[] => {
  const byE = filedByE(ev);
  return byE ? [byE] : zHandles(ev);
};

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
  /** The list references that were read to be list headers, named or not. */
  listHeaders: Set<string>;
  unread: string[];
}

async function gather(event: NostrEvent): Promise<Gathered> {
  const header = isDListHeader(event);
  const own = addressOfEvent(event);
  const named = new Set<string>([event.id, ...(own ? [own] : [])]);
  // A curation copy is its original too, by every handle its `q` gives for it: its id and its address.
  if (isCuration(event)) {
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
  /** A curation copy of this item: a 39999 copy (`d` starting `copy-`, and a `q`) whose `q` names it. */
  const isCopyOfThis = (ev: NostrEvent) => ev.kind === 39999 && isCuration(ev) && namesThis(ev, "q");
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

  const copies = live(copyEvents).filter(isCopyOfThis);
  // A copy is never a mention, whether or not the read of copies was answered.
  const mentions = live(mentionEvents).filter(
    (ev) =>
      isDListItem(ev) &&
      (namesThis(ev, "e") || namesThis(ev, "a")) &&
      !isCopyOfThis(ev) &&
      !isTagging(ev) &&
      !filedHere(ev),
  );
  const taggings = live(taggingEvents).filter(
    (ev) => ev.kind === 39999 && isTagging(ev) && (namesThis(ev, "e") || namesThis(ev, "a")),
  );

  const listRefs = unique([
    ...(header ? [] : listCandidates(event)),
    ...[...copies, ...mentions].map((ev) => listCandidates(ev)[0]).filter((ref) => ref !== undefined),
  ]);
  const readListNames = async () => {
    const coordinates = listRefs.filter((ref) => parseCoordinate(ref));
    const headerIds = listRefs.filter((ref) => HEX64.test(ref));
    const byId = chunks(headerIds).map((chunk): Filter => ({ ids: chunk }));
    const found = await read(lists, [...coordinateFilters(coordinates), ...byId]);
    const names = new Map<string, string>();
    const headers = new Set<string>();
    for (const [ref, h] of atReferences(found, listRefs)) {
      if (isDListHeader(h)) headers.add(ref);
      const name = namesOf(h).plural.trim();
      if (name) names.set(ref, name);
    }
    return { names, headers };
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

  const [{ names: listNames, headers: listHeaders }, { taggingHeaders, tagNames }] = await Promise.all([
    readListNames(),
    readTags(),
  ]);
  return { header, copies, mentions, taggings, taggingHeaders, tagNames, listNames, listHeaders, unread: [...unread] };
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
  /** The lists an event is on: its `z`s, or, with none, the header its `e` names. */
  const listsOf = (ev: NostrEvent): string[] => {
    const byE = filedByE(ev);
    if (!byE) return zHandles(ev);
    return g.listHeaders.has(byE) ? [byE] : [];
  };
  const related = (ev: NostrEvent): Related => {
    const listRef = listsOf(ev)[0] ?? null;
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
    lists: g.header ? [] : unique(listsOf(event)).map((ref) => ({ ref, name: g.listNames.get(ref) ?? null })),
    copies: shown(g.copies),
    tags: [...summaries.values()].sort((a, b) => b.applied - a.applied || a.name.localeCompare(b.name)),
    mentions: shown(g.mentions),
    names,
    folded: { copies: folded(g.copies), mentions: folded(g.mentions) },
    unread: [...g.unread],
  };
}

/** Event id -> what was read about it, this session, when every relay answered. */
const gathered = new Map<string, Promise<Gathered>>();

/** What was read about `event`: kept, unless a relay didn't answer or the read failed. */
function gatheredFor(event: NostrEvent): Promise<Gathered> {
  const held = gathered.get(event.id);
  if (held) return held;
  const read = gather(event);
  gathered.set(event.id, read);
  const forget = () => {
    if (gathered.get(event.id) === read) gathered.delete(event.id);
  };
  read.then((g) => {
    if (g.unread.length) forget();
  }, forget);
  return read;
}

/**
 * What `event` is connected to, as the reader sees it. `ranks` and
 * `answered` are the reader's scorer's (the list page's `useAuthorRanks`):
 * a copy or mention folds when its author was answered for and is outside
 * the line, and a tagging counts only when its author is inside it.
 * `reader` is who is reading, null when no one is signed in. `rankMore`,
 * when given, is the same scorer (services/trust `fetchAuthorRanks`): it is
 * asked once for every tagger, copier and mentioner not in `answered`. If it
 * fails, they are unranked: none of them counts, and none folds.
 */
export async function loadRelationships(
  event: NostrEvent,
  ranks: Map<string, number>,
  answered: ReadonlySet<string>,
  reader: string | null,
  rankMore?: (pubkeys: string[]) => Promise<{ ranks: Map<string, number>; answered?: ReadonlySet<string> }>,
): Promise<Relationships> {
  const g = await gatheredFor(event);
  let known = ranks;
  let heard = answered;
  const unanswered = unique([...g.taggings, ...g.copies, ...g.mentions].map((ev) => ev.pubkey)).filter(
    (pk) => !answered.has(pk),
  );
  if (rankMore && unanswered.length) {
    const more = await rankMore(unanswered).catch(() => null);
    if (more) {
      known = new Map([...ranks, ...more.ranks]);
      heard = new Set([...answered, ...(more.answered ?? [])]);
    }
  }
  return relationshipsOf(event, g, known, heard, reader);
}

/** Forget what was read. Tests start each case from here. */
export function clearRelationshipsCache(): void {
  gathered.clear();
}
