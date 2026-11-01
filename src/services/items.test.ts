/**
 * A list's items: read in pages of 500, newest first, from the hub and the
 * index each on its own cursor; new ones live; counted and searched on the
 * index. The relays here answer the way a relay does (src/test/relayCorpus):
 * matched, newest first, cut at `limit`.
 */
import type { Filter, NostrEvent } from "nostr-tools";
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey, verifiedSymbol } from "nostr-tools/pure";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RELAYS } from "@/lib/curate/relayUrls";
import { itemIdentity, type ItemEvent } from "@/services/concepts";
import { clearSeenOn } from "@/services/nostr";
import { DCOSL, INDEX } from "@/services/relays";
import { setTransport, type RelayTransport, type ReqEnd } from "@/services/transport";
import { useRelayStatus } from "@/stores/relay-status";
import { useSettings } from "@/stores/settings";
import { relayCorpus, type HeldRelay } from "@/test/relayCorpus";
import foodItems from "@/test/fixtures/food.items.json";
import {
  countItems,
  liveItems,
  loadItemsPage,
  lostSeconds,
  mergePages,
  NOT_STARTED,
  PAGE_SIZE,
  searchItems,
  shownItems,
  type CrowdedSecond,
  type ItemsCursor,
  type ItemsPage,
} from "./items";

const FOOD = "39998:b83a28b7e4e5d20bd960c5faeb6625f95529166b8bdb045d42634a2f35919450:food-and-drink-places";
const VESPA_REFUSAL =
  "error: vespa searched only 67% of the corpus over 413412306 document(s) (full: false, coverage 0.67); " +
  "the response is a PARTIAL answer, not a small one, so it is refused rather than returned.";
const T = 1_792_631_623;

const sk = generateSecretKey();
const AUTHOR = getPublicKey(sk);
const ROOT = `39998:${AUTHOR}:books`;

const sign = (kind: number, tags: string[][], created_at: number, content = ""): NostrEvent =>
  finalizeEvent({ kind, created_at, content, tags }, sk) as NostrEvent;

/** A 39999 filed under `under`. */
const item = (d: string, created_at: number, under = ROOT) => sign(39999, [["d", d], ["z", under]], created_at);

/**
 * A 39999 filed under the list, made in microseconds: its id is its real
 * hash, and it carries the mark nostr-tools sets on an event it has signed
 * or checked, so the signature check takes it as checked. Signing the
 * 10,000-odd events a crowded second needs takes a quarter of a minute.
 */
const quickItem = (d: string, created_at: number): NostrEvent => {
  const unsigned = { kind: 39999, pubkey: AUTHOR, created_at, content: "", tags: [["d", d], ["z", ROOT]] };
  return { ...unsigned, id: getEventHash(unsigned), sig: "0".repeat(128), [verifiedSymbol]: true } as NostrEvent;
};

/** The most the index sends for one filter, however high the limit (verified live, 31 October 2026). */
const INDEX_CAP = 5_000;

function hold(held: Record<string, HeldRelay>, ignoringFilters: string[] = [], maxLimit: Record<string, number> = {}) {
  const corpus = relayCorpus(held, { ignoringFilters, maxLimit });
  setTransport(corpus.transport);
  return corpus;
}

const identities = (items: ItemEvent[]) => items.map(itemIdentity);

/**
 * `base`, except that the first `times` requests `when` picks stop partway:
 * the relay sends `after` events, then the read ends with `end` (a timeout,
 * as a big read does when the client can't keep up, unless told otherwise).
 */
function cutting(
  base: RelayTransport,
  when: (relay: string, filters: Filter[]) => boolean,
  after: number,
  { times = 1, end = { state: "timeout" } }: { times?: number; end?: ReqEnd } = {},
): RelayTransport {
  let left = times;
  return {
    ...base,
    async req(relay, filters, onEvent, timeoutMs) {
      if (left <= 0 || !when(relay, filters)) return base.req(relay, filters, onEvent, timeoutMs);
      left -= 1;
      let sent = 0;
      await base.req(relay, filters, (ev) => sent++ < after && onEvent(ev), timeoutMs);
      return end;
    },
  };
}

/** Every page, from the first until both sides finish, merged as a list page keeps them. */
async function readEverything(handles: string[], first?: ItemsCursor) {
  let held: ItemEvent[] = [];
  let cursor: ItemsCursor | undefined = first;
  for (let pages = 0; pages < 10; pages++) {
    const page = await loadItemsPage(handles, cursor);
    held = mergePages(held, page.items);
    if (!page.next) return held;
    cursor = page.next;
  }
  throw new Error("never finished");
}

const isFill = (filters: Filter[]) => filters.some((f) => f.since !== undefined);

beforeEach(() => {
  clearSeenOn();
  useRelayStatus.getState().reset();
  useSettings.setState({ relays: [...DEFAULT_RELAYS] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadItemsPage", () => {
  // Bulk imports put more items in one second than a page holds.
  let crowded: NostrEvent[];
  // The hub holds one item a second; the index lags, and holds every other one plus older ones.
  let hubHeld: NostrEvent[];
  let indexHeld: NostrEvent[];

  beforeAll(() => {
    crowded = [
      ...Array.from({ length: 1200 }, (_, i) => item(`same-${i}`, T)),
      ...Array.from({ length: 300 }, (_, i) => item(`older-${i}`, T - 1 - (i % 40))),
    ];
    hubHeld = Array.from({ length: 700 }, (_, i) => item(`s-${i}`, T - i));
    const indexOnly = Array.from({ length: 250 }, (_, i) => item(`i-${i}`, T - 700 - 2 * i));
    indexHeld = [...hubHeld.filter((_, i) => i % 2 === 0), ...indexOnly];
  }, 60_000);

  it("pages through 1,200 items that share one second, losing none and repeating none", async () => {
    const { calls } = hold({ [DCOSL]: crowded, [INDEX]: crowded });

    const first = await loadItemsPage([ROOT]);
    expect(first.items).toHaveLength(1200);
    expect(first.next).toEqual({ hub: T - 1, index: T - 1 });
    expect(first.stalled).toBe(false);

    const second = await loadItemsPage([ROOT], first.next!);
    expect(second.items).toHaveLength(300);
    expect(second.next).toBeNull();

    const all = [...identities(first.items), ...identities(second.items)];
    expect(new Set(all).size).toBe(1500);
    expect(all).toHaveLength(1500);

    // Each side: a page, the fill of its crowded second, then the next page.
    expect(calls.filter((c) => c.relay === DCOSL).map((c) => c.filters)).toEqual([
      [{ kinds: [39999, 9999], "#z": [ROOT], limit: 500 }],
      [{ kinds: [39999, 9999], "#z": [ROOT], limit: 10_000, until: T, since: T }],
      [{ kinds: [39999, 9999], "#z": [ROOT], limit: 500, until: T - 1 }],
    ]);
    expect(calls.filter((c) => c.relay === INDEX).map((c) => c.filters)).toEqual([
      [{ kinds: [39999, 9999], "#z": [ROOT], limit: 500, search: "include:spam" }],
      [{ kinds: [39999, 9999], "#z": [ROOT], limit: 10_000, until: T, since: T, search: "include:spam" }],
      [{ kinds: [39999, 9999], "#z": [ROOT], limit: 500, until: T - 1, search: "include:spam" }],
    ]);
  });

  it("hub and index pages ending at different seconds lose nothing across two pages", async () => {
    hold({ [DCOSL]: hubHeld, [INDEX]: indexHeld });

    // The hub's page ends at T-499, the index's at T-998: each goes on from its own.
    const first = await loadItemsPage([ROOT]);
    expect(first.next).toEqual({ hub: T - 500, index: T - 999 });

    const second = await loadItemsPage([ROOT], first.next!);
    expect(second.next).toBeNull();

    const held = new Set(identities([...hubHeld, ...indexHeld]));
    const read = new Set([...identities(first.items), ...identities(second.items)]);
    expect(held.size).toBe(950);
    expect(read).toEqual(held);
    // One merged cursor would have gone on from T-999, past the hub's odd seconds below T-499.
    const onlyOnHub = hubHeld.find((ev) => ev.created_at === T - 501)!;
    expect(identities(second.items)).toContain(itemIdentity(onlyOnHub));
  });

  it("pages each hub relay on its own: a reader's relay with a few old items doesn't skip dcosl's", async () => {
    const EXTRA = "wss://extra.example.test";
    useSettings.setState({ relays: [...DEFAULT_RELAYS, EXTRA] });
    const old = Array.from({ length: 10 }, (_, i) => item(`old-${i}`, T - 5000 - i));
    hold({ [DCOSL]: hubHeld, [EXTRA]: old, [INDEX]: { refuses: VESPA_REFUSAL } });

    const first = await loadItemsPage([ROOT]);
    // dcosl's page ended at T-499, the extra relay's at T-5009: the hub goes on from dcosl's.
    expect(first.next).toEqual({ hub: T - 500, index: null });

    const second = await loadItemsPage([ROOT], first.next!);
    expect(second.next).toBeNull();
    const read = new Set([...identities(first.items), ...identities(second.items)]);
    expect(read).toEqual(new Set(identities([...hubHeld, ...old])));
  });

  it("doesn't ask a side that has finished", async () => {
    const { calls } = hold({ [DCOSL]: hubHeld, [INDEX]: indexHeld });

    const page = await loadItemsPage([ROOT], { hub: null, index: T - 999 });

    expect(page.stalled).toBe(false);
    expect(calls.filter((c) => c.relay === DCOSL)).toEqual([]);
    expect(page.items).toHaveLength(100);
    expect(page.next).toBeNull();
  });

  it("goes on with the hub when the index refuses", async () => {
    hold({ [DCOSL]: hubHeld, [INDEX]: { refuses: VESPA_REFUSAL } });

    const first = await loadItemsPage([ROOT]);
    expect(first.items).toHaveLength(500);
    expect(first.next).toEqual({ hub: T - 500, index: null });
    expect(useRelayStatus.getState().statuses[INDEX]).toBe("closed");

    const second = await loadItemsPage([ROOT], first.next!);
    expect(second.items).toHaveLength(200);
    expect(second.next).toBeNull();
  });

  it("pages a 9998 list's z and e filters each on its own, so a short one doesn't skip the other's items", async () => {
    const list = sign(9998, [["names", "Song", "Songs"]], T - 10_000);
    const byZ = Array.from({ length: 600 }, (_, i) => sign(9999, [["z", list.id]], T - i));
    const byE = Array.from({ length: 5 }, (_, i) => sign(9999, [["e", list.id]], T - 5000 - i));
    hold({ [DCOSL]: [...byZ, ...byE], [INDEX]: { refuses: VESPA_REFUSAL } });

    const first = await loadItemsPage([list.id]);
    // The z filter came back full at T-499; the e filter's five are all there are.
    expect(first.next).toEqual({ hub: T - 500, index: null });
    const second = await loadItemsPage([list.id], first.next!);
    expect(second.next).toBeNull();

    const read = new Set([...identities(first.items), ...identities(second.items)]);
    expect(read).toEqual(new Set(identities([...byZ, ...byE])));
  });

  it("reads a crowded second again when the hub stopped partway through it, rather than go past it", async () => {
    const corpus = relayCorpus({ [DCOSL]: crowded, [INDEX]: { refuses: VESPA_REFUSAL } });
    setTransport(cutting(corpus.transport, (relay, filters) => relay === DCOSL && isFill(filters), 700));

    const first = await loadItemsPage([ROOT]);
    expect(first.items).toHaveLength(700);
    // The fill of T was cut short: the hub goes on from T again, not from T-1.
    expect(first.next).toEqual({ hub: T, index: null });
    expect(first.stalled).toBe(false);

    const second = await loadItemsPage([ROOT], first.next!);
    expect(second.next).toEqual({ hub: T - 1, index: null });
    expect(second.stalled).toBe(false);
    const third = await loadItemsPage([ROOT], second.next!);
    expect(third.next).toBeNull();

    const read = new Set([...first.items, ...second.items, ...third.items].map(itemIdentity));
    expect(read).toEqual(new Set(identities(crowded)));
  });

  it("goes on from where the hub stopped when a page is cut short, rather than take it for the last", async () => {
    const corpus = relayCorpus({ [DCOSL]: hubHeld, [INDEX]: { refuses: VESPA_REFUSAL } });
    setTransport(cutting(corpus.transport, (relay) => relay === DCOSL, 200));

    const first = await loadItemsPage([ROOT]);
    expect(first.items).toHaveLength(200);
    // The newest 200 came, down to T-199; that second is read again.
    expect(first.next).toEqual({ hub: T - 199, index: null });

    let next = first.next;
    const read = new Set(identities(first.items));
    for (let pages = 0; next && pages < 5; pages++) {
      const page = await loadItemsPage([ROOT], next);
      for (const id of identities(page.items)) read.add(id);
      next = page.next;
    }
    expect(next).toBeNull();
    expect(read).toEqual(new Set(identities(hubHeld)));
  });

  it("never goes back past the page it asked for, when a relay that ignores until stops partway", async () => {
    // dcosl sends everything it holds, newest first, whatever it was asked, and stops after 50.
    const corpus = relayCorpus({ [DCOSL]: hubHeld, [INDEX]: { refuses: VESPA_REFUSAL } }, { ignoringFilters: [DCOSL] });
    setTransport(cutting(corpus.transport, (relay) => relay === DCOSL, 50));

    const page = await loadItemsPage([ROOT], { hub: T - 600 });

    expect(page.next).toEqual({ hub: T - 600, index: null });
    expect(page.stalled).toBe(true);
  });

  it("a crowded second's read the relay refuses holds the hub at that second", async () => {
    // The index refusing a 10,000-event read is likely; so may dcosl.
    const corpus = relayCorpus({ [DCOSL]: crowded, [INDEX]: { refuses: VESPA_REFUSAL } });
    const refusal: ReqEnd = { state: "closed", reason: "error: too many events" };
    setTransport(cutting(corpus.transport, (relay, filters) => relay === DCOSL && isFill(filters), 0, { end: refusal }));

    const first = await loadItemsPage([ROOT]);
    expect(first.items).toHaveLength(500);
    expect(first.next).toEqual({ hub: T, index: null });

    const rest = await readEverything([ROOT], first.next!);
    expect(new Set(identities(mergePages(first.items, rest)))).toEqual(new Set(identities(crowded)));
  });

  it("a crowded second's read that times out before sending anything holds the hub at that second", async () => {
    const corpus = relayCorpus({ [DCOSL]: crowded, [INDEX]: { refuses: VESPA_REFUSAL } });
    setTransport(cutting(corpus.transport, (relay, filters) => relay === DCOSL && isFill(filters), 0));

    const first = await loadItemsPage([ROOT]);
    expect(first.next).toEqual({ hub: T, index: null });

    const rest = await readEverything([ROOT], first.next!);
    expect(new Set(identities(mergePages(first.items, rest)))).toEqual(new Set(identities(crowded)));
  });

  it("a page the relay closes after some events goes on from where it stopped", async () => {
    const corpus = relayCorpus({ [DCOSL]: hubHeld, [INDEX]: { refuses: VESPA_REFUSAL } });
    const closed: ReqEnd = { state: "closed", reason: "rate-limited: slow down" };
    setTransport(cutting(corpus.transport, (relay) => relay === DCOSL, 200, { end: closed }));

    const first = await loadItemsPage([ROOT]);
    expect(first.items).toHaveLength(200);
    // Not the last page: the hub goes on from T-199, the oldest second it sent.
    expect(first.next).toEqual({ hub: T - 199, index: null });

    const rest = await readEverything([ROOT], first.next!);
    expect(new Set(identities(mergePages(first.items, rest)))).toEqual(new Set(identities(hubHeld)));
  });

  it("a later page that fails before sending anything holds the hub, and says it stalled", async () => {
    const corpus = relayCorpus({ [DCOSL]: hubHeld, [INDEX]: { refuses: VESPA_REFUSAL } });
    const first = await (setTransport(corpus.transport), loadItemsPage([ROOT]));
    expect(first.next).toEqual({ hub: T - 500, index: null });
    expect(first.stalled).toBe(false);

    const down: ReqEnd = { state: "error", reason: "the connection failed" };
    setTransport(cutting(corpus.transport, (relay) => relay === DCOSL, 0, { end: down }));
    const failed = await loadItemsPage([ROOT], first.next!);
    expect(failed.items).toEqual([]);
    expect(failed.next).toEqual({ hub: T - 500, index: null });
    expect(failed.stalled).toBe(true);

    // dcosl is back: the same cursor goes on.
    const again = await loadItemsPage([ROOT], failed.next!);
    expect(again.items).toHaveLength(200);
    expect(again.next).toBeNull();
    expect(again.stalled).toBe(false);
  });

  it("dcosl failing the first page with nothing holds the hub unstarted, and says it stalled, rather than end it", async () => {
    const corpus = relayCorpus({ [DCOSL]: hubHeld, [INDEX]: { refuses: VESPA_REFUSAL } });
    const down: ReqEnd = { state: "error", reason: "the connection failed" };
    setTransport(cutting(corpus.transport, (relay) => relay === DCOSL, 0, { end: down }));

    const first = await loadItemsPage([ROOT]);
    expect(first.items).toEqual([]);
    expect(first.next).toEqual({ hub: NOT_STARTED, index: null });
    expect(first.stalled).toBe(true);

    // dcosl is back: the hub reads its first page.
    const rest = await readEverything([ROOT], first.next!);
    expect(new Set(identities(rest))).toEqual(new Set(identities(hubHeld)));
  });

  it("on the first page, a relay that answers nothing and fails holds nothing up", async () => {
    const EXTRA = "wss://extra.example.test";
    useSettings.setState({ relays: [...DEFAULT_RELAYS, EXTRA] });
    hold({ [DCOSL]: hubHeld, [EXTRA]: { fails: "the connection failed" }, [INDEX]: [] });

    const first = await loadItemsPage([ROOT]);

    // dcosl's pace; the relay the reader added is no longer asked.
    expect(first.next).toEqual({ hub: T - 500, index: null, skip: [EXTRA] });
    expect(first.stalled).toBe(false);
    expect(useRelayStatus.getState().statuses[EXTRA]).toBe("error");
  });

  it("a dead relay the reader added never holds the hub: it pages at dcosl's pace, and isn't asked again", async () => {
    const EXTRA = "wss://extra.example.test";
    useSettings.setState({ relays: [...DEFAULT_RELAYS, EXTRA] });
    const { calls } = hold({ [DCOSL]: hubHeld, [EXTRA]: { fails: "the connection failed" }, [INDEX]: [] });

    const first = await loadItemsPage([ROOT]);
    const second = await loadItemsPage([ROOT], first.next!);

    expect(first.next).toEqual({ hub: T - 500, index: null, skip: [EXTRA] });
    expect(second.next).toBeNull();
    expect([first.stalled, second.stalled]).toEqual([false, false]);
    expect(new Set(identities(mergePages(first.items, second.items)))).toEqual(new Set(identities(hubHeld)));
    expect(calls.filter((c) => c.relay === EXTRA)).toHaveLength(1);
    expect(useRelayStatus.getState().statuses[EXTRA]).toBe("error");
  });

  it("a relay the reader added that fails after page 1, with events or without, ends for that relay alone", async () => {
    const EXTRA = "wss://extra.example.test";
    const OTHER = "wss://other.example.test";
    useSettings.setState({ relays: [...DEFAULT_RELAYS, EXTRA, OTHER] });
    const corpus = relayCorpus({ [DCOSL]: hubHeld, [EXTRA]: hubHeld, [OTHER]: hubHeld, [INDEX]: [] });
    const later = (filters: Filter[]) => filters.some((f) => f.until !== undefined && f.since === undefined);
    // From page 2 on, EXTRA closes after 50 events and OTHER fails before sending any.
    const closing = cutting(corpus.transport, (relay, filters) => relay === EXTRA && later(filters), 50, {
      times: 10,
      end: { state: "closed", reason: "rate-limited: slow down" },
    });
    setTransport(
      cutting(closing, (relay, filters) => relay === OTHER && later(filters), 0, {
        times: 10,
        end: { state: "error", reason: "the connection failed" },
      }),
    );

    const first = await loadItemsPage([ROOT]);
    expect(first.next).toEqual({ hub: T - 500, index: null });

    const second = await loadItemsPage([ROOT], first.next!);
    // Held by either, the hub would come back at T-549 or T-500; it goes at dcosl's pace, and dcosl has finished.
    expect(second.next).toBeNull();
    expect(second.stalled).toBe(false);
    expect(new Set(identities(mergePages(first.items, second.items)))).toEqual(new Set(identities(hubHeld)));
    const { statuses } = useRelayStatus.getState();
    expect([statuses[EXTRA], statuses[OTHER]]).toEqual(["closed", "error"]);
  });

  it("gives a crowded second's read longer than a page's", async () => {
    const corpus = relayCorpus({ [DCOSL]: crowded, [INDEX]: { refuses: VESPA_REFUSAL } });
    const waits: { fill: boolean; timeoutMs: number }[] = [];
    setTransport({
      ...corpus.transport,
      req(relay, filters, onEvent, timeoutMs) {
        if (relay === DCOSL) waits.push({ fill: isFill(filters), timeoutMs });
        return corpus.transport.req(relay, filters, onEvent, timeoutMs);
      },
    });

    await loadItemsPage([ROOT]);

    expect(waits).toEqual([
      { fill: false, timeoutMs: 8000 },
      { fill: true, timeoutMs: 20_000 },
    ]);
  });

  it("files the kinds the header declares beside 39999 and 9999", async () => {
    const video = sign(34236, [["d", "clip"], ["z", ROOT]], T);
    const { calls } = hold({ [DCOSL]: [video, item("plain", T - 1)], [INDEX]: [] });

    const page = await loadItemsPage([ROOT], undefined, [34236]);

    expect(page.items.map((e) => e.id)).toContain(video.id);
    expect(calls.find((c) => c.relay === DCOSL)?.filters[0].kinds).toEqual([39999, 9999, 34236]);
    expect((await loadItemsPage([ROOT])).items.map((e) => e.id)).not.toContain(video.id);
  });

  it("hands over the newest version of each item, a blank one too", async () => {
    const kept = item("kept", T - 5);
    const before = item("gone", T - 9);
    const blanked = sign(39999, [["d", "gone"], ["z", ROOT], ["deleted", "true"]], T - 1);
    const elsewhere = item("elsewhere", T, FOOD);
    // The index lags: it still holds the version from before the blanking.
    hold({ [DCOSL]: [kept, blanked, elsewhere], [INDEX]: [kept, before] });

    const page = await loadItemsPage([ROOT]);

    expect(page.items.map((e) => e.id)).toEqual([blanked.id, kept.id]);
    expect(shownItems(page.items).map((e) => e.id)).toEqual([kept.id]);
  });

  it("an item blanked on the hub stays gone when a lagging index sends its older version on a later page", async () => {
    // dcosl holds only the blank; the index holds 500 newer items, then the version from before the blanking.
    const blanked = sign(39999, [["d", "gone"], ["z", ROOT], ["deleted", "true"]], T - 1);
    const before = item("gone", T - 600);
    const newer500 = hubHeld.slice(0, 500);
    hold({ [DCOSL]: [blanked], [INDEX]: [...newer500, before] });

    const first = await loadItemsPage([ROOT]);
    expect(first.items.map((e) => e.id)).toContain(blanked.id);
    expect(first.next).toEqual({ hub: null, index: T - 500 });
    const second = await loadItemsPage([ROOT], first.next!);
    expect(second.items.map((e) => e.id)).toContain(before.id);

    const held = mergePages(mergePages([], first.items), second.items);
    const shown = shownItems(held);
    expect(shown.map(itemIdentity)).not.toContain(itemIdentity(before));
    expect(shown).toHaveLength(500);
    // The blank stays held, so a third page or a live event can't bring the item back either.
    expect(shownItems(mergePages(held, [before]))).toHaveLength(500);
  });

  it("asks nothing for a list with nothing to file under", async () => {
    const { calls } = hold({ [DCOSL]: [], [INDEX]: [] });
    const none = { items: [], next: null, stalled: false, truncated: [], filled: [] };
    expect(await loadItemsPage([])).toEqual(none);
    expect(await loadItemsPage(["not-a-handle"])).toEqual(none);
    expect(calls).toEqual([]);
  });

  it("reads 500 to a page", () => {
    expect(PAGE_SIZE).toBe(500);
  });
});

describe("a second fuller than a relay sends", () => {
  // A bulk import: on 31 October one of Food's seconds held 6,717 items. For one filter the index sends 5,000
  // at most and dcosl 10,000, and both end in EOSE as if that were all.
  let crowded: NostrEvent[];
  let overflowing: NostrEvent[];

  beforeAll(() => {
    crowded = [
      ...Array.from({ length: 6000 }, (_, i) => quickItem(`c-${i}`, T)),
      ...Array.from({ length: 20 }, (_, i) => quickItem(`o-${i}`, T - 1 - i)),
    ];
    overflowing = Array.from({ length: 10_200 }, (_, i) => quickItem(`f-${i}`, T));
  });

  /** Every page from `first` (absent: the first page) until both sides finish. */
  async function pagesFrom(first?: ItemsCursor): Promise<ItemsPage[]> {
    const pages: ItemsPage[] = [];
    let cursor = first;
    for (let n = 0; n < 10; n++) {
      const page = await loadItemsPage([ROOT], cursor);
      pages.push(page);
      if (!page.next) return pages;
      cursor = page.next;
    }
    throw new Error("never finished");
  }
  const heldAfter = (pages: ItemsPage[]) => pages.reduce<ItemEvent[]>((held, p) => mergePages(held, p.items), []);
  /** What a list page says it lost after these pages. */
  const lostAfter = (pages: ItemsPage[]) =>
    lostSeconds(
      pages.flatMap((p) => p.truncated),
      pages.flatMap((p) => p.filled),
      pages[pages.length - 1].next,
    );

  it("the index capped but dcosl complete: every item, and nothing to say", async () => {
    hold({ [DCOSL]: crowded, [INDEX]: crowded }, [], { [INDEX]: INDEX_CAP });

    const pages = await pagesFrom();

    expect(pages[0].items).toHaveLength(6000);
    expect(pages[0].truncated).toEqual([]);
    expect(pages[0].filled).toContainEqual({ relay: DCOSL, second: T, filter: "#z" });
    expect(new Set(identities(heldAfter(pages)))).toEqual(new Set(identities(crowded)));
    expect(lostAfter(pages)).toEqual([]);
  });

  it("both sides capped on one second: goes on, and says which relays and which second", async () => {
    hold({ [DCOSL]: overflowing, [INDEX]: overflowing }, [], { [INDEX]: INDEX_CAP });

    const first = await loadItemsPage([ROOT]);

    expect(first.items).toHaveLength(10_000);
    expect(first.next).toEqual({ hub: T - 1, index: T - 1 });
    expect(first.stalled).toBe(false);
    expect(first.filled).toEqual([]);
    expect(first.truncated).toHaveLength(2);
    expect(first.truncated).toEqual(
      expect.arrayContaining([
        { relay: DCOSL, second: T, filter: "#z" },
        { relay: INDEX, second: T, filter: "#z" },
      ]),
    );
    const pages = [first, ...(await pagesFrom(first.next!))];
    expect(lostAfter(pages).map((s) => s.second)).toEqual([T]);
  });

  it("dcosl down on the first page and the index capped: the hub holds, nothing is dropped; asked again, all are there", async () => {
    const corpus = relayCorpus({ [DCOSL]: crowded, [INDEX]: crowded }, { maxLimit: { [INDEX]: INDEX_CAP } });
    const down: ReqEnd = { state: "error", reason: "the connection failed" };
    setTransport(cutting(corpus.transport, (relay) => relay === DCOSL, 0, { end: down }));

    const first = await loadItemsPage([ROOT]);
    expect(first.items).toHaveLength(INDEX_CAP);
    expect(first.next).toEqual({ hub: NOT_STARTED, index: T - 1 });
    expect(first.stalled).toBe(true);
    expect(first.truncated).toEqual([{ relay: INDEX, second: T, filter: "#z" }]);
    // The hub hasn't read that second yet, so it isn't lost.
    expect(lostAfter([first])).toEqual([]);

    // dcosl is back.
    const rest = await pagesFrom(first.next!);
    expect(rest[0].stalled).toBe(false);
    expect(new Set(identities(heldAfter([first, ...rest])))).toEqual(new Set(identities(crowded)));
    expect(lostAfter([first, ...rest])).toEqual([]);
  });
});

describe("lostSeconds", () => {
  const cut: CrowdedSecond = { relay: INDEX, second: T, filter: "#z" };

  it("a second cut short is lost once no side can still read it, unless one read it to the end", () => {
    // A side that hasn't reached it yet may still read it.
    expect(lostSeconds([cut], [], { hub: T + 5, index: T - 1 })).toEqual([]);
    expect(lostSeconds([cut], [], { hub: NOT_STARTED, index: T - 1 })).toEqual([]);
    expect(lostSeconds([cut], [], { hub: T, index: null })).toEqual([]);
    // Both sides have gone past it, or finished.
    expect(lostSeconds([cut], [], { hub: T - 1, index: T - 1 })).toEqual([cut]);
    expect(lostSeconds([cut], [], null)).toEqual([cut]);
    // Read to the end, on this page or another.
    expect(lostSeconds([cut], [{ relay: DCOSL, second: T, filter: "#z" }], null)).toEqual([]);
    // Another filter's read of that second doesn't stand in for this one's.
    expect(lostSeconds([cut], [{ relay: DCOSL, second: T, filter: "#e" }], null)).toEqual([cut]);
    // Each second once, though both sides cut it short.
    expect(lostSeconds([cut, { ...cut, relay: DCOSL }], [], null)).toEqual([cut]);
  });
});

describe("liveItems", () => {
  it("listens on the list relays from now, and hands over each item filed under the list, a blank one too", async () => {
    vi.spyOn(Date, "now").mockReturnValue(T * 1000);
    const fresh = item("fresh", T + 5);
    const video = sign(34236, [["d", "clip"], ["z", ROOT]], T + 6);
    const elsewhere = item("elsewhere", T + 5, FOOD);
    const blank = sign(39999, [["d", "gone"], ["z", ROOT], ["deleted", "true"]], T + 7);
    // dcosl sends whatever it holds, so the loader's own check is what keeps the list's items.
    const { calls } = hold({ [DCOSL]: [fresh, video, elsewhere, blank] }, [DCOSL]);
    const got: ItemEvent[] = [];

    const stop = liveItems([ROOT], (ev) => got.push(ev), [34236]);
    await Promise.resolve();
    stop();

    // The blank too: whoever holds the list merges it by identity, and the item it blanks goes.
    expect(got.map((e) => e.id).sort()).toEqual([fresh.id, video.id, blank.id].sort());
    expect(calls).toEqual([
      { op: "live", relay: DCOSL, filters: [{ kinds: [39999, 9999, 34236], "#z": [ROOT], since: T }] },
    ]);
  });

  it("listens from the second it's given: when the list's first read began", async () => {
    vi.spyOn(Date, "now").mockReturnValue((T + 30) * 1000);
    const { calls } = hold({ [DCOSL]: [] });

    liveItems([ROOT], () => {}, [], T)();

    expect(calls).toEqual([{ op: "live", relay: DCOSL, filters: [{ kinds: [39999, 9999], "#z": [ROOT], since: T }] }]);
  });

  it("subscribes to nothing for a list with nothing to file under", () => {
    const { calls } = hold({ [DCOSL]: [] });
    liveItems([], () => {})();
    expect(calls).toEqual([]);
  });
});

describe("countItems", () => {
  it("counts on the index what is filed under the list", async () => {
    const { calls } = hold({ [INDEX]: foodItems as NostrEvent[] });

    expect(await countItems([FOOD])).toBe(3);
    expect(calls).toEqual([
      { op: "count", relay: INDEX, filters: [{ kinds: [39999, 9999], "#z": [FOOD], search: "include:spam" }] },
    ]);
  });

  it("countItems is null when the index refuses", async () => {
    hold({ [INDEX]: { refuses: VESPA_REFUSAL }, [DCOSL]: foodItems as NostrEvent[] });
    expect(await countItems([FOOD])).toBeNull();
  });

  it("asks nothing for a list with nothing to file under", async () => {
    const { calls } = hold({ [INDEX]: [] });
    expect(await countItems([])).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe("searchItems", () => {
  const pizza = sign(39999, [["d", "luigi"], ["z", ROOT], ["name", "Luigi's pizza"]], T);
  const pizzaElsewhere = sign(39999, [["d", "mario"], ["z", FOOD], ["name", "Mario's pizza"]], T);

  it("asks the index alone for the list's items with the words, and keeps what is filed there", async () => {
    // The index sends both: a relay's answer is checked, not trusted.
    const { calls } = hold({ [INDEX]: [pizza, pizzaElsewhere], [DCOSL]: [pizza] }, [INDEX]);

    const found = await searchItems([ROOT], ["pizza", " ", "luigi"]);

    expect(found.map((e) => e.id)).toEqual([pizza.id]);
    expect(calls).toEqual([
      {
        op: "req",
        relay: INDEX,
        filters: [{ kinds: [39999, 9999], "#z": [ROOT], limit: 200, search: "pizza luigi include:spam" }],
      },
    ]);
  });

  it("searchItems is empty when the index refuses", async () => {
    hold({ [INDEX]: { refuses: VESPA_REFUSAL }, [DCOSL]: [pizza] });
    expect(await searchItems([ROOT], ["pizza"])).toEqual([]);
  });

  it("asks nothing without words or a list", async () => {
    const { calls } = hold({ [INDEX]: [pizza] });
    expect(await searchItems([ROOT], [])).toEqual([]);
    expect(await searchItems([ROOT], ["  "])).toEqual([]);
    expect(await searchItems([], ["pizza"])).toEqual([]);
    expect(calls).toEqual([]);
  });
});
