"use client";

/**
 * What a list page reads for its items, each as a hook
 * the page calls. Every one keeps its answer with the question it answers
 * (the list's handles, the reader), so a new question shows nothing of an
 * old answer, and none of them sets state while an effect runs.
 *
 * - `useListItems`: the pages and the live items. The first page loads on
 *   mount, "Load more" passes the cursor back as it came (`skip` too), and
 *   the live subscription starts once the first page is in, from the second
 *   that page was asked for. Pages and live
 *   items are merged by identity (`mergePages`), blank versions kept, so a
 *   blank that comes in removes its row. Every page's crowded seconds are
 *   kept, so a second one page cut short and no page read to the end stays
 *   `lost` however many pages come after (`lostSeconds`).
 *   The hook also remembers every id it has held for each item and who made
 *   it, the versions a merge left behind too (`versionsOf`: what a deletion
 *   names, an author's own only), and which
 *   items the reader deleted this session (`remove`, `removed`): those stay
 *   hidden, though a later page or live event brings an older version in, and
 *   a version made after the deletion shows again.
 * - `useAuthorRanks`: the reader's scorer's ranks of the items' authors,
 *   and which authors it answered for. An author whose read didn't end is
 *   asked again with the next request (new authors, or a new page).
 * - `useReactions`, `useItemCount`, `useSearchedItems`: the votes on
 *   what's loaded and the reader's own, the index's count, and the index's
 *   search past what's loaded.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { filedItems, itemIdentity, type ItemEvent } from "@/services/concepts";
import {
  countItems,
  liveItems,
  loadItemsPage,
  lostSeconds,
  mergePages,
  NOT_STARTED,
  searchItems,
  type CrowdedSecond,
  type ItemsPage,
} from "@/services/items";
import { loadReactions, type ReactionCount } from "@/services/reactions";
import { fetchAuthorRanks, type RankObserver } from "@/services/trust";

// -- items -------------------------------------------------------------------

interface ItemsState {
  /** The question: the handles and item kinds, as JSON. */
  key: string;
  /** What the list holds: every page and live item merged (`mergePages`), blank versions kept. */
  held: ItemEvent[];
  /** The first page has come back. */
  firstLoaded: boolean;
  loadingMore: boolean;
  /** Where the next page starts, exactly as the last page said; null when there is no more. */
  next: ItemsPage["next"];
  /** The last page came back where it was asked: dcosl or the index didn't answer. */
  stalled: boolean;
  /** How many pages have come back, the first included. */
  pages: number;
  /** Every page's crowded seconds a relay cut short, and those dcosl or the index read to the end. */
  truncated: CrowdedSecond[];
  filled: CrowdedSecond[];
  /** Every event held for each item (`itemIdentity`), in the order they came in: the versions a merge dropped too. */
  versions: Map<string, Version[]>;
  /** The items the reader deleted: their identity, and the second of the deletion. */
  removed: Map<string, number>;
}

/** An event held for an item: its id, and whose it is. */
interface Version {
  id: string;
  pubkey: string;
}

const freshItems = (key: string): ItemsState => ({
  key,
  held: [],
  firstLoaded: false,
  loadingMore: false,
  next: null,
  stalled: false,
  pages: 0,
  truncated: [],
  filled: [],
  versions: new Map(),
  removed: new Map(),
});

/** `versions` with `events` added under their items; the same map when there is nothing new. */
function withVersions(versions: Map<string, Version[]>, events: ItemEvent[]): Map<string, Version[]> {
  let next: Map<string, Version[]> | null = null;
  for (const ev of events) {
    const identity = itemIdentity(ev);
    const seen = (next ?? versions).get(identity);
    if (seen?.some((v) => v.id === ev.id)) continue;
    next ??= new Map(versions);
    next.set(identity, [...(seen ?? []), { id: ev.id, pubkey: ev.pubkey }]);
  }
  return next ?? versions;
}

/** The state after `events` come in: merged into what the list holds, and their ids and authors remembered. */
const taking = (s: ItemsState, events: ItemEvent[]): ItemsState => ({
  ...s,
  held: mergePages(s.held, events),
  versions: withVersions(s.versions, events),
});

/** The state after a page: its items merged in, its cursor and crowded seconds taken. */
const withPage = (s: ItemsState, page: ItemsPage): ItemsState => ({
  ...taking(s, page.items),
  firstLoaded: true,
  loadingMore: false,
  next: page.next,
  stalled: page.stalled,
  pages: s.pages + 1,
  truncated: page.truncated.length ? [...s.truncated, ...page.truncated] : s.truncated,
  filled: page.filled.length ? [...s.filled, ...page.filled] : s.filled,
});

/** A page nobody answered, asked again from where it was asked (`cursor` absent: the first page). */
const unanswered = (cursor: ItemsPage["next"]): ItemsPage => ({
  items: [],
  next: cursor ?? { hub: NOT_STARTED, index: NOT_STARTED },
  stalled: true,
  truncated: [],
  filled: [],
});

export interface ListItems {
  held: ItemEvent[];
  firstLoaded: boolean;
  loadingMore: boolean;
  /** There are more pages to ask for. */
  more: boolean;
  stalled: boolean;
  /** How many pages have come back, the first included: each is a moment to ask again what didn't answer. */
  pages: number;
  /** Crowded seconds whose items couldn't all be read: a relay cut them short, and no relay can still read them. */
  lost: CrowdedSecond[];
  loadMore: () => void;
  /** Merge events this page wrote (a new item, an edit), as a page would be: only those filed under the list. */
  add: (events: ItemEvent[]) => void;
  /**
   * The ids of every event held for the item, blank versions and those a newer
   * one replaced included. With `author`, only that author's: an item's identity
   * holds its curation copies by others too, and a deletion may name only its
   * author's own events.
   */
  versionsOf: (identity: string, author?: string) => string[];
  /** The items deleted this session, by identity: the second of the deletion. */
  removed: ReadonlyMap<string, number>;
  /** Hide the item, and every version of it no newer than `at` (a Unix second), for the rest of the session. */
  remove: (identity: string, at: number) => void;
}

const NO_ITEMS = "[[],[]]";
/** How long live items gather before they're merged in. */
const LIVE_BATCH_MS = 100;

/** A list's items: `handles` the list is filed under, `itemKinds` its header's extra kinds. Nothing is read for no handles. */
export function useListItems(handles: string[], itemKinds: number[]): ListItems {
  const key = handles.length ? JSON.stringify([handles, itemKinds]) : NO_ITEMS;
  const [state, setState] = useState<ItemsState>(() => freshItems(key));
  const current = state.key === key ? state : freshItems(key);
  /** The question being asked now: an answer to any other is dropped, however late it comes. */
  const asking = useRef(key);
  useEffect(() => {
    asking.current = key;
  }, [key]);

  /** Apply a change to the state of this question. */
  const update = useCallback(
    (change: (s: ItemsState) => ItemsState) => {
      if (asking.current !== key) return;
      setState((s) => change(s.key === key ? s : freshItems(key)));
    },
    [key],
  );

  useEffect(() => {
    if (key === NO_ITEMS) return;
    const [hs, kinds] = JSON.parse(key) as [string[], number[]];
    let cancelled = false;
    let stopLive = () => {};
    // Live items are merged a batch at a time: a bulk import can send thousands in a burst.
    let arrived: ItemEvent[] = [];
    let flushing: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      flushing = null;
      const batch = arrived;
      arrived = [];
      update((s) => taking(s, batch));
    };
    // Live items start where the first read did: anything listed while it ran comes live.
    const since = Math.floor(Date.now() / 1000);
    loadItemsPage(hs, undefined, kinds)
      // A first page that throws is a first page nobody answered: Load more asks for it again.
      .catch(() => unanswered(null))
      .then((page) => {
        if (cancelled) return;
        update((s) => withPage(s, page));
        // New items from now on, once the first page is in.
        stopLive = liveItems(
          hs,
          (ev) => {
            arrived.push(ev);
            flushing ??= setTimeout(flush, LIVE_BATCH_MS);
          },
          kinds,
          since,
        );
      });
    return () => {
      cancelled = true;
      stopLive();
      if (flushing) clearTimeout(flushing);
    };
  }, [key, update]);

  const loadMore = useCallback(() => {
    if (key === NO_ITEMS || !current.firstLoaded || current.loadingMore || !current.next) return;
    const [hs, kinds] = JSON.parse(key) as [string[], number[]];
    const cursor = current.next;
    update((s) => ({ ...s, loadingMore: true }));
    loadItemsPage(hs, cursor, kinds)
      // A page that throws is a page nobody answered: ask again from the same place.
      .catch(() => unanswered(cursor))
      .then((page) => update((s) => withPage(s, page)));
  }, [key, current.firstLoaded, current.loadingMore, current.next, update]);

  const add = useCallback(
    (events: ItemEvent[]) => {
      if (key === NO_ITEMS) return;
      const [hs, kinds] = JSON.parse(key) as [string[], number[]];
      const filed = filedItems(events, hs, kinds);
      if (filed.length) update((s) => taking(s, filed));
    },
    [key, update],
  );

  /** Read when an item is deleted, so the function stays the same as versions come in and the rows aren't drawn again. */
  const versions = useRef(current.versions);
  useEffect(() => {
    versions.current = current.versions;
  }, [current.versions]);
  const versionsOf = useCallback(
    (identity: string, author?: string) =>
      (versions.current.get(identity) ?? []).filter((v) => author === undefined || v.pubkey === author).map((v) => v.id),
    [],
  );

  const remove = useCallback(
    (identity: string, at: number) =>
      update((s) => ({ ...s, removed: new Map(s.removed).set(identity, Math.max(at, s.removed.get(identity) ?? at)) })),
    [update],
  );

  const lost = useMemo(
    () => lostSeconds(current.truncated, current.filled, current.next),
    [current.truncated, current.filled, current.next],
  );

  return {
    held: current.held,
    firstLoaded: current.firstLoaded,
    loadingMore: current.loadingMore,
    more: current.firstLoaded && current.next !== null,
    stalled: current.stalled,
    pages: current.pages,
    lost,
    loadMore,
    add,
    versionsOf,
    removed: current.removed,
    remove,
  };
}

// -- ranks -------------------------------------------------------------------

interface RanksState {
  observer: RankObserver;
  /** The ranks of the authors answered for; one answered and absent is unranked. */
  ranks: Map<string, number>;
  /** The authors the scorer answered for: their reads ended. */
  answered: Set<string>;
}

const freshRanks = (observer: RankObserver): RanksState => ({ observer, ranks: new Map(), answered: new Set() });

export interface AuthorRanksResult {
  /** The ranks of the authors answered for. */
  ranks: Map<string, number>;
  /** The authors the scorer answered for. Anyone else is unknown: their items are shown, never folded. */
  answered: ReadonlySet<string>;
  /** Ranks for people the page doesn't hold, from the same scorer: for counting votes. */
  rankMore: (pubkeys: string[]) => Promise<Map<string, number>>;
}

/**
 * The reader's scorer's ranks of `authors` (`fetchAuthorRanks`), and which
 * of them it answered for; `observer` is the reader's pubkey, or "house"
 * signed out. Only an author whose read ended counts as answered: the
 * rest are asked again with the next request, which goes out when new
 * authors come in or another page does (`attempt`), never on a timer. A
 * new observer asks again from nothing. Ranks decide who counts, and are
 * never shown.
 */
export function useAuthorRanks(authors: string[], observer: RankObserver, attempt = 0): AuthorRanksResult {
  const [state, setState] = useState<RanksState>(() => freshRanks(observer));
  /** This reader's bookkeeping: who has been answered for, and who is being asked about now. */
  const book = useRef({ observer, answered: new Set<string>(), asking: new Set<string>() });
  const authorsKey = [...new Set(authors)].sort().join(",");

  useEffect(() => {
    if (book.current.observer !== observer) book.current = { observer, answered: new Set(), asking: new Set() };
    const mine = book.current;
    const toAsk = authorsKey ? authorsKey.split(",").filter((pk) => !mine.answered.has(pk) && !mine.asking.has(pk)) : [];
    if (!toAsk.length) return;
    for (const pk of toAsk) mine.asking.add(pk);
    void fetchAuthorRanks(toAsk, observer).then((r) => {
      for (const pk of toAsk) mine.asking.delete(pk);
      // The reader changed while this was asked: it is someone else's answer.
      if (book.current !== mine) return;
      const answered = toAsk.filter((pk) => r.answered?.has(pk));
      if (!answered.length) return;
      for (const pk of answered) mine.answered.add(pk);
      setState((s) => {
        const base = s.observer === observer ? s : freshRanks(observer);
        const ranks = new Map(base.ranks);
        for (const pk of answered) {
          const rank = r.ranks.get(pk);
          if (rank === undefined) ranks.delete(pk);
          else ranks.set(pk, rank);
        }
        return { observer, ranks, answered: new Set([...base.answered, ...answered]) };
      });
    });
    // `attempt` asks again for whoever wasn't answered, though no new author came in.
  }, [authorsKey, observer, attempt]);

  const current = useMemo(() => (state.observer === observer ? state : freshRanks(observer)), [state, observer]);
  const rankMore = useCallback(
    (pubkeys: string[]) => fetchAuthorRanks(pubkeys, observer).then((r) => r.ranks),
    [observer],
  );

  return { ranks: current.ranks, answered: current.answered, rankMore };
}

// -- reactions ---------------------------------------------------------------

/**
 * The votes on `items` (`loadReactions`): one per person, their latest,
 * from inside the web of trust, and the reader's own vote on each (`reader`,
 * null when signed out). Read for each item once per reader, as items come
 * in, once the scorer has answered (`ranks` not null); until then there are
 * none. `setCount` replaces one item's count, for the page to show a vote the
 * list relay has taken without reading again; it changes the counts of the
 * reader it was made for, and no other's.
 */
export function useReactions(
  items: ItemEvent[],
  ranks: Map<string, number> | null,
  observer: RankObserver,
  rankMore: (pubkeys: string[]) => Promise<Map<string, number>>,
  reader: string | null,
): { counts: Map<string, ReactionCount>; setCount: (identity: string, count: ReactionCount) => void } {
  const [state, setState] = useState<{ observer: RankObserver; counts: Map<string, ReactionCount> }>(() => ({
    observer,
    counts: new Map(),
  }));
  const asked = useRef<{ observer: RankObserver; identities: Set<string> }>({ observer, identities: new Set() });

  useEffect(() => {
    if (!ranks) return;
    if (asked.current.observer !== observer) asked.current = { observer, identities: new Set() };
    const fresh = items.filter((item) => !asked.current.identities.has(itemIdentity(item)));
    if (!fresh.length) return;
    for (const item of fresh) asked.current.identities.add(itemIdentity(item));
    const askedFor = asked.current;
    void loadReactions(fresh, ranks, rankMore, reader).then((counts) => {
      if (asked.current !== askedFor) return;
      setState((s) => {
        const base = s.observer === observer ? s.counts : new Map<string, ReactionCount>();
        return { observer, counts: new Map([...base, ...counts]) };
      });
    });
  }, [items, ranks, observer, rankMore, reader]);

  const setCount = useCallback(
    (identity: string, count: ReactionCount) =>
      // A vote cast as another reader isn't added to this reader's counts.
      setState((s) => (s.observer === observer ? { observer, counts: new Map(s.counts).set(identity, count) } : s)),
    [observer],
  );

  return { counts: state.observer === observer ? state.counts : EMPTY_COUNTS, setCount };
}

const EMPTY_COUNTS = new Map<string, ReactionCount>();

// -- count, search -------------------------------------------------------------

/**
 * How many items are filed under the list, by COUNT on the index: everything
 * filed, before the web-of-trust filter. Null while asking, and when the
 * index doesn't answer.
 */
export function useItemCount(handles: string[]): number | null {
  const key = JSON.stringify(handles);
  const [counted, setCounted] = useState<{ key: string; count: number | null } | null>(null);

  useEffect(() => {
    const hs = JSON.parse(key) as string[];
    if (!hs.length) return;
    let cancelled = false;
    countItems(hs)
      .catch(() => null)
      .then((count) => {
        if (!cancelled) setCounted({ key, count });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return counted?.key === key ? counted.count : null;
}

/** How long typing pauses before the index is asked. */
const SEARCH_DELAY_MS = 400;
const NOTHING_FOUND: ItemEvent[] = [];

/**
 * The list's items the index finds for `query`, past those loaded
 * (`searchItems`). Asked only when `wanted` (there are more items than are
 * loaded), once typing pauses. Empty otherwise, and when the index refuses.
 */
export function useSearchedItems(handles: string[], query: string, wanted: boolean): ItemEvent[] {
  const words = query.trim();
  const key = wanted && words && handles.length ? JSON.stringify([handles, words]) : "";
  const [found, setFound] = useState<{ key: string; items: ItemEvent[] } | null>(null);

  useEffect(() => {
    if (!key) return;
    const [hs, text] = JSON.parse(key) as [string[], string];
    let cancelled = false;
    const timer = setTimeout(() => {
      searchItems(hs, text.split(/\s+/))
        .catch(() => NOTHING_FOUND)
        .then((items) => {
          if (!cancelled) setFound({ key, items });
        });
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key]);

  return key && found?.key === key ? found.items : NOTHING_FOUND;
}
