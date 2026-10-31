/**
 * Concepts, and what makes an item the same item. Pure: nothing here reads a
 * relay (services/listReads does that); it decides what the events it is
 * handed mean.
 *
 * A concept is the set of headers that are one list under different
 * authors. Headers say so with `b`: a header whose first `b` names another
 * coordinate is a **copy** of it (lib/conceptResolution `versionOf`, one hop,
 * never followed further), a header that names itself is **canonical**, a
 * header only others name is **pointed-at**, and one nobody names is
 * **standalone**. A header that declares `["b", "b-tag-deferred"]` has
 * considered the concept and joined none: it is **withdrawn**, listed with
 * the concept it opted out of, never counted among its copies.
 *
 * An item is filed under a header by `z` (a 9998 header: its event id, or an
 * `e`); one item may be stamped under several copies of the same concept, or
 * be a curation copy of another, and still be one item. `itemIdentity`,
 * `distinctItems`, `itemFilters` and `filedItems` follow Brainstorm-UI's
 * services/dictionary.ts at the pinned commit, so a list counts the same
 * here as there.
 */
import type { Filter } from "nostr-tools";
import { isBlankEvent } from "@/lib/blankEvent";
import { B_DEFERRED, bLinksOf, isSelfDeclared, versionOf, type HeaderEvent } from "@/lib/conceptResolution";
import {
  DLIST_ITEM_KINDS,
  addressOf,
  coordinateOf,
  formatCoordinate,
  headerReferenceOf,
  isDListHeader,
  isDListItem,
  parseCoordinate,
} from "@/lib/dlistFields";
import { parseListRef } from "@/lib/listRef";
import { newestPerAddress } from "@/lib/newestPerAddress";

export interface ConceptGroup {
  /** The community coordinate the copies point at (a 9998 header: its event id). */
  root: string;
  /** Null: the root's header wasn't fetched, or was blank, or has withdrawn. Shown as "header not found". */
  rootHeader: HeaderEvent | null;
  kind: "canonical" | "pointed-at" | "standalone";
  /** Headers whose `b` names the root, newest first. */
  copies: HeaderEvent[];
  /**
   * Headers carrying `["b", "b-tag-deferred"]`, newest first. A withdrawn
   * header that fits no concept is a group of its own: `kind` "standalone",
   * `rootHeader` that header, which is also this group's only `withdrawn`.
   */
  withdrawn: HeaderEvent[];
}

const HEX64 = /^[0-9a-f]{64}$/i;

/** What a header can be named by: a `kind:pubkey:d` coordinate, or a 64-hex event id. Anything else is a hint. */
const isHandle = (value: string): boolean => parseCoordinate(value) !== null || HEX64.test(value);

/**
 * Withdrawn: the sentinel and no real affiliation. A header that carries the
 * sentinel and also points somewhere is affiliated, as it is to
 * `bLinksOf`/`versionOf`, which never count the sentinel as a link.
 */
const isWithdrawn = (h: HeaderEvent): boolean =>
  h.tags.some((t) => t[0] === "b" && t[1] === B_DEFERRED) && bLinksOf(h).length === 0;

/**
 * What a header is named by, and its items filed under: its coordinate when
 * its kind is addressable (30000 to 39999: a 39998, or a 39999 that declares
 * itself a header), else its event id (a 9998, whatever `d` it carries). An
 * addressable header with no `d` has no coordinate, and goes by its id. A
 * concept's root, its copies and its versions are all named this way.
 */
export function handleOf(h: HeaderEvent): string {
  const addressable = h.kind >= 30000 && h.kind < 40000;
  return (addressable && coordinateOf(h)) || h.id;
}

const dOf = (h: HeaderEvent): string | undefined => h.tags.find((t) => t[0] === "d" && t[1] != null)?.[1];

interface Draft {
  root: string;
  rootHeader: HeaderEvent | null;
  copies: HeaderEvent[];
  withdrawn: HeaderEvent[];
}

/**
 * Headers grouped into concepts. Each address is reduced to its newest
 * version first; a blank one (lib/blankEvent) is set apart and takes part in
 * nothing, so a header blanked since doesn't come back as its older self.
 * Groups come newest first, by the newest header each holds.
 */
export function groupConcepts(headers: HeaderEvent[]): { groups: ConceptGroup[]; blank: HeaderEvent[] } {
  const newest = newestPerAddress(headers);
  const blank = newest.filter(isBlankEvent);
  const live = newest.filter((h) => !isBlankEvent(h));
  const withdrawn = live.filter(isWithdrawn);
  const affiliated = live.filter((h) => !isWithdrawn(h));
  const place = new Map(newest.map((h, i) => [h, i]));

  const rootsByKey = new Map(affiliated.map((h) => [handleOf(h), h]));
  const drafts = new Map<string, Draft>();
  const draftFor = (root: string): Draft => {
    let draft = drafts.get(root);
    if (!draft) {
      draft = { root, rootHeader: rootsByKey.get(root) ?? null, copies: [], withdrawn: [] };
      drafts.set(root, draft);
    }
    return draft;
  };
  for (const h of affiliated) {
    const root = versionOf(h);
    if (root) draftFor(root).copies.push(h);
    else draftFor(handleOf(h));
  }

  // A withdrawn header goes with the concept it opted out of: the one at its own address, else the only one
  // of its name. Two concepts of one name are a guess, so it stands alone rather than pick.
  const known = [...drafts.values()];
  const loners: Draft[] = [];
  for (const h of withdrawn) {
    const d = dOf(h);
    const named = d === undefined ? [] : known.filter((g) => parseCoordinate(g.root)?.d === d);
    const home = drafts.get(handleOf(h)) ?? (named.length === 1 ? named[0] : undefined);
    if (home) home.withdrawn.push(h);
    else loners.push({ root: handleOf(h), rootHeader: h, copies: [], withdrawn: [h] });
  }

  const newestHeld = (g: Draft) =>
    Math.min(...[g.rootHeader, ...g.copies, ...g.withdrawn].map((h) => (h ? (place.get(h) ?? Infinity) : Infinity)));
  const groups = [...known, ...loners]
    .sort((a, b) => newestHeld(a) - newestHeld(b))
    .map((g): ConceptGroup => ({
      ...g,
      kind: g.rootHeader && isSelfDeclared(g.rootHeader) ? "canonical" : g.copies.length ? "pointed-at" : "standalone",
    }));
  return { groups, blank };
}

/**
 * What a list's link names: its address, or one version of it by id. Pasted
 * and linked forms alike: `kind:pubkey:d`, an `naddr`, a 64-hex id, a `note`
 * or an `nevent`, with or without `nostr:`. Null for anything that isn't a
 * list header.
 */
export type ConceptRef = { coordinate: string } | { id: string };

export function conceptRefOf(c: string): ConceptRef | null {
  const ref = parseListRef(c);
  if (ref) return ref.type === "address" ? { coordinate: ref.coordinate } : { id: ref.id };
  // lib/listRef takes 39998 addresses; a 39999 that declares itself a header is a list too.
  const address = parseCoordinate(addressOf(c));
  return address?.kind === 39999 ? { coordinate: formatCoordinate(address) } : null;
}

/** What items of this concept are filed under: its root and every copy, each by `handleOf`. */
export function conceptHandles(g: ConceptGroup): string[] {
  return [...new Set([g.root, ...g.copies.map(handleOf)])];
}

export interface ItemEvent {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
}

const zValues = (ev: { tags: string[][] }) => ev.tags.filter((t) => t[0] === "z" && t[1]).map((t) => t[1]);

/**
 * What makes two events one item: a curation copy is its original (its
 * address `q`, else its version `q`); an addressable item is its
 * coordinate; anything else is its id.
 */
export function itemIdentity(ev: ItemEvent): string {
  const d = ev.tags.find((t) => t[0] === "d")?.[1];
  if (d?.startsWith("copy-")) {
    const q = ev.tags.filter((t) => t[0] === "q" && t[1]);
    const original = q.find((t) => parseCoordinate(t[1])) ?? q[0];
    if (original) return original[1];
  }
  return coordinateOf(ev) ?? ev.id;
}

/** A curation copy: an event that counts as another one. */
const isCuration = (ev: ItemEvent): boolean => itemIdentity(ev) !== (coordinateOf(ev) ?? ev.id);

/**
 * Whether `a` is the version to keep over `b`. The newer. On a tie the
 * original over its copy, then the lower id, NIP-01's rule for two versions
 * of one address, so the choice doesn't depend on which relay answered first.
 */
function beats(a: ItemEvent, b: ItemEvent): boolean {
  if (a.created_at !== b.created_at) return a.created_at > b.created_at;
  const aCopy = isCuration(a);
  if (aCopy !== isCuration(b)) return !aCopy;
  return a.id < b.id;
}

/** The newest version of each item, newest first. A tie keeps the original over its copy. */
export function distinctItems<T extends ItemEvent>(events: T[]): T[] {
  const best = new Map<string, T>();
  for (const ev of events) {
    const key = itemIdentity(ev);
    const cur = best.get(key);
    if (!cur || beats(ev, cur)) best.set(key, ev);
  }
  return [...best.values()].sort((a, b) => b.created_at - a.created_at);
}

/**
 * The filters for the items filed under these handles. A handle is a
 * coordinate (39998) or an event id (9998); a 9998's items name it by `z`, or
 * by `e` when they carry no `z` (lib/dlistFields `headerReferenceOf`), so
 * ids are asked for both ways. Bare names are hints, never asked for.
 * `itemKinds` are the kinds the header declares beside 39999 and 9999.
 * `page` bounds one read: its `limit`, and `until` to continue from.
 */
export function itemFilters(
  handles: string[],
  page?: { limit: number; until?: number },
  itemKinds: number[] = [],
): Filter[] {
  const wanted = [...new Set(handles.filter(isHandle))];
  if (!wanted.length) return [];
  const kinds = [...new Set<number>([...DLIST_ITEM_KINDS, ...itemKinds])];
  const cap = page ? { limit: page.limit, ...(page.until === undefined ? {} : { until: page.until }) } : {};
  const ids = wanted.filter((h) => HEX64.test(h));
  return [{ kinds, "#z": wanted, ...cap }, ...(ids.length ? [{ kinds, "#e": ids, ...cap }] : [])];
}

/**
 * Of these events, the list items filed under these handles: newest version
 * of each, newest first. An item is a 39999 or 9999 that isn't a header
 * (lib/dlistFields `isDListItem`), or an event of one of `itemKinds`, the
 * kinds the header declares beside those (the same ones `itemFilters` asks
 * for, so nothing it fetches is dropped here); a header is never an item,
 * whatever kinds are listed. It is filed by its `z`, or with none by an `e`
 * naming a 64-hex handle (a 9998). A `z` that isn't a coordinate or an id is
 * a hint and files nothing, whether it's on the item or among the handles.
 */
export function filedItems<T extends ItemEvent>(events: T[], handles: string[], itemKinds: number[] = []): T[] {
  const filed = new Set(handles.filter(isHandle));
  const declared = new Set(itemKinds);
  const isItem = (ev: T) => isDListItem(ev) || (declared.has(ev.kind) && !isDListHeader(ev));
  const isFiled = (ev: T) => {
    const z = zValues(ev);
    if (z.length) return z.some((v) => filed.has(v));
    const e = headerReferenceOf(ev) ?? "";
    return HEX64.test(e) && filed.has(e);
  };
  return distinctItems(events.filter(isItem).filter(isFiled));
}

/**
 * Where a list read goes after a page. Pages run newest first and end at a
 * second, but a relay answers `until = T` with the same first `limit` events
 * every time, so a second holding more events than a page can't be read by
 * paging. A page that came back full therefore says which second to complete
 * (`fillSecond`: read `{since, until}` both that second, up to a relay's
 * limit) and where to resume (`until`: the second before). A short page is
 * the last: both null.
 *
 * Also null when a full page doesn't get any older than the `until` it was
 * asked for: a relay that ignores `until` would otherwise be asked forever.
 *
 * The page's ids are added to `seen`, the caller's set for dropping repeats
 * (the fill of a second sends its page's events again). Call it with the
 * page as it came back.
 */
export function nextPage(
  events: ItemEvent[],
  page: { limit: number; until?: number },
  seen: Set<string>,
): { until: number | null; fillSecond: number | null } {
  let oldest = Infinity;
  for (const ev of events) {
    seen.add(ev.id);
    if (ev.created_at < oldest) oldest = ev.created_at;
  }
  const last = { until: null, fillSecond: null };
  if (!events.length || events.length < page.limit) return last;
  const until = oldest - 1;
  if (page.until !== undefined && until >= page.until) return last;
  return { until, fillSecond: oldest };
}
