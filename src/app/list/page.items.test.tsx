// @vitest-environment jsdom
/**
 * How a list page pages its items, with the item reads scripted
 * so each step can be held and checked: the first page on mount, "Load
 * more" passing the cursor back exactly as it came, a page no relay answered
 * saying so and asked again only when the reader asks, live items starting
 * once the first page is in (a blank one removing its row), the header's
 * item kinds going to every read, the index searched past what's loaded,
 * items added and changed through the list's own definition (Edit offered only
 * on the reader's own addressable items), and items folded only for authors the
 * scorer actually answered for. The headers are read from a pretend set of
 * relays, as on the real page.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { Filter, NostrEvent } from "nostr-tools";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RELAYS } from "@/lib/nostr/relays";
import type { ItemEvent } from "@/services/concepts";
import { NOT_STARTED, type ItemsPage } from "@/services/items";
import { clearSeenOn } from "@/services/nostr";
import type { PublishResult } from "@/services/publish";
import { DCOSL, INDEX, PROFILE_RELAYS, TAG_HUB } from "@/services/relays";
import { setTransport, type RelayTransport } from "@/services/transport";
import { clearTrustCaches, type AuthorRanks } from "@/services/trust";
import { useRelayStatus } from "@/stores/relay-status";
import { useSettings } from "@/stores/settings";
import { useSigner } from "@/stores/signer";
import { useView } from "@/stores/view";
import { relayCorpus } from "@/test/relayCorpus";
import foodHeader from "@/test/fixtures/food.header.json";
import tagsHeaders from "@/test/fixtures/tags.headers.json";

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

vi.mock("@/services/publish", () => ({ signAndPublish: vi.fn(), retryPublish: vi.fn() }));

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

import { signAndPublish } from "@/services/publish";
import ListPage from "./page";

const CURATOR = "b83a28b7e4e5d20bd960c5faeb6625f95529166b8bdb045d42634a2f35919450";
const FOOD = `39998:${CURATOR}:food-and-drink-places`;
const LISTER = "4".repeat(64);
const READER = "5".repeat(64);
/** Where the real Tags concept lives. */
const TAGS_ROOT = "39998:82b75e474dda005e912bcbb910391c60c2b89cc7faf5d3c30b7c59a324973833:tag";

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
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

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
  vi.mocked(signAndPublish).mockReset();
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

const signIn = (pubkey: string) =>
  useSigner.setState({ pubkey, method: "extension", status: "connected", error: null });

/** What the list relay would hand back for a template: the template, signed by `pubkey`, as the newest event there is. */
const signedBy = (pubkey: string, template: { kind: number; content: string; tags: string[][] }): PublishResult => {
  const event: NostrEvent = {
    ...template,
    id: "f".repeat(64),
    pubkey,
    created_at: 1_793_000_000,
    sig: "5".repeat(128),
  };
  return { event, onHub: true, hubMessage: null, accepted: [DCOSL], failed: [] };
};

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const rowOf = (title: string) => screen.getByRole("heading", { level: 3, name: title }).closest("article")!;

describe("adding an item", () => {
  it("offers the list's singular name on the button, from the list's own header", async () => {
    signIn(READER);
    reads.loadItemsPage.mockResolvedValueOnce(page([place("Alpha", 1_792_000_100)], null));
    open(FOOD);

    expect(await screen.findByRole("button", { name: "+ Add Food and Drink Place" })).toBeTruthy();
  });

  it("reads the singular from the list's names, not from its short name", async () => {
    signIn(READER);
    const curator = generateSecretKey();
    const header = finalizeEvent(
      {
        kind: 39998,
        created_at: 1_792_000_000,
        content: "",
        tags: [
          ["d", "videos"],
          ["names", "clip", "clips"],
          ["required", "title"],
        ],
      },
      curator,
    ) as NostrEvent;
    relays([header]);
    reads.loadItemsPage.mockResolvedValueOnce(page([], null));
    nav.params = new URLSearchParams({ c: `39998:${getPublicKey(curator)}:videos` });
    render(<ListPage />);

    expect(await screen.findByRole("button", { name: "+ Add clip" })).toBeTruthy();
  });

  it("offers no form, and says why, on a list that declares no fields", async () => {
    signIn(READER);
    relays(tagsHeaders as NostrEvent[]);
    reads.loadItemsPage.mockResolvedValueOnce(page([], null));
    nav.params = new URLSearchParams({ c: TAGS_ROOT });
    render(<ListPage />);

    expect(
      await screen.findByText("This list declares no fields, so there is nothing for Curate's form to fill in."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add|Connect to add/ })).toBeNull();
    expect(screen.queryByText("Be the first to add something to this list.")).toBeNull();
  });

  it("invites a reader who isn't connected to connect, and opens no form", async () => {
    reads.loadItemsPage.mockResolvedValueOnce(page([place("Alpha", 1_792_000_100)], null));
    open(FOOD);
    await screen.findByRole("heading", { level: 3, name: "Alpha" });

    const invite = screen.getByRole("button", { name: "Connect to add a Food and Drink Place" }) as HTMLButtonElement;
    expect(invite.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /^\+ Add/ })).toBeNull();
  });

  it("asks for the list's fields, publishes the item under the list, and shows it at the top once the list relay has it", async () => {
    signIn(READER);
    reads.loadItemsPage.mockResolvedValueOnce(page([place("Alpha", 1_792_000_100)], null));
    vi.mocked(signAndPublish).mockImplementation(async (template) => signedBy(READER, template));
    open(FOOD);
    await screen.findByRole("heading", { level: 3, name: "Alpha" });

    fireEvent.click(screen.getByRole("button", { name: "+ Add Food and Drink Place" }));
    type("name", "Cafe Luna");
    type("category", "cafe");
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await screen.findByRole("heading", { level: 3, name: "Cafe Luna" });
    expect(signAndPublish).toHaveBeenCalledTimes(1);
    const { tags } = vi.mocked(signAndPublish).mock.calls[0][0];
    expect(tags).toContainEqual(["z", FOOD]);
    expect(tags).toContainEqual(["name", "Cafe Luna"]);
    expect(rowTitles()).toEqual(["Cafe Luna", "Alpha"]);
    // The form has gone, and the button is back.
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.getByRole("button", { name: "+ Add Food and Drink Place" })).toBeTruthy();
  });

  it("keeps the form and the note when one of the author's own relays missed the item, and adds the item when Done is pressed", async () => {
    signIn(READER);
    reads.loadItemsPage.mockResolvedValueOnce(page([place("Alpha", 1_792_000_100)], null));
    vi.mocked(signAndPublish).mockImplementation(async (template) => ({
      ...signedBy(READER, template),
      failed: [{ ok: false, from: "wss://own.example.test", message: "timed out" }],
    }));
    open(FOOD);
    await screen.findByRole("heading", { level: 3, name: "Alpha" });

    fireEvent.click(screen.getByRole("button", { name: "+ Add Food and Drink Place" }));
    type("name", "Cafe Luna");
    type("category", "cafe");
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    expect(await screen.findByText(/Not saved to 1 of your own relays: own\.example\.test/)).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 3, name: "Cafe Luna" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(rowTitles()).toEqual(["Cafe Luna", "Alpha"]);
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("leaves the list as it was when the person cancels", async () => {
    signIn(READER);
    reads.loadItemsPage.mockResolvedValueOnce(page([place("Alpha", 1_792_000_100)], null));
    open(FOOD);
    await screen.findByRole("heading", { level: 3, name: "Alpha" });

    fireEvent.click(screen.getByRole("button", { name: "+ Add Food and Drink Place" }));
    expect(screen.getByRole("form", { name: "Add Food and Drink Place" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("form")).toBeNull();
    expect(signAndPublish).not.toHaveBeenCalled();
  });

  it("offers nothing to add to when the list's header wasn't found", async () => {
    signIn(READER);
    const GHOST = `39998:${"a".repeat(64)}:ghost`;
    const ghost = {
      ...place("Ghost", 1_792_000_100, READER),
      tags: [
        ["d", "ghost"],
        ["z", GHOST],
        ["name", "Ghost"],
      ],
    };
    reads.loadItemsPage.mockResolvedValueOnce(page([ghost], null));
    open(GHOST);
    // With no header, every row is untitled.
    await screen.findAllByRole("heading", { level: 3 });

    expect(screen.queryByRole("button", { name: /Add|Connect to add/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});

describe("editing an item", () => {
  const own = (name: string, created_at: number, extra: string[][] = []) => place(name, created_at, READER, extra);

  it("offers Edit on the reader's own addressable items, whatever else they carry, and on no other", async () => {
    reads.loadItemsPage.mockResolvedValueOnce(
      page(
        [
          own("Mine", 1_792_000_500),
          // Tags the list doesn't declare: saving keeps them.
          own("Mine, tagged", 1_792_000_400, [["t", "coffee"], ["hours", "7 to 5"]]),
          // A 9999 can't be replaced by an edit.
          { ...own("Mine, short", 1_792_000_300), kind: 9999 },
          place("Theirs", 1_792_000_200),
        ],
        null,
      ),
    );
    signIn(READER);
    open(FOOD);
    await screen.findByRole("heading", { level: 3, name: "Theirs" });

    const edits = screen.getAllByRole("button", { name: "Edit" });
    expect(edits.map((edit) => edit.closest("article")?.querySelector("h3")?.textContent)).toEqual([
      "Mine",
      "Mine, tagged",
    ]);
  });

  it("offers no Edit on a list that declares no fields", async () => {
    signIn(READER);
    relays(tagsHeaders as NostrEvent[]);
    const mine: ItemEvent = {
      id: "7".repeat(64),
      pubkey: READER,
      kind: 39999,
      created_at: 1_792_000_100,
      content: "",
      tags: [
        ["d", "espresso"],
        ["z", TAGS_ROOT],
      ],
    };
    reads.loadItemsPage.mockResolvedValueOnce(page([mine], null));
    nav.params = new URLSearchParams({ c: TAGS_ROOT });
    render(<ListPage />);
    await screen.findAllByRole("heading", { level: 3 });

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("offers Edit to no one who isn't connected", async () => {
    reads.loadItemsPage.mockResolvedValueOnce(page([own("Mine", 1_792_000_500)], null));
    open(FOOD);
    await screen.findByRole("heading", { level: 3, name: "Mine" });

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("starts from the item's values, publishes the changed field only, and shows the change in place", async () => {
    const mine = own("Cafe Luna", 1_792_000_500, [["locality", "Lisbon"], ["t", "coffee"]]);
    reads.loadItemsPage.mockResolvedValueOnce(page([mine, place("Alpha", 1_792_000_100)], null));
    vi.mocked(signAndPublish).mockImplementation(async (template) => {
      const result = signedBy(READER, template);
      return { ...result, event: { ...result.event, tags: template.tags } };
    });
    signIn(READER);
    open(FOOD);
    await screen.findByRole("heading", { level: 3, name: "Cafe Luna" });

    fireEvent.click(within(rowOf("Cafe Luna")).getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("form", { name: "Edit Food and Drink Place" })).toBeTruthy();
    expect(field("name").value).toBe("Cafe Luna");
    expect(field("locality").value).toBe("Lisbon");

    type("name", "Cafe Lua");
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await screen.findByRole("heading", { level: 3, name: "Cafe Lua" });
    expect(signAndPublish).toHaveBeenCalledTimes(1);
    expect(vi.mocked(signAndPublish).mock.calls[0][0].tags).toEqual(
      mine.tags.map((t) => (t[0] === "name" ? ["name", "Cafe Lua"] : t)),
    );
    expect(rowTitles()).toEqual(["Cafe Lua", "Alpha"]);
    expect(screen.queryByRole("form")).toBeNull();
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
