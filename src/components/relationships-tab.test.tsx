// @vitest-environment jsdom
/**
 * The Relationships tab: what an item or a list is connected to, drawn from
 * what the service read. The service is faked here (its own tests read the
 * relays); these cases are what a person sees: each section and its count,
 * sections that hide when empty, the fold for people outside the web of
 * trust, the relays that didn't answer, and where each link goes.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { NostrEvent } from "nostr-tools/pure";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSigner } from "@/stores/signer";
import type { Related, Relationships } from "@/services/relationships";

vi.mock("@/components/user-identity", () => ({
  UserIdentity: ({ pubkey }: { pubkey: string }) => <span data-testid="person">{pubkey.slice(0, 4)}</span>,
}));
const service = vi.hoisted(() => ({ loadRelationships: vi.fn() }));
vi.mock("@/services/relationships", () => service);
const scorer = vi.hoisted(() => ({ fetchAuthorRanks: vi.fn() }));
vi.mock("@/services/trust", async (original) => ({
  ...(await original<typeof import("@/services/trust")>()),
  fetchAuthorRanks: scorer.fetchAuthorRanks,
}));

import { RelationshipsTab } from "./relationships-tab";

const hex = (byte: string) => byte.repeat(32);
const OWNER = hex("11");
const CURATOR = hex("22");
const READER = hex("33");
const MENTIONER = hex("44");
const PROPRIETOR = hex("55");
const COFFEE = `39998:${OWNER}:coffee-places`;
const FAVOURITES = `39998:${CURATOR}:favourite-cafes`;
const WALKS = `39998:${MENTIONER}:cafes-worth-the-walk`;
const ITEM_ID = hex("ab");

const event = (over: Partial<NostrEvent> & { tags: string[][] }): NostrEvent => ({
  id: ITEM_ID,
  pubkey: OWNER,
  kind: 39999,
  created_at: 1_790_000_000,
  content: "",
  sig: "0".repeat(128),
  ...over,
});

const item = event({ tags: [["d", "blue-door-cafe"], ["z", COFFEE], ["name", "Blue Door Cafe"]] });
const header = event({ id: hex("cd"), kind: 39998, tags: [["d", "coffee-places"], ["names", "Coffee place", "Coffee places"]] });

const eventHref = (value: string) => `/list?c=x&item=${encodeURIComponent(value)}`;

const NONE: Relationships = {
  lists: [],
  copies: [],
  tags: [],
  mentions: [],
  names: [],
  folded: { copies: [], mentions: [] },
  unread: [],
};

/** What the service reads, with `over` on top of nothing found. */
const found = (over: Partial<Relationships> = {}): Relationships => ({ ...NONE, ...over });

const related = (ev: NostrEvent, listRef: string | null, listName: string | null): Related => ({ event: ev, listRef, listName });
const copyOf = event({
  id: hex("c1"),
  pubkey: CURATOR,
  tags: [["d", "copy-blue-door-cafe"], ["z", FAVOURITES], ["q", ITEM_ID], ["name", "Blue Door Cafe, my pick"]],
});
const mention = event({ id: hex("e1"), pubkey: MENTIONER, tags: [["d", "walk-1"], ["z", WALKS], ["a", `39999:${OWNER}:blue-door-cafe`], ["name", "Start here"]] });
const secondMention = event({ id: hex("e2"), pubkey: MENTIONER, tags: [["d", "walk-2"], ["z", WALKS], ["e", ITEM_ID], ["name", "And then"]] });

function tab(props: { event?: NostrEvent; ranks?: Map<string, number>; answered?: Set<string> } = {}) {
  return render(
    <RelationshipsTab
      event={props.event ?? item}
      ranks={props.ranks ?? new Map()}
      answered={props.answered ?? new Set()}
      eventHref={eventHref}
    />,
  );
}

/** The section with this heading. */
const section = (title: string) => {
  const heading = screen.getByRole("heading", { name: new RegExp(`^${title}\\b`) });
  return within(heading.closest("section")!);
};
const headings = () => screen.queryAllByRole("heading").map((h) => h.textContent);

beforeEach(() => {
  service.loadRelationships.mockReset();
  service.loadRelationships.mockResolvedValue(found());
  scorer.fetchAuthorRanks.mockReset();
  scorer.fetchAuthorRanks.mockResolvedValue({ ranks: new Map() });
  useSigner.setState({ pubkey: null, status: "disconnected", error: null });
});

describe("loading", () => {
  it("says it is reading, in each section an item has, until the service answers", async () => {
    let answer!: (r: Relationships) => void;
    service.loadRelationships.mockReturnValue(new Promise<Relationships>((resolve) => (answer = resolve)));
    tab();
    expect(headings()).toEqual(["On these lists", "Copies", "Tags", "Mentioned by", "This item names"]);
    expect(screen.getAllByText("Reading…")).toHaveLength(5);

    await act(async () => answer(found({ tags: [{ name: "Cosy", address: "x", applied: 1, disputed: 0, mine: null }] })));
    expect(screen.queryByText("Reading…")).toBeNull();
    expect(headings()).toEqual(["Tags 1"]);
  });

  it("a list header has no On these lists and no Copies, and names what the list names", () => {
    service.loadRelationships.mockReturnValue(new Promise(() => {}));
    tab({ event: header });
    expect(headings()).toEqual(["Tags", "Mentioned by", "This list names"]);
  });

  it("says when the read fails, and tries again on request", async () => {
    service.loadRelationships.mockRejectedValueOnce(new Error("boom"));
    tab();
    expect(await screen.findByText("Could not read what this is connected to.")).toBeTruthy();
    expect(screen.queryByText("Nothing links here yet")).toBeNull();

    service.loadRelationships.mockResolvedValueOnce(found({ lists: [{ ref: COFFEE, name: "Coffee places" }] }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Coffee places" })).toBeTruthy();
    expect(service.loadRelationships).toHaveBeenCalledTimes(2);
  });

  it("announces a failed read, and puts focus on the tab's page, not the document, when it tries again", async () => {
    service.loadRelationships.mockRejectedValueOnce(new Error("boom"));
    service.loadRelationships.mockReturnValueOnce(new Promise(() => {}));
    const { container } = tab();
    expect((await screen.findByRole("alert")).textContent).toBe("Could not read what this is connected to.");

    const retry = screen.getByRole("button", { name: "Try again" });
    retry.focus();
    fireEvent.click(retry);
    expect(retry.isConnected).toBe(false);
    expect(document.activeElement).toBe(container.firstElementChild);
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getAllByText("Reading\u2026").length).toBeGreaterThan(0);
  });
});

describe("what it reads, and when", () => {
  it("reads once on opening, with the page's ranks and the reader, and not again when ranks or the page move", async () => {
    const ranks = new Map([[CURATOR, 3]]);
    const answered = new Set([CURATOR]);
    const { rerender } = tab({ ranks, answered });
    await screen.findByText("Nothing links here yet");
    expect(service.loadRelationships).toHaveBeenCalledTimes(1);
    const args = service.loadRelationships.mock.calls[0];
    expect(args[0]).toBe(item);
    expect(args[1]).toBe(ranks);
    expect(args[2]).toBe(answered);
    expect(args[3]).toBeNull();

    // More people ranked, and the event drawn again as another object of the same id: nothing is read again.
    rerender(
      <RelationshipsTab
        event={{ ...item }}
        ranks={new Map([...ranks, [MENTIONER, 2]])}
        answered={new Set([...answered, MENTIONER])}
        eventHref={eventHref}
      />,
    );
    await act(async () => {});
    expect(service.loadRelationships).toHaveBeenCalledTimes(1);
  });

  it("reads again for another event, and for another reader", async () => {
    const { rerender } = tab();
    await screen.findByText("Nothing links here yet");
    rerender(<RelationshipsTab event={copyOf} ranks={new Map()} answered={new Set()} eventHref={eventHref} />);
    await act(async () => {});
    expect(service.loadRelationships).toHaveBeenCalledTimes(2);
    expect(service.loadRelationships.mock.calls[1][0]).toBe(copyOf);

    await act(async () => useSigner.setState({ pubkey: READER, status: "connected", error: null }));
    expect(service.loadRelationships).toHaveBeenCalledTimes(3);
    expect(service.loadRelationships.mock.calls[2][3]).toBe(READER);
  });

  it("shows nothing of an old event while the next is read", async () => {
    service.loadRelationships.mockResolvedValueOnce(found({ lists: [{ ref: COFFEE, name: "Coffee places" }] }));
    const { rerender } = tab();
    await screen.findByRole("link", { name: "Coffee places" });
    service.loadRelationships.mockReturnValue(new Promise(() => {}));
    rerender(<RelationshipsTab event={copyOf} ranks={new Map()} answered={new Set()} eventHref={eventHref} />);
    expect(screen.queryByRole("link", { name: "Coffee places" })).toBeNull();
    expect(screen.getAllByText("Reading…").length).toBeGreaterThan(0);
  });

  it("asks the reader's scorer for everyone else: the house signed out, the reader's own when connected", async () => {
    tab();
    await screen.findByText("Nothing links here yet");
    const rankMore = service.loadRelationships.mock.calls[0][4] as (pks: string[]) => Promise<unknown>;
    await rankMore([MENTIONER]);
    expect(scorer.fetchAuthorRanks).toHaveBeenLastCalledWith([MENTIONER], "house");

    await act(async () => useSigner.setState({ pubkey: READER, status: "connected", error: null }));
    const again = service.loadRelationships.mock.calls[1][4] as (pks: string[]) => Promise<unknown>;
    await again([MENTIONER]);
    expect(scorer.fetchAuthorRanks).toHaveBeenLastCalledWith([MENTIONER], READER);
  });
});

describe("the sections of an item", () => {
  it("On these lists names each list and links to it, by its reference when its name wasn't read", async () => {
    service.loadRelationships.mockResolvedValue(
      found({ lists: [{ ref: COFFEE, name: "Coffee places" }, { ref: `39998:${OWNER}:closed-places`, name: null }] }),
    );
    tab();
    expect(await screen.findByRole("heading", { name: "On these lists 2" })).toBeTruthy();
    const lists = section("On these lists");
    expect(lists.getByRole("link", { name: "Coffee places" }).getAttribute("href")).toBe(`/list?c=${encodeURIComponent(COFFEE)}`);
    expect(lists.getByRole("link", { name: `39998:${OWNER}:closed-places` }).getAttribute("href")).toBe(
      `/list?c=${encodeURIComponent(`39998:${OWNER}:closed-places`)}`,
    );
  });

  it("Copies shows each copy by its title, who made it and the list it is on, linked into that list", async () => {
    service.loadRelationships.mockResolvedValue(found({ copies: [related(copyOf, FAVOURITES, "Favourite cafes")] }));
    tab();
    await screen.findByRole("heading", { name: "Copies 1" });
    const row = within(section("Copies").getByRole("listitem"));
    expect(row.getByRole("link", { name: "Blue Door Cafe, my pick" }).getAttribute("href")).toBe(
      `/list?c=${encodeURIComponent(FAVOURITES)}&item=${encodeURIComponent(`39999:${CURATOR}:copy-blue-door-cafe`)}`,
    );
    expect(row.getByTestId("person").textContent).toBe(CURATOR.slice(0, 4));
    expect(row.getByRole("link", { name: "Favourite cafes" }).getAttribute("href")).toBe(`/list?c=${encodeURIComponent(FAVOURITES)}`);
  });

  it("Tags shows each tag's name with its counts, leaving out a count of none, and the reader's own stance", async () => {
    service.loadRelationships.mockResolvedValue(
      found({
        tags: [
          { name: "Cosy", address: "a1", applied: 3, disputed: 1, mine: null },
          { name: "Quiet corner", address: "a2", applied: 1, disputed: 0, mine: "apply" },
          { name: "Overpriced", address: "a3", applied: 0, disputed: 2, mine: "dispute" },
          { name: "Mine alone", address: "a4", applied: 0, disputed: 0, mine: "apply" },
        ],
      }),
    );
    tab();
    await screen.findByRole("heading", { name: "Tags 4" });
    const chips = section("Tags").getAllByRole("listitem");
    expect(chips.map((c) => c.textContent)).toEqual([
      "Cosy applied by 3 disputed by 1",
      "Quiet corner applied by 1 you applied",
      "Overpriced disputed by 2 you disputed",
      "Mine alone you applied",
    ]);
    expect(section("Tags").queryByText(/by 0/)).toBeNull();
  });

  it("Mentioned by groups the items under the list each is on, by its name", async () => {
    const stray = event({ id: hex("e3"), pubkey: MENTIONER, kind: 9999, tags: [["e", ITEM_ID], ["name", "Strays"]] });
    service.loadRelationships.mockResolvedValue(
      found({
        mentions: [
          related(mention, WALKS, "Cafes worth the walk"),
          related(secondMention, WALKS, "Cafes worth the walk"),
          related(stray, null, null),
        ],
      }),
    );
    tab();
    await screen.findByRole("heading", { name: "Mentioned by 3" });
    const groups = section("Mentioned by").getAllByRole("group");
    // Each is named by its own heading, not by a second copy of the same words.
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual([null, null]);
    expect(groups.map((g) => within(g).getByRole("heading", { level: 4 }).textContent)).toEqual([
      "Cafes worth the walk",
      "Not on a list",
    ]);
    expect(screen.getByRole("group", { name: "Cafes worth the walk" })).toBe(groups[0]);
    expect(screen.getByRole("group", { name: "Not on a list" })).toBe(groups[1]);
    const walks = within(groups[0]);
    expect(walks.getByRole("link", { name: "Cafes worth the walk" }).getAttribute("href")).toBe(`/list?c=${encodeURIComponent(WALKS)}`);
    const rows = walks.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByRole("link", { name: "And then" }).getAttribute("href")).toBe(
      `/list?c=${encodeURIComponent(WALKS)}&item=${encodeURIComponent(`39999:${MENTIONER}:walk-2`)}`,
    );
    expect(within(rows[0]).getByTestId("person").textContent).toBe(MENTIONER.slice(0, 4));
    expect(walks.getByRole("link", { name: "Start here" }).getAttribute("href")).toBe(
      `/list?c=${encodeURIComponent(WALKS)}&item=${encodeURIComponent(`39999:${MENTIONER}:walk-1`)}`,
    );
    // A 9999 has no address: it is named by its id. With no list to open it in, it is a title and its id to copy.
    const strays = within(groups[1]);
    expect(strays.queryByRole("link", { name: "Strays" })).toBeNull();
    expect(strays.getByText("Strays")).toBeTruthy();
    expect(strays.getByRole("button", { name: `Copy event id ${stray.id.slice(0, 8)}…${stray.id.slice(-4)}` })).toBeTruthy();
  });

  it("This item names shows a person by name, links a list or an item, and gives anything else to copy", async () => {
    const OTHER_ITEM = `39999:${OWNER}:other-cafe`;
    const OTHER_ID = hex("ee");
    service.loadRelationships.mockResolvedValue(
      found({
        names: [
          { tag: "p", value: PROPRIETOR },
          { tag: "t", value: "coffee" },
          { tag: "e", value: OTHER_ID },
          { tag: "a", value: OTHER_ITEM },
          { tag: "a", value: COFFEE },
          { tag: "a", value: `30023:${OWNER}:an-article` },
        ],
      }),
    );
    tab();
    await screen.findByRole("heading", { name: "This item names 6" });
    const names = section("This item names");
    const [person, hashtag, byId, itemAddress, listAddress, other] = names.getAllByRole("listitem").map((li) => within(li));

    expect(person.getByTestId("person").textContent).toBe(PROPRIETOR.slice(0, 4));
    expect(hashtag.getByText("coffee")).toBeTruthy();
    expect(hashtag.getByRole("button", { name: "Copy hashtag coffee" })).toBeTruthy();
    // An event or an item opens in the panel; a list opens its page.
    expect(byId.getByRole("link", { name: OTHER_ID }).getAttribute("href")).toBe(eventHref(OTHER_ID));
    expect(itemAddress.getByRole("link", { name: OTHER_ITEM }).getAttribute("href")).toBe(eventHref(OTHER_ITEM));
    expect(listAddress.getByRole("link", { name: COFFEE }).getAttribute("href")).toBe(`/list?c=${encodeURIComponent(COFFEE)}`);
    // Anything that is not a list or an item is its value, to copy.
    expect(other.queryByRole("link")).toBeNull();
    expect(other.getByText(`30023:${OWNER}:an-article`)).toBeTruthy();
    // The name carries the value, an address with its key cut short.
    expect(other.getByRole("button", { name: `Copy address 30023:${OWNER.slice(0, 8)}…${OWNER.slice(-4)}:an-article` })).toBeTruthy();
  });

  it("copies a value to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    service.loadRelationships.mockResolvedValue(found({ names: [{ tag: "t", value: "coffee" }] }));
    tab();
    fireEvent.click(await screen.findByRole("button", { name: "Copy hashtag coffee" }));
    expect(writeText).toHaveBeenCalledWith("coffee");
    vi.unstubAllGlobals();
  });

  it("shows no one's rank", async () => {
    service.loadRelationships.mockResolvedValue(
      found({
        copies: [related(copyOf, FAVOURITES, "Favourite cafes")],
        tags: [{ name: "Cosy", address: "a1", applied: 3, disputed: 0, mine: null }],
      }),
    );
    const { container } = tab({ ranks: new Map([[CURATOR, 97]]), answered: new Set([CURATOR]) });
    await screen.findByRole("heading", { name: "Tags 1" });
    expect(container.textContent).not.toMatch(/97|rank/i);
  });
});

describe("sections that are empty", () => {
  it("hide, leaving only the ones that have something", async () => {
    service.loadRelationships.mockResolvedValue(found({ mentions: [related(mention, WALKS, "Cafes worth the walk")] }));
    tab();
    await screen.findByRole("heading", { name: "Mentioned by 1" });
    expect(headings()).toEqual(["Mentioned by 1", "Cafes worth the walk"]);
    expect(screen.queryByText("Nothing links here yet")).toBeNull();
  });

  it("give way to one line when every section is empty", async () => {
    tab();
    expect(await screen.findByText("Nothing links here yet")).toBeTruthy();
    expect(screen.queryAllByRole("heading")).toEqual([]);
  });

  it("for a header, read the same way", async () => {
    service.loadRelationships.mockResolvedValue(
      found({ names: [{ tag: "a", value: `39998:${OWNER}:other-list` }], mentions: [related(mention, WALKS, "Cafes worth the walk")] }),
    );
    tab({ event: header });
    await screen.findByRole("heading", { name: "This list names 1" });
    expect(headings()).toEqual(["Mentioned by 1", "Cafes worth the walk", "This list names 1"]);
  });
});

describe("people outside the web of trust", () => {
  const outsider = event({ id: hex("e9"), pubkey: hex("99"), tags: [["d", "walk-9"], ["z", WALKS], ["a", `39999:${OWNER}:blue-door-cafe`], ["name", "From a stranger"]] });
  const outsiderCopy = event({ id: hex("c9"), pubkey: hex("98"), tags: [["d", "copy-blue-door-cafe"], ["z", FAVOURITES], ["q", ITEM_ID], ["name", "A stranger's copy"]] });

  it("are folded away, with a count, and opened in place", async () => {
    service.loadRelationships.mockResolvedValue(
      found({
        mentions: [related(mention, WALKS, "Cafes worth the walk")],
        folded: { copies: [related(outsiderCopy, FAVOURITES, "Favourite cafes")], mentions: [related(outsider, WALKS, "Cafes worth the walk")] },
      }),
    );
    tab();
    const fold = await screen.findByRole("button", { name: "From outside your web of trust (2)" });
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    // Not counted in the sections' own counts, and not drawn until asked for.
    expect(screen.getByRole("heading", { name: "Mentioned by 1" })).toBeTruthy();
    expect(screen.queryByText("From a stranger")).toBeNull();
    expect(screen.queryByText("A stranger's copy")).toBeNull();

    fireEvent.click(fold);
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "From a stranger" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "A stranger's copy" })).toBeTruthy();
    // The people involved are named, never ranked.
    const copies = screen.getByRole("heading", { name: "Copies 1" }).closest("section")!;
    expect(within(copies).getByTestId("person").textContent).toBe(hex("98").slice(0, 4));
  });

  it("keep the headings in order when they are all there is: sections, then each list under its section", async () => {
    service.loadRelationships.mockResolvedValue(
      found({ folded: { copies: [related(outsiderCopy, FAVOURITES, "Favourite cafes")], mentions: [related(outsider, WALKS, "Cafes worth the walk")] } }),
    );
    tab();
    fireEvent.click(await screen.findByRole("button", { name: "From outside your web of trust (2)" }));
    expect(screen.getAllByRole("heading").map((h) => [h.tagName, h.textContent])).toEqual([
      ["H3", "Copies 1"],
      ["H3", "Mentioned by 1"],
      ["H4", "Cafes worth the walk"],
    ]);
  });

  it("are all there is: the fold shows, and the page does not say nothing links here", async () => {
    service.loadRelationships.mockResolvedValue(found({ folded: { copies: [], mentions: [related(outsider, WALKS, "Cafes worth the walk")] } }));
    tab();
    await screen.findByRole("button", { name: "From outside your web of trust (1)" });
    expect(screen.queryByText("Nothing links here yet")).toBeNull();
  });

  it("are not folded when there are none", async () => {
    service.loadRelationships.mockResolvedValue(found({ lists: [{ ref: COFFEE, name: "Coffee places" }] }));
    tab();
    await screen.findByRole("link", { name: "Coffee places" });
    expect(screen.queryByText(/outside your web of trust/)).toBeNull();
  });
});

describe("relays that didn't answer", () => {
  it("are named in a quiet note, beside what was read", async () => {
    service.loadRelationships.mockResolvedValue(
      found({ lists: [{ ref: COFFEE, name: "Coffee places" }], unread: ["wss://one.example", "wss://two.example"] }),
    );
    tab();
    const note = await screen.findByRole("note");
    expect(note.textContent).toBe("Didn’t answer: wss://one.example, wss://two.example. Anything only they hold is missing here.");
    expect(screen.getByRole("link", { name: "Coffee places" })).toBeTruthy();
  });

  it("are named when nothing else was found too", async () => {
    service.loadRelationships.mockResolvedValue(found({ unread: ["wss://one.example"] }));
    tab();
    expect(await screen.findByText("Nothing links here yet")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toMatch(/wss:\/\/one\.example/);
  });

  it("add no note when every relay answered", async () => {
    tab();
    await screen.findByText("Nothing links here yet");
    expect(screen.queryByRole("note")).toBeNull();
  });
});
