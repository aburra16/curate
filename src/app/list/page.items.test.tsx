// @vitest-environment jsdom
/**
 * How a list page pages its items, with the item reads scripted
 * so each step can be held and checked: the first page on mount, "Load
 * more" passing the cursor back exactly as it came, a page no relay answered
 * saying so and asked again only when the reader asks, live items starting
 * once the first page is in (a blank one removing its row), the header's
 * item kinds going to every read, the index searched past what's loaded,
 * Edit offered only where saving would change nothing, and items folded
 * only for authors the scorer actually answered for. The headers are read
 * from a pretend set of relays, as on the real page.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Filter, NostrEvent } from "nostr-tools";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildListItemEvent } from "@/lib/nostr/events";
import { DEFAULT_RELAYS } from "@/lib/nostr/relays";
import type { ItemEvent } from "@/services/concepts";
import { NOT_STARTED, type ItemsPage } from "@/services/items";
import { clearSeenOn } from "@/services/nostr";
import { DCOSL, INDEX, PROFILE_RELAYS, TAG_HUB } from "@/services/relays";
import { setTransport, type RelayTransport } from "@/services/transport";
import { clearTrustCaches, type AuthorRanks } from "@/services/trust";
import { useRelayStatus } from "@/stores/relay-status";
import { useSettings } from "@/stores/settings";
import { useSigner } from "@/stores/signer";
import { useView } from "@/stores/view";
import { relayCorpus } from "@/test/relayCorpus";
import foodHeader from "@/test/fixtures/food.header.json";

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  router: { replace: vi.fn(), push: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
  useRouter: () => nav.router,
}));
vi.mock("@/components/user-identity", () => ({
  UserIdentity: ({ pubkey }: { pubkey: string }) => <span>{pubkey.slice(0, 4)}</span>,
}));
// The real row, counting how often a row is drawn.
const drawn = vi.hoisted(() => ({ rows: 0 }));
vi.mock("@/components/item-row", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/item-row")>();
  return {
    ...actual,
    ItemRow: (props: Parameters<typeof actual.ItemRow>[0]) => {
      drawn.rows += 1;
      return <actual.ItemRow {...props} />;
    },
  };
});

const reads = vi.hoisted(() => ({
  loadItemsPage: vi.fn(),
  liveItems: vi.fn(),
  countItems: vi.fn(),
  searchItems: vi.fn(),
}));
vi.mock("@/services/items", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/items")>()),
  ...reads,
}));

// The scorer is real unless a test scripts what it answers.
const ranking = vi.hoisted(() => ({
  fetchAuthorRanks: vi.fn(),
  real: null as null | ((pubkeys: string[], observer: string) => Promise<unknown>),
}));
vi.mock("@/services/trust", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/trust")>();
  ranking.real = actual.fetchAuthorRanks;
  return { ...actual, fetchAuthorRanks: ranking.fetchAuthorRanks };
});

import ListPage from "./page";

const CURATOR = "b83a28b7e4e5d20bd960c5faeb6625f95529166b8bdb045d42634a2f35919450";
const FOOD = `39998:${CURATOR}:food-and-drink-places`;
const LISTER = "4".repeat(64);

let n = 0;
/** A Food item by `pubkey`. Item reads are scripted here, so it needn't be signed. */
const place = (name: string, created_at: number, pubkey = LISTER, extra: string[][] = []): ItemEvent => ({
  id: (++n).toString(16).padStart(64, "0"),
  pubkey,
  kind: 39999,
  created_at,
  content: "",
  tags: [["d", name.toLowerCase().replace(/\W+/g, "-")], ["z", FOOD], ["name", name], ["category", "cafe"], ...extra],
});

const page = (
  items: ItemEvent[],
  next: ItemsPage["next"],
  stalled = false,
  crowded: Pick<ItemsPage, "truncated" | "filled"> = { truncated: [], filled: [] },
): ItemsPage => ({ items, next, stalled, ...crowded });

/** What the list says when a crowded second's items couldn't all be read. */
const CUT_SHORT = /couldn.t be loaded/;
/** One of Food's crowded seconds on 31 October. */
const S = 1_791_242_721;

/** A promise the test settles when it chooses. */
function held<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (settle = resolve));
  return { promise, settle };
}

function relays(
  headers: NostrEvent[],
  {
    more = {},
    profiles = [],
    timesOut = () => false,
  }: {
    /** Other relays and what they hold. */
    more?: Record<string, NostrEvent[]>;
    profiles?: NostrEvent[];
    /** A read this says fails times out, whatever the relay holds. */
    timesOut?: (relay: string, filters: Filter[]) => boolean;
  } = {},
) {
  const { transport } = relayCorpus({
    [DCOSL]: headers,
    [TAG_HUB]: [],
    [INDEX]: headers,
    ...Object.fromEntries(PROFILE_RELAYS.map((r) => [r, profiles])),
    ...more,
  });
  const t: RelayTransport = {
    ...transport,
    req: (relay, filters, onEvent, timeoutMs) =>
      timesOut(relay, filters) ? Promise.resolve({ state: "timeout" }) : transport.req(relay, filters, onEvent, timeoutMs),
  };
  setTransport(t);
}

const SCORES = "wss://scores.example.test";

/** What the scorer says when a test scripts it: the relay's status is reported as a real read's would be. */
function scorerSays(answered: string[], ranks: [string, number][] = [], ended = true): AuthorRanks {
  useRelayStatus.getState().report(SCORES, ended ? { state: "eose" } : { state: "timeout" });
  return { ranks: new Map(ranks), source: "house", relay: SCORES, answered: new Set(answered) };
}

const foldButton = () => screen.queryByRole("button", { name: /more from accounts outside your web of trust/ });

function open(c: string) {
  nav.params = new URLSearchParams({ c, version: CURATOR });
  return render(<ListPage />);
}

const rowTitles = () => screen.queryAllByRole("heading", { level: 3 }).map((h) => h.textContent);
const loadMore = () => screen.getByRole("button", { name: "Load more" });

beforeEach(() => {
  n = 0;
  clearTrustCaches();
  clearSeenOn();
  localStorage.clear();
  sessionStorage.clear();
  useRelayStatus.getState().reset();
  useSettings.setState({ relays: [...DEFAULT_RELAYS] });
  useView.setState({ on: false, loaded: true });
  useSigner.setState({ pubkey: null, status: "disconnected", error: null });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ names: { _: "f".repeat(64) } }) })),
  );
  for (const fn of Object.values(reads)) fn.mockReset();
  ranking.fetchAuthorRanks.mockReset();
  ranking.fetchAuthorRanks.mockImplementation((pubkeys: string[], observer: string) => ranking.real!(pubkeys, observer));
  reads.liveItems.mockReturnValue(() => {});
  reads.countItems.mockResolvedValue(null);
  reads.searchItems.mockResolvedValue([]);
  relays(foodHeader as NostrEvent[]);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("paging a list's items", () => {
  it("passes the cursor back exactly as it came, skip included, and offers no more when there is none", async () => {
    const cursor = { hub: 1_792_000_000, index: null, skip: ["wss://gone.example.test"] };
    reads.loadItemsPage
      .mockResolvedValueOnce(page([place("Alpha", 1_792_000_100)], cursor))
      .mockResolvedValueOnce(page([place("Beta", 1_791_000_000)], null));
    open(FOOD);

    await screen.findByRole("heading", { level: 3, name: "Alpha" });
    expect(reads.loadItemsPage).toHaveBeenCalledWith([FOOD], undefined, []);

    fireEvent.click(loadMore());
    await screen.findByRole("heading", { level: 3, name: "Beta" });
    expect(reads.loadItemsPage).toHaveBeenLastCalledWith([FOOD], cursor, []);
    expect(rowTitles()).toEqual(["Alpha", "Beta"]);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("says a relay didn't answer, and asks again from the same place only when Load more is pressed", async () => {
    const cursor = { hub: 1_792_000_000, index: 1_791_500_000 };
    reads.loadItemsPage
      .mockResolvedValueOnce(page([place("Alpha", 1_792_000_100)], cursor))
      .mockResolvedValueOnce(page([], cursor, true))
      .mockResolvedValueOnce(page([place("Gamma", 1_790_000_000)], null));
    open(FOOD);
    await screen.findByRole("heading", { level: 3, name: "Alpha" });

    fireEvent.click(loadMore());
    expect(await screen.findByText(/A relay didn.t answer/)).toBeTruthy();
    // Nothing asks again on its own.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(reads.loadItemsPage).toHaveBeenCalledTimes(2);

    fireEvent.click(loadMore());
    await screen.findByRole("heading", { level: 3, name: "Gamma" });
    expect(reads.loadItemsPage).toHaveBeenCalledTimes(3);
    expect(reads.loadItemsPage).toHaveBeenLastCalledWith([FOOD], cursor, []);
    expect(screen.queryByText(/A relay didn.t answer/)).toBeNull();
  });

  it("a first page that throws is one nobody answered: it says so, and Load more asks for it again", async () => {
    reads.loadItemsPage
      .mockRejectedValueOnce(new Error("socket exploded"))
      .mockResolvedValueOnce(page([place("Alpha", 1_792_000_100)], null));
    open(FOOD);

    expect(await screen.findByText(/A relay didn.t answer/)).toBeTruthy();
    fireEvent.click(loadMore());
    await screen.findByRole("heading", { level: 3, name: "Alpha" });
    expect(reads.loadItemsPage).toHaveBeenLastCalledWith([FOOD], { hub: NOT_STARTED, index: NOT_STARTED }, []);
  });

  it("says items of a crowded second couldn't be loaded when no relay read it to the end, and a later page doesn't clear it", async () => {
    const cut = { relay: INDEX, second: S, filter: "#z" };
    reads.loadItemsPage
      .mockResolvedValueOnce(
        page([place("Alpha", S)], { hub: S - 1, index: S - 1 }, false, {
          truncated: [cut, { ...cut, relay: DCOSL }],
          filled: [],
        }),
      )
      .mockResolvedValueOnce(page([place("Beta", S - 100)], null));
    open(FOOD);
    await screen.findByRole("heading", { level: 3, name: "Alpha" });

    expect(screen.getByText(CUT_SHORT).textContent).toBe(
      "Some Food and Drink Places couldn't be loaded: more were listed in one second than the relays send at once.",
    );
    fireEvent.click(loadMore());
    await screen.findByRole("heading", { level: 3, name: "Beta" });
    expect(screen.queryByText(CUT_SHORT)).toBeTruthy();
  });

  it("says nothing of a second the index cut short that dcosl read to the end, on that page or a later one", async () => {
    reads.loadItemsPage
      // The index reached the second first; the hub hadn't yet.
      .mockResolvedValueOnce(
        page([place("Alpha", S)], { hub: S + 50, index: S - 1 }, false, {
          truncated: [{ relay: INDEX, second: S, filter: "#z" }],
          filled: [],
        }),
      )
      .mockResolvedValueOnce(
        page([place("Beta", S)], null, false, { truncated: [], filled: [{ relay: DCOSL, second: S, filter: "#z" }] }),
      );
    open(FOOD);
    await screen.findByRole("heading", { level: 3, name: "Alpha" });
    expect(screen.queryByText(CUT_SHORT)).toBeNull();

    fireEvent.click(loadMore());
    await screen.findByRole("heading", { level: 3, name: "Beta" });
    expect(screen.queryByText(CUT_SHORT)).toBeNull();
  });

  it("listens for new items once the first page is in, and a blank one removes its row", async () => {
    const first = held<ItemsPage>();
    reads.loadItemsPage.mockReturnValueOnce(first.promise);
    let onItem: (ev: ItemEvent) => void = () => {};
    const stop = vi.fn();
    reads.liveItems.mockImplementation((_handles: string[], handler: (ev: ItemEvent) => void) => {
      onItem = handler;
      return stop;
    });
    const alpha = place("Alpha", 1_792_000_100);
    const { unmount } = open(FOOD);

    await vi.waitFor(() => expect(reads.loadItemsPage).toHaveBeenCalled());
    expect(reads.liveItems).not.toHaveBeenCalled();
    await act(async () => first.settle(page([alpha], null)));
    await screen.findByRole("heading", { level: 3, name: "Alpha" });
    expect(reads.liveItems).toHaveBeenCalledWith([FOOD], expect.any(Function), [], expect.any(Number));

    act(() => onItem(place("Delta", 1_792_000_200)));
    await vi.waitFor(() => expect(rowTitles()).toEqual(["Delta", "Alpha"]));

    // Alpha blanked: the same address, newer, saying nothing.
    act(() => onItem({ ...alpha, id: "e".repeat(64), created_at: 1_792_000_300, tags: [["d", "alpha"], ["deleted", "true"]] }));
    await vi.waitFor(() => expect(rowTitles()).toEqual(["Delta"]));

    unmount();
    expect(stop).toHaveBeenCalled();
  });

  it("listens from when the first page was asked for, so nothing listed while it loaded is missed", async () => {
    const first = held<ItemsPage>();
    reads.loadItemsPage.mockReturnValueOnce(first.promise);
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_792_000_000_000);
    open(FOOD);
    await vi.waitFor(() => expect(reads.loadItemsPage).toHaveBeenCalled());

    // The first page takes half a minute: a crowded second is read whole.
    clock.mockReturnValue(1_792_000_030_000);
    await act(async () => first.settle(page([place("Alpha", 1_791_999_000)], null)));
    await vi.waitFor(() => expect(reads.liveItems).toHaveBeenCalled());

    expect(reads.liveItems).toHaveBeenCalledWith([FOOD], expect.any(Function), [], 1_792_000_000);
    clock.mockRestore();
  });

  it("asks for the kinds the header lists, on every page and live", async () => {
    const curator = generateSecretKey();
    const header = finalizeEvent(
      {
        kind: 39998,
        created_at: 1_792_000_000,
        content: "",
        tags: [["d", "clips"], ["names", "clip", "clips"], ["required", "title"], ["item-kind", "34236"]],
      },
      curator,
    ) as NostrEvent;
    relays([header]);
    const clips = `39998:${getPublicKey(curator)}:clips`;
    reads.loadItemsPage.mockResolvedValueOnce(page([], { hub: 5, index: null })).mockResolvedValueOnce(page([], null));
    nav.params = new URLSearchParams({ c: clips });
    render(<ListPage />);

    await vi.waitFor(() => expect(reads.liveItems).toHaveBeenCalled());
    expect(reads.loadItemsPage).toHaveBeenCalledWith([clips], undefined, [34236]);
    expect(reads.liveItems).toHaveBeenCalledWith([clips], expect.any(Function), [34236], expect.any(Number));
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await vi.waitFor(() => expect(reads.loadItemsPage).toHaveBeenLastCalledWith([clips], { hub: 5, index: null }, [34236]));
  });
});

describe("searching a list", () => {
  it("asks the index past what's loaded while more pages remain, and shows what it finds", async () => {
    reads.loadItemsPage.mockResolvedValueOnce(page([place("Alpha", 1_792_000_100)], { hub: 5, index: 5 }));
    reads.searchItems.mockResolvedValue([place("Cafe Luna", 1_700_000_000)]);
    open(FOOD);
    await screen.findByRole("heading", { level: 3, name: "Alpha" });

    fireEvent.change(screen.getByRole("searchbox", { name: "Search Food and Drink Places" }), {
      target: { value: "luna" },
    });
    expect(await screen.findByRole("heading", { level: 3, name: "Cafe Luna" }, { timeout: 2000 })).toBeTruthy();
    expect(reads.searchItems).toHaveBeenCalledWith([FOOD], ["luna"]);
    expect(rowTitles()).toEqual(["Cafe Luna"]);

    // Clearing the search shows what's loaded, and nothing the search brought in.
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    await vi.waitFor(() => expect(rowTitles()).toEqual(["Alpha"]));
  });

  it("searches only what's loaded when everything is", async () => {
    reads.loadItemsPage.mockResolvedValueOnce(page([place("Alpha", 1_792_000_100), place("Beta", 1)], null));
    open(FOOD);
    await screen.findByRole("heading", { level: 3, name: "Alpha" });

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "bet" } });
    await vi.waitFor(() => expect(rowTitles()).toEqual(["Beta"]));
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(reads.searchItems).not.toHaveBeenCalled();
  });
});

describe("editing an item", () => {
  it("offers Edit only on the reader's own items that would save unchanged", async () => {
    const reader = generateSecretKey();
    const me = getPublicKey(reader);
    const own = (name: string, extra: string[][] = []) => {
      const template = buildListItemEvent({ parentListUuid: FOOD, fields: { category: "cafe" }, name, dTag: name });
      return finalizeEvent({ ...template, tags: [...template.tags, ...extra] }, reader) as ItemEvent;
    };
    reads.loadItemsPage.mockResolvedValueOnce(
      page(
        [
          own("Mine"),
          // A tag the form doesn't model: saving it would drop the tag.
          own("Mine, tagged", [["t", "coffee"]]),
          place("Theirs", 1),
        ],
        null,
      ),
    );
    useSigner.setState({ pubkey: me, status: "connected" });
    open(FOOD);
    await screen.findByRole("heading", { level: 3, name: "Theirs" });

    const edits = screen.getAllByRole("button", { name: "Edit" });
    expect(edits).toHaveLength(1);
    expect(edits[0].closest("article")?.querySelector("h3")?.textContent).toBe("Mine");
  });
});

describe("folding by the web of trust", () => {
  it("folds only the authors whose ranks came back: a chunk that times out stays shown", async () => {
    const house = generateSecretKey();
    const ta = generateSecretKey();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ names: { _: getPublicKey(house) } }) })));
    // Asked in order, 100 at a time: the 100 "0…" authors are the first chunk, the 50 "f…" the second.
    const first = Array.from({ length: 100 }, (_, i) => (i + 1).toString(16).padStart(64, "0"));
    const second = Array.from({ length: 50 }, (_, i) => `f${(i + 1).toString(16).padStart(63, "0")}`);
    const everyone = [...first, ...second];
    const sign = (kind: number, tags: string[][], sk: Uint8Array) =>
      finalizeEvent({ kind, created_at: 1_792_800_000, content: "", tags }, sk) as NostrEvent;
    relays(foodHeader as NostrEvent[], {
      profiles: [sign(10040, [["30382:rank", getPublicKey(ta), SCORES]], house)],
      // Everyone is below the line.
      more: { [SCORES]: everyone.map((pk) => sign(30382, [["d", pk], ["rank", "1"]], ta)) },
      timesOut: (relay, filters) => relay === SCORES && (filters[0]["#d"] ?? []).includes(first[0]),
    });
    reads.loadItemsPage.mockResolvedValueOnce(
      page(
        everyone.map((pk, i) => place(`Place ${i}`, 1_792_000_000 - i, pk)),
        null,
      ),
    );
    open(FOOD);

    expect(await screen.findByRole("button", { name: "50 more from accounts outside your web of trust" })).toBeTruthy();
    expect(rowTitles()).toHaveLength(100);
    expect(screen.queryByText("outside your web of trust")).toBeNull();
  });

  it("a page whose ranks didn't come back stays shown when a later page's do, and its authors are asked again", async () => {
    const A1 = "a1".repeat(32);
    const B1 = "b1".repeat(32);
    reads.loadItemsPage
      .mockResolvedValueOnce(page([place("Alpha", 1_792_000_300, A1)], { hub: 5, index: null }))
      .mockResolvedValueOnce(page([place("Beta", 1_792_000_200, B1)], null));
    ranking.fetchAuthorRanks
      // Page 1's read times out.
      .mockImplementationOnce(async () => scorerSays([], [], false))
      // Page 2's read ends, but only B1's chunk came back (A1's timed out again); B1 is unranked.
      .mockImplementationOnce(async () => scorerSays([B1]));
    open(FOOD);
    await screen.findByRole("heading", { level: 3, name: "Alpha" });
    await vi.waitFor(() => expect(ranking.fetchAuthorRanks).toHaveBeenCalledTimes(1));
    expect(ranking.fetchAuthorRanks).toHaveBeenLastCalledWith([A1], "house");

    fireEvent.click(loadMore());
    expect(await screen.findByRole("button", { name: "1 more from accounts outside your web of trust" })).toBeTruthy();
    // A1 was asked again with the next request, and is still shown: nothing says where A1 stands.
    expect(ranking.fetchAuthorRanks).toHaveBeenLastCalledWith([A1, B1].sort(), "house");
    expect(rowTitles()).toEqual(["Alpha"]);
  });

  it("asks again for an author it has no answer for when another page comes in, though no new author did", async () => {
    const A1 = "a1".repeat(32);
    reads.loadItemsPage
      .mockResolvedValueOnce(page([place("Alpha", 1_792_000_300, A1)], { hub: 5, index: null }))
      .mockResolvedValueOnce(page([place("Beta", 1_792_000_200, A1)], null));
    ranking.fetchAuthorRanks
      .mockImplementationOnce(async () => scorerSays([], [], false))
      .mockImplementationOnce(async () => scorerSays([A1]));
    open(FOOD);
    await screen.findByRole("heading", { level: 3, name: "Alpha" });
    await vi.waitFor(() => expect(ranking.fetchAuthorRanks).toHaveBeenCalledTimes(1));
    // Nothing asks again on its own.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(ranking.fetchAuthorRanks).toHaveBeenCalledTimes(1);

    fireEvent.click(loadMore());
    // Answered now, and unranked: both of A1's items fold.
    expect(await screen.findByRole("button", { name: "2 more from accounts outside your web of trust" })).toBeTruthy();
    expect(ranking.fetchAuthorRanks).toHaveBeenCalledTimes(2);
    expect(ranking.fetchAuthorRanks).toHaveBeenLastCalledWith([A1], "house");
  });

  it("a failed read of the voters' ranks doesn't unfold the authors already answered for", async () => {
    const OUTSIDER = "a1".repeat(32);
    const FRIEND = "c1".repeat(32);
    const voter = generateSecretKey();
    const alpha = place("Alpha", 1_792_000_300, OUTSIDER);
    const gamma = place("Gamma", 1_792_000_200, FRIEND);
    const vote = finalizeEvent(
      { kind: 7, created_at: 1_792_000_400, content: "+", tags: [["e", gamma.id]] },
      voter,
    ) as NostrEvent;
    relays([...(foodHeader as NostrEvent[]), vote]);
    reads.loadItemsPage.mockResolvedValueOnce(page([alpha, gamma], null));
    ranking.fetchAuthorRanks.mockImplementation(async (pubkeys: string[]) =>
      pubkeys.includes(getPublicKey(voter))
        ? scorerSays([], [], false)
        : scorerSays(pubkeys, [[FRIEND, 50]]),
    );
    open(FOOD);

    expect(await screen.findByRole("button", { name: "1 more from accounts outside your web of trust" })).toBeTruthy();
    await vi.waitFor(() => expect(ranking.fetchAuthorRanks).toHaveBeenCalledWith([getPublicKey(voter)], "house"));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(useRelayStatus.getState().statuses[SCORES]).toBe("timeout");
    expect(rowTitles()).toEqual(["Gamma"]);
    expect(foldButton()?.textContent).toBe("1 more from accounts outside your web of trust");
  });
});

describe("drawing a long list", () => {
  it("draws 500 of 7,800 rows, Show more the next 500, and search and the fold still read every row", async () => {
    const OUTSIDER = "a1".repeat(32);
    // Every hundredth item is by an author outside the web of trust.
    const many = Array.from({ length: 7800 }, (_, i) =>
      place(`Place ${i}`, 1_792_000_000 - i, i % 100 === 99 ? OUTSIDER : LISTER),
    );
    reads.loadItemsPage.mockResolvedValueOnce(page(many, null));
    ranking.fetchAuthorRanks.mockImplementation(async (pubkeys: string[]) => scorerSays(pubkeys, [[LISTER, 50]]));
    open(FOOD);

    expect(
      await screen.findByRole("button", { name: "78 more from accounts outside your web of trust" }, { timeout: 20_000 }),
    ).toBeTruthy();
    expect(rowTitles()).toHaveLength(500);
    expect(rowTitles()[499]).toBe("Place 504");

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(rowTitles()).toHaveLength(1000);

    // The newest-but-one item, far past what's drawn, is found; the oldest, from outside, folds.
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "place 7798" } });
    await vi.waitFor(() => expect(rowTitles()).toEqual(["Place 7798"]));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "place 7799" } });
    expect(await screen.findByRole("button", { name: "1 more from accounts outside your web of trust" })).toBeTruthy();
    expect(rowTitles()).toEqual([]);
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  }, 60_000);

  it("a search keystroke draws no row again that it still shows unchanged", async () => {
    reads.loadItemsPage.mockResolvedValueOnce(
      page([place("Alpha", 1_792_000_300), place("Beta", 1_792_000_200), place("Gamma", 1_792_000_100)], null),
    );
    ranking.fetchAuthorRanks.mockImplementation(async (pubkeys: string[]) => scorerSays(pubkeys, [[LISTER, 50]]));
    open(FOOD);
    await screen.findByRole("heading", { level: 3, name: "Gamma" });
    // Let the ranks, votes and templates come in.
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));

    drawn.rows = 0;
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "a" } });
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(rowTitles()).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(drawn.rows).toBe(0);
  });
});
