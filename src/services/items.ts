/**
 * A list's items, read the way a list page shows them: the
 * events of the list's kinds filed under its handles (services/concepts
 * `itemFilters`/`filedItems`), newest version of each, newest first.
 *
 * **Pages** are 500, newest first, and each relay side keeps its own cursor:
 * the hub (dcosl, plus the relays the reader added) and the index answer
 * the same filters with different events, so each page ends at its own
 * second. One merged cursor would go on from the older of the two and skip
 * what only the other holds between them. Within a side, each relay and
 * each filter pages on its own for the same reason, and the side goes on
 * from the newest second any of them stopped at. A page that comes back full has
 * its oldest second read to the end (`nextPage`'s `fillSecond`: a bulk
 * import can put more than a page into one second; on 31 October one of
 * Food's held 6,717), then the side goes on from the second before. So a
 * page can hold far more than 500 items, and take seconds to check.
 *
 * **A crowded second can be fuller than a relay sends.** For one filter,
 * dcosl sends 10,000 events at most and the index 5,000 (checked live on 31
 * October: Food's crowded second came back as 5,000 and EOSE), each ending
 * in EOSE as if that were all. A read of a crowded second that comes back
 * with as many as its relay sends may not hold the whole second: the side
 * goes on, and the page says so (`truncated`: which relay, which second). A
 * read by dcosl or the index below its cap that ended in EOSE did hold all
 * of it (`filled`), and then nothing of that second was lost, whichever page
 * read it. `lostSeconds` says which seconds a list has lost for good.
 *
 * **A side goes on past a page, or past a crowded second, only when that
 * read ended in EOSE.** A page that comes back short and ended is the
 * side's last. A read of dcosl or the index that ended any other way (a
 * refusal, a timeout, a failure) is not taken for an answer:
 * - one that sent events is read again from the oldest second it sent:
 *   a relay sends the newest first, so what it didn't send is there or
 *   older;
 * - a crowded second's read that ended so, with events or without, holds
 *   the side at that second;
 * - a page that sent nothing holds the side where it was, and the page
 *   says it `stalled`, so "Load more" can say a relay didn't answer. On the
 *   first page, dcosl holds the hub `NOT_STARTED`: the index can't stand in
 *   for it, since it cuts a crowded second at 5,000. The index sending
 *   nothing on the first page ends its side: refusing, it leaves the list
 *   to dcosl.
 * A relay the reader added never holds the hub: a read of it that fails, on
 * any page, ends it, what it sent is kept, and the cursor's `skip` names it
 * so later pages don't ask it. The relay-status store has why.
 *
 * **Blank items are handed over, not dropped.** An item blanked since (its
 * newest version a husk, lib/blankEvent) can still come in, older, from a
 * lagging index on a later page; only the blank tells whoever holds the
 * list that it's gone. So pages and live items are merged by identity,
 * newest wins, blank versions kept (`mergePages`), and blank items are
 * left out only when shown (`shownItems`). The two sides overlap too, so
 * one item can come in on two pages; within a page each item is there once.
 *
 * **New items** arrive live on the hub from the second the list's first
 * read began (`since`), so nothing listed while it loaded is missed. **Counts** and
 * **search** are the index's alone: dcosl has neither COUNT nor full-text
 * search.
 */
import type { Filter, NostrEvent } from "nostr-tools";
import { isBlankEvent } from "@/lib/blankEvent";
import { distinctItems, filedItems, itemFilters, nextPage, type ItemEvent } from "@/services/concepts";
import {
  countIndex,
  readIndex,
  readIndexReporting,
  readRelaysReporting,
  subscribeLive,
  type RelayRead,
} from "@/services/nostr";
import { DCOSL, INDEX, listRelays } from "@/services/relays";

/** Items per page, per filter, per relay side. */
export const PAGE_SIZE = 500;
/** The most dcosl sends for one filter (team cookbook): what reading a crowded second asks for. */
const FILL_LIMIT = 10_000;
/** The most the index sends for one filter, however high the limit (verified live, 31 October 2026). */
const INDEX_FILTER_CAP = 5_000;
/** How long a page's read waits for each relay, as any read does. */
const PAGE_TIMEOUT_MS = 8000;
/**
 * How long a crowded second's read waits: up to 10,000 events, megabytes
 * of them, each checked (Brainstorm-UI gives such a read 20 s too).
 */
const FILL_TIMEOUT_MS = 20_000;
/** How many items a word search of one list asks the index for. */
const SEARCH_LIMIT = 200;

/** A side whose first page is still to be read: dcosl didn't answer it. */
export const NOT_STARTED = "not-started";

/**
 * Where one side goes on from: the `until` of its next page; `NOT_STARTED`,
 * its first page again; null, nowhere: it has finished, and isn't asked again.
 */
export type SideCursor = number | null | typeof NOT_STARTED;

/**
 * Where each side goes on from. Absent: its first page. `skip`: relays the
 * reader added that failed, which the hub no longer asks.
 */
export interface ItemsCursor {
  hub?: SideCursor;
  index?: SideCursor;
  skip?: string[];
}

/** A crowded second's read by one relay of one of the list's filters (`itemFilters`, by its tag: "#z" or "#e"). */
export interface CrowdedSecond {
  relay: string;
  second: number;
  filter: string;
}

export interface ItemsPage {
  /** This page's items, each once, newest first, blank ones included (merge with `mergePages`). */
  items: ItemEvent[];
  /** The cursor for the next page, or null when both sides have finished. `skip` is there when it names a relay. */
  next: { hub: SideCursor; index: SideCursor; skip?: string[] } | null;
  /** dcosl or the index came back with the cursor it was asked for: it didn't answer, and asking again may. */
  stalled: boolean;
  /**
   * Crowded seconds a relay sent as many events of as it ever sends for one
   * filter, which no read on this page held all of: some of their items may
   * be missing. `lostSeconds` weighs them against every page's `filled`.
   */
  truncated: CrowdedSecond[];
  /** Crowded seconds dcosl or the index read to the end: below its cap, ended in EOSE. */
  filled: CrowdedSecond[];
}

/**
 * One relay's read, the most it sends for one filter, and what a failed read
 * does to its side: dcosl's holds it, even on the first page; the index's
 * holds it past the first page; a relay the reader added never holds it, and
 * ends instead.
 */
interface Source {
  relay: string;
  cap: number;
  holds: "always" | "past-first" | "never";
  read: (filters: Filter[], timeoutMs: number) => Promise<RelayRead>;
}

const hubSources = (skip: string[]): Source[] =>
  listRelays()
    .filter((relay) => !skip.includes(relay))
    .map((relay) => ({
      relay,
      cap: FILL_LIMIT,
      holds: relay === DCOSL ? "always" : "never",
      read: (filters, timeoutMs) => readRelaysReporting([relay], filters, timeoutMs),
    }));
const indexSources = (): Source[] => [
  {
    relay: INDEX,
    cap: INDEX_FILTER_CAP,
    holds: "past-first",
    read: (filters, timeoutMs) => readIndexReporting(filters, timeoutMs),
  },
];
const nothing: RelayRead = { events: [], outcomes: {} };

/** The newer of two places to go on from; null is "nowhere", `NOT_STARTED` the newest of all. */
const newer = (a: SideCursor, b: SideCursor): SideCursor =>
  a === NOT_STARTED || b === NOT_STARTED ? NOT_STARTED : a === null ? b : b === null ? a : Math.max(a, b);

/** The tag a list filter asks by: "#z", or "#e" for a 9998's items that name it by `e`. */
const tagOf = (filter: Filter): string => Object.keys(filter).find((k) => k.startsWith("#")) ?? "";

/** Whether a relay read ended in EOSE, and the oldest second it sent (null: none). */
function endOf(read: RelayRead): { ended: boolean; oldest: number | null } {
  const outcomes = Object.values(read.outcomes);
  let oldest: number | null = null;
  for (const o of outcomes) if (o.oldest !== null && (oldest === null || o.oldest < oldest)) oldest = o.oldest;
  // No outcome at all: the read itself failed.
  return { ended: outcomes.length > 0 && outcomes.every((o) => o.end.state === "eose"), oldest };
}

interface Part {
  events: NostrEvent[];
  /** Where this relay goes on from with this filter; null: it has finished. */
  next: SideCursor;
  /** A relay the reader added whose read failed: it ends, and isn't asked again. */
  dropped: boolean;
  /** The crowded second it read to EOSE, and whether it came back with as many as the relay sends (`full`). */
  fill?: { second: number; full: boolean };
}

/**
 * One relay's page of one filter: its answer, its crowded second read to the
 * end, and where it goes on from. A relay pages on its own: two relays, or
 * two filters (a 9998 list is asked by `z` and by `e`), end their pages at
 * different seconds, and going on from the older would skip what the other
 * holds between them. A failed read (anything but EOSE) of dcosl or the
 * index holds its side as the header says; one of a relay the reader added
 * ends that relay, keeping what it sent.
 */
async function readOne(source: Source, filter: Filter, page: { limit: number; until?: number }): Promise<Part> {
  const answer = await source.read([filter], PAGE_TIMEOUT_MS).catch(() => nothing);
  const { ended, oldest } = endOf(answer);
  if (!ended) {
    if (source.holds === "never") return { events: answer.events, next: null, dropped: true };
    if (oldest === null) {
      if (page.until !== undefined) return { events: [], next: page.until, dropped: false };
      return { events: [], next: source.holds === "always" ? NOT_STARTED : null, dropped: false };
    }
    // A relay that ignored `until` sent newer events than were asked for: never go back past the page asked.
    const at = page.until === undefined ? oldest : Math.min(oldest, page.until);
    return { events: answer.events, next: at, dropped: false };
  }
  const { until: goOn, fillSecond } = nextPage(answer.events, page, new Set());
  if (fillSecond === null) return { events: answer.events, next: goOn, dropped: false };
  const second = { ...filter, limit: FILL_LIMIT, until: fillSecond, since: fillSecond };
  const fill = await source.read([second], FILL_TIMEOUT_MS).catch(() => nothing);
  const events = [...answer.events, ...fill.events];
  if (endOf(fill).ended) {
    // As many as the relay ever sends for one filter: it ended, but the second may hold more. Go on, and say so.
    const full = (fill.outcomes[source.relay]?.sent ?? 0) >= source.cap;
    return { events, next: goOn, dropped: false, fill: { second: fillSecond, full } };
  }
  return source.holds === "never" ? { events, next: null, dropped: true } : { events, next: fillSecond, dropped: false };
}

interface SideRead {
  events: NostrEvent[];
  next: SideCursor;
  dropped: string[];
  truncated: CrowdedSecond[];
  filled: CrowdedSecond[];
}

/**
 * One side's page: each of its relays' pages of each filter, read at once.
 * The side goes on from the newest second any of them still has to read; a
 * relay or filter that had finished is asked again from there, which can
 * repeat an item but never skips one. `dropped`: the relays the reader
 * added that failed, which this side no longer asks. A crowded second's
 * read is `truncated` when it came back full, `filled` when it didn't and
 * its relay's cap is known (dcosl's or the index's).
 */
async function readSide(
  sources: Source[],
  handles: string[],
  until: number | undefined,
  itemKinds: number[],
): Promise<SideRead> {
  const page = until === undefined ? { limit: PAGE_SIZE } : { limit: PAGE_SIZE, until };
  const filters = itemFilters(handles, page, itemKinds);
  const asked = sources.flatMap((source) => filters.map((filter) => ({ source, filter })));
  const parts = await Promise.all(asked.map(({ source, filter }) => readOne(source, filter, page)));
  const fills = asked.flatMap(({ source, filter }, i) => {
    const fill = parts[i].fill;
    return fill ? [{ source, fill, read: { relay: source.relay, second: fill.second, filter: tagOf(filter) } }] : [];
  });
  return {
    events: parts.flatMap((p) => p.events),
    next: parts.reduce<SideCursor>((next, p) => newer(next, p.next), null),
    dropped: [...new Set(asked.filter((_, i) => parts[i].dropped).map(({ source }) => source.relay))],
    truncated: fills.filter(({ fill }) => fill.full).map(({ read }) => read),
    filled: fills.filter(({ source, fill }) => !fill.full && source.holds !== "never").map(({ read }) => read),
  };
}

const unfinished: SideRead = { events: [], next: null, dropped: [], truncated: [], filled: [] };

/** One crowded second of one filter, whichever relay read it. */
const secondKey = (s: CrowdedSecond): string => `${s.filter} ${s.second}`;

/**
 * Of the crowded seconds a list's pages cut short (`truncated`, every page's),
 * those whose items are lost: no page read them to the end (`filled`, every
 * page's), and neither side can still read them, having finished or gone on
 * past (`next`, the last page's). A side still at or above one, or not yet
 * started, may yet fill it. Each second once; empty when nothing is lost.
 */
export function lostSeconds(
  truncated: CrowdedSecond[],
  filled: CrowdedSecond[],
  next: ItemsPage["next"],
): CrowdedSecond[] {
  const done = new Set(filled.map(secondKey));
  const ahead = (second: number) =>
    next !== null && [next.hub, next.index].some((c) => c === NOT_STARTED || (typeof c === "number" && c >= second));
  const lost = new Map<string, CrowdedSecond>();
  for (const s of truncated) {
    if (!done.has(secondKey(s)) && !ahead(s.second) && !lost.has(secondKey(s))) lost.set(secondKey(s), s);
  }
  return [...lost.values()];
}

/**
 * What a list holds after another page or live item: each item's newest
 * version, newest first, blank versions kept. Keep this, and show
 * `shownItems` of it: dropping a blank here would let an older version,
 * from a later page or a lagging relay, bring its item back.
 */
export function mergePages<T extends ItemEvent>(held: T[], incoming: T[]): T[] {
  return distinctItems([...held, ...incoming]);
}

/** What a list shows of what it holds: every item but the blanked ones. */
export function shownItems<T extends ItemEvent>(held: T[]): T[] {
  return held.filter((ev) => !isBlankEvent(ev));
}

/**
 * A page of the items filed under `handles`: the hub's next page and the
 * index's, read at once, each from its own cursor (`cursor` absent: the
 * first page). `itemKinds` are the kinds the header declares beside 39999
 * and 9999.
 */
export async function loadItemsPage(
  handles: string[],
  cursor: ItemsCursor = {},
  itemKinds: number[] = [],
): Promise<ItemsPage> {
  if (!itemFilters(handles).length) return { items: [], next: null, stalled: false, truncated: [], filled: [] };
  const side = (sources: Source[], at: SideCursor | undefined) =>
    at === null ? Promise.resolve(unfinished) : readSide(sources, handles, typeof at === "number" ? at : undefined, itemKinds);

  const skipped = cursor.skip ?? [];
  const [hub, index] = await Promise.all([
    side(hubSources(skipped), cursor.hub),
    side(indexSources(), cursor.index),
  ]);

  const skip = [...new Set([...skipped, ...hub.dropped])];
  const next =
    hub.next === null && index.next === null
      ? null
      : { hub: hub.next, index: index.next, ...(skip.length ? { skip } : {}) };
  // Only dcosl and the index hold a side, so a side that came back where it was asked is one of them stalling.
  const heldWhereAsked = (asked: SideCursor | undefined, got: SideCursor) => got !== null && got === (asked ?? NOT_STARTED);
  const stalled = heldWhereAsked(cursor.hub, hub.next) || heldWhereAsked(cursor.index, index.next);
  // A second one relay cut short and another read to the end on this page lost nothing.
  const filled = [...hub.filled, ...index.filled];
  const done = new Set(filled.map(secondKey));
  const truncated = [...hub.truncated, ...index.truncated].filter((s) => !done.has(secondKey(s)));
  return { items: filedItems([...hub.events, ...index.events], handles, itemKinds), next, stalled, truncated, filled };
}

/**
 * Items filed under `handles` from `since` on (a Unix second; now when
 * absent), live on the hub, each handed to `onItem` once, a blank one too
 * (merge it with `mergePages`: it is how an item deleted while the list is
 * open goes). A list passes the second its first read began, so what was
 * listed while that read ran comes too. Returns the function that stops
 * listening.
 */
export function liveItems(
  handles: string[],
  onItem: (ev: ItemEvent) => void,
  itemKinds: number[] = [],
  since: number = Math.floor(Date.now() / 1000),
): () => void {
  const filters = itemFilters(handles, undefined, itemKinds).map((f) => ({ ...f, since }));
  if (!filters.length) return () => {};
  return subscribeLive(listRelays(), filters, (ev) => {
    for (const item of filedItems([ev], handles, itemKinds)) onItem(item);
  });
}

/**
 * The items filed under `handles` whose text has every one of `words`, from
 * the whole list: the index matches them over every item it holds, where a
 * page stops at 500. Up to 200. Empty when the index refuses.
 */
export async function searchItems(handles: string[], words: string[]): Promise<ItemEvent[]> {
  const search = words
    .map((w) => w.trim())
    .filter(Boolean)
    .join(" ");
  const filters = itemFilters(handles, { limit: SEARCH_LIMIT });
  if (!search || !filters.length) return [];
  const events = await readIndex(filters.map((f) => ({ ...f, search }))).catch(() => [] as NostrEvent[]);
  return shownItems(filedItems(events, handles));
}

/**
 * How many events are filed under `handles`, by NIP-45 COUNT on the index:
 * everything filed, before the web-of-trust filter, since COUNT can't
 * filter by trust. Null when the index refuses or doesn't answer.
 */
export async function countItems(handles: string[]): Promise<number | null> {
  const filters = itemFilters(handles);
  return filters.length ? countIndex(filters) : null;
}
