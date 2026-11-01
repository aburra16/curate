// @vitest-environment jsdom
/**
 * The event panel: any item or header opened as a dialog with
 * Item, Pretty and Raw. These tests read it as a person would: the tabs, the
 * tag table's labels and links, what a hostile value does, the copy button,
 * and the dialog's focus.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { NostrEvent } from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { definitionOf, type HeaderEvent } from "@/lib/conceptResolution";
import booksHeaders from "@/test/fixtures/books.header.json";
import booksItems from "@/test/fixtures/books.items.json";
import foodCopies from "@/test/fixtures/food.copies.json";
import foodHeaders from "@/test/fixtures/food.header.json";
import foodItems from "@/test/fixtures/food.items.json";
import tagHeaders from "@/test/fixtures/tags.headers.json";
import tagItems from "@/test/fixtures/tags.items.json";

vi.mock("@/components/user-identity", () => ({
  UserIdentity: ({ pubkey }: { pubkey: string }) => <span data-testid="person">{pubkey.slice(0, 4)}</span>,
}));
const templates = vi.hoisted(() => ({ fetchTemplates: vi.fn() }));
vi.mock("@/services/templates", () => templates);
const relays = vi.hoisted(() => ({ seenOn: vi.fn() }));
vi.mock("@/services/nostr", () => relays);
const relationships = vi.hoisted(() => ({ loadRelationships: vi.fn() }));
vi.mock("@/services/relationships", () => relationships);

import { EventPanel, type EventPanelProps } from "./event-panel";

const CURATOR = "b83a28b7e4e5d20bd960c5faeb6625f95529166b8bdb045d42634a2f35919450";
const FOOD = `39998:${CURATOR}:food-and-drink-places`;
const HEX = "ab".repeat(32);

const foodHeader = foodHeaders[0] as NostrEvent;
const food = definitionOf(foodHeader as HeaderEvent);
const tags = definitionOf(tagHeaders[0] as HeaderEvent);
const books = definitionOf(booksHeaders[0] as HeaderEvent);
const steak = foodItems[0] as NostrEvent;
const survey = booksItems[0] as NostrEvent;
const classics = tagItems.find((e) => e.content.includes("Classics")) as NostrEvent;

const event = (over: Partial<NostrEvent> & { tags: string[][] }): NostrEvent => ({
  id: HEX,
  pubkey: CURATOR,
  kind: 39999,
  created_at: 1_790_000_000,
  content: "",
  sig: "0".repeat(128),
  ...over,
});

const eventHref = (value: string) => `/list?c=x&item=${encodeURIComponent(value)}`;

/** What the service reads when nothing is connected. */
const NOTHING = { lists: [], copies: [], tags: [], mentions: [], names: [], folded: { copies: [], mentions: [] }, unread: [] };

function panel(props: Partial<EventPanelProps> = {}) {
  const onClose = vi.fn();
  const view = render(
    <EventPanel event={steak} header={false} definition={food} eventHref={eventHref} onClose={onClose} {...props} />,
  );
  return { onClose, ...view };
}
const tab = (name: string) => screen.getByRole("tab", { name });
const openTab = (name: string) => fireEvent.click(tab(name));
const pre = (container: HTMLElement) => container.querySelector("pre")!;
const openMore = () => fireEvent.click(screen.getByRole("button", { name: /^More fields/ }));

/** The tag table's row for the first tag of this name. */
const rowFor = (name: string) => {
  const th = screen.getAllByRole("rowheader").find((h) => h.querySelector("span")?.textContent === name);
  if (!th) throw new Error(`no row for ${name}`);
  return th.closest("tr")!;
};

beforeEach(() => {
  relays.seenOn.mockReset();
  relays.seenOn.mockReturnValue([]);
  templates.fetchTemplates.mockReset();
  templates.fetchTemplates.mockResolvedValue(new Map());
  relationships.loadRelationships.mockReset();
  relationships.loadRelationships.mockResolvedValue(NOTHING);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.style.overflow = "";
});

describe("the dialog", () => {
  it("is a modal dialog named by the event, and moves focus in", () => {
    panel();
    const dialog = screen.getByRole("dialog", { name: "Steak 'n Shake" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(dialog);
    expect(within(dialog).getByText(/^Item .* kind 39999$/)).toBeTruthy();
    // The page behind it doesn't scroll.
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("closes on Escape, on Close and on the backdrop", () => {
    const { onClose, container } = panel();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(container.querySelector('[aria-hidden="true"]')!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("Escape closes it once, and wherever focus has fallen", () => {
    const { onClose } = panel();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    // Focus on the page's body, as when what had it was unmounted.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    // Another handler that took the key (a menu, a composing input) keeps it.
    const key = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    key.preventDefault();
    document.body.dispatchEvent(key);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("takes focus back when what had it goes with the old content, for another event or for a read", () => {
    const here = event({ id: "11".repeat(32), tags: [["d", "a"], ["z", FOOD]] });
    const there = event({ id: "22".repeat(32), tags: [["d", "b"], ["z", FOOD]] });
    const props = { header: false, foreign: true, definition: null, eventHref, onClose: vi.fn() };
    const { rerender } = render(<EventPanel event={here} {...props} />);
    const dialog = screen.getByRole("dialog");

    // A link followed in the panel: the link is gone when the next event shows.
    const link = within(rowFor("z")).getByRole("link");
    link.focus();
    expect(document.activeElement).toBe(link);
    rerender(<EventPanel event={there} {...props} />);
    expect(link.isConnected).toBe(false);
    expect(document.activeElement).toBe(dialog);

    // And when the next event is still being read: the tabs and their panel are gone too.
    const again = within(rowFor("z")).getByRole("link");
    again.focus();
    rerender(<EventPanel event={null} notice="Reading the event from the relays\u2026" {...props} />);
    expect(again.isConnected).toBe(false);
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);

    // Focus that is still inside the dialog stays where it is.
    rerender(<EventPanel event={there} {...props} />);
    const tabButton = tab("Raw");
    tabButton.focus();
    rerender(<EventPanel event={here} {...props} />);
    expect(document.activeElement).toBe(tabButton);
  });

  it("keeps Tab inside it", () => {
    panel();
    const dialog = screen.getByRole("dialog");
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button, [tabindex="0"], a[href]')];
    const last = focusable[focusable.length - 1];
    const first = focusable[0];
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    // Focus that ends up behind the dialog comes back to it.
    const outside = document.body.appendChild(document.createElement("button"));
    outside.focus();
    expect(document.activeElement).toBe(dialog);
    outside.remove();
  });

  it("gives focus back to what opened it, and the page its scrolling", () => {
    const opener = document.body.appendChild(document.createElement("button"));
    opener.focus();
    const { unmount } = panel({ returnFocus: () => opener });
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe("");
    opener.remove();
  });
});

describe("the tabs", () => {
  it("an item opens on Item, with Pretty, Raw and Relationships beside it", () => {
    panel();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Item", "Pretty", "Raw", "Relationships"]);
    expect(tab("Item").getAttribute("aria-selected")).toBe("true");
    openTab("Raw");
    expect(tab("Raw").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tab("Raw").id);
  });

  it("arrow keys move between tabs", () => {
    panel();
    fireEvent.keyDown(tab("Item"), { key: "ArrowRight" });
    expect(tab("Pretty").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Pretty"));
    fireEvent.keyDown(tab("Pretty"), { key: "ArrowRight" });
    expect(tab("Raw").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Raw"), { key: "ArrowRight" });
    expect(tab("Relationships").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Relationships"));
    // Past the last tab is the first, and Home and End go to the ends.
    fireEvent.keyDown(tab("Relationships"), { key: "ArrowRight" });
    expect(tab("Item").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Item"), { key: "ArrowLeft" });
    expect(tab("Relationships").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Relationships"), { key: "Home" });
    expect(tab("Item").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Item"), { key: "End" });
    expect(tab("Relationships").getAttribute("aria-selected")).toBe("true");
  });

  it("a header has no Item tab; nor does an event of another list", () => {
    const { unmount } = panel({ event: foodHeader, header: true });
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Pretty", "Raw", "Relationships"]);
    unmount();
    panel({ foreign: true, definition: null });
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Pretty", "Raw", "Relationships"]);
    expect(tab("Pretty").getAttribute("aria-selected")).toBe("true");
  });

  it("opens on the tab it is asked to, when the event has it", () => {
    const { unmount } = panel({ tab: "raw" });
    expect(tab("Raw").getAttribute("aria-selected")).toBe("true");
    unmount();
    // Item isn't there for a header: it opens on Pretty.
    panel({ event: foodHeader, header: true, tab: "item" });
    expect(tab("Pretty").getAttribute("aria-selected")).toBe("true");
  });
});

describe("Item", () => {
  /** What the Item tab draws, apart from the dialog's own title. */
  const itemPage = () => within(screen.getByRole("tabpanel"));

  it("draws the item the way its list defines it: its title, summary, link and facts", () => {
    panel();
    expect(itemPage().getByRole("heading", { name: "Steak 'n Shake" })).toBeTruthy();
    expect(itemPage().getByText("7515 North Grand Prairie Drive Peoria 61615")).toBeTruthy();
    expect(itemPage().getByText("Food and Drink Place", { selector: "p" })).toBeTruthy();
    // A url field the list shows as its link is a button showing where it goes, to http(s) only.
    const site = itemPage().getByRole("link", { name: "Website www.steaknshake.com" });
    expect(site.getAttribute("rel")).toContain("noopener");
    expect(site.getAttribute("target")).toBe("_blank");
    // No field list: what the page shows once isn't listed again, and the rest is folded.
    expect(screen.queryByText("Fields")).toBeNull();
    expect(screen.queryByText("Name of the business")).toBeNull();
    expect(itemPage().getByRole("button", { name: "More fields (15)" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("offers the map and draws none until it is asked for", () => {
    const { container } = panel();
    expect(container.querySelector("[data-map]")).toBeNull();
    fireEvent.click(itemPage().getByRole("button", { name: /show on map/i }));
    expect(container.querySelector("[data-map]")).toBeTruthy();
  });

  it("says a required field the item doesn't give is missing", () => {
    panel({ event: event({ tags: [["d", "x"], ["z", FOOD], ["category", "cafe"]] }) });
    expect(screen.getByRole("note").textContent).toBe("Missing name. The list requires it.");
    expect(screen.getByRole("dialog", { name: "Untitled Food and Drink Place" })).toBeTruthy();
  });

  it("keeps what the header never declared apart, under More fields", () => {
    panel({ event: event({ tags: [["d", "x"], ["name", "A"], ["category", "cafe"], ["vibe", "loud"]] }) });
    openMore();
    const outside = screen.getByRole("group", { name: "Outside this list’s definition" });
    expect(within(outside).getByText("vibe")).toBeTruthy();
    expect(within(outside).getByText("loud")).toBeTruthy();
  });

  it("reads a title the list keeps in JSON", () => {
    panel({ event: classics, definition: tags });
    expect(itemPage().getByRole("heading", { name: "Classics" })).toBeTruthy();
    expect(screen.queryByText(/Brainstorm/)).toBeNull();
  });

  it("builds the links the definition's URL templates pin, once they are read", async () => {
    const OPEN_LIBRARY = "e722c94c9ee31ed28b79687b17daa313c0d02a9936a1c07dc73fbab4288fbc10";
    templates.fetchTemplates.mockResolvedValue(
      new Map([[OPEN_LIBRARY, { id: OPEN_LIBRARY, pubkey: CURATOR, name: "Open Library", template: "https://openlibrary.org/works/{id}" }]]),
    );
    panel({ event: survey, definition: books });
    expect(itemPage().queryByRole("link")).toBeNull();
    const link = await itemPage().findByRole("link", { name: "Open Library openlibrary.org" });
    expect(link.getAttribute("href")).toBe("https://openlibrary.org/works/OL8307868W");
    expect(templates.fetchTemplates).toHaveBeenCalledWith(books.links);
  });

  it("says which version of the list it is read through, when the panel knows", () => {
    const { unmount } = panel({ copies: [{ label: "house", author: CURATOR, event: foodHeader }] });
    expect(itemPage().getByText("Read through Brainstorm’s version of Food and Drink Places.")).toBeTruthy();
    unmount();
    // A copy other than the one that governs says nothing of which does.
    panel({ copies: [{ label: "house", author: CURATOR, event: { ...foodHeader, id: HEX } }] });
    expect(itemPage().getByText("Read through the Food and Drink Places list.")).toBeTruthy();
  });

  it("says why it can't render an item whose list's header wasn't found; Pretty and Raw still work", () => {
    const { container } = panel({ definition: null });
    expect(screen.getByRole("dialog", { name: "Untitled item" })).toBeTruthy();
    expect(screen.getByRole("note").textContent).toMatch(/header was not found/);
    expect(itemPage().queryByRole("heading")).toBeNull();
    expect(screen.queryByRole("button", { name: /^More fields/ })).toBeNull();
    openTab("Pretty");
    expect(rowFor("name")).toBeTruthy();
    openTab("Raw");
    expect(pre(container).textContent).toBe(JSON.stringify(steak, null, 2));
  });

  it("says what is missing from a list that keeps its data in JSON, when the JSON can't be read", () => {
    panel({ event: event({ content: "{not json", tags: [["d", "x"], ["z", tags.coordinate]] }), definition: tags });
    expect(screen.getByRole("note").textContent).toMatch(/JSON could not be read/);
  });
});

describe("Relationships", () => {
  it("reads nothing until the tab is chosen", async () => {
    panel();
    openTab("Pretty");
    openTab("Raw");
    await act(async () => {});
    expect(relationships.loadRelationships).not.toHaveBeenCalled();

    openTab("Relationships");
    expect(tab("Relationships").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tab("Relationships").id);
    expect(await screen.findByText("Nothing links here yet")).toBeTruthy();
    expect(relationships.loadRelationships).toHaveBeenCalledTimes(1);
    expect(relationships.loadRelationships.mock.calls[0][0]).toBe(steak);
  });

  it("reads a header too, and says it names what the list names", async () => {
    relationships.loadRelationships.mockResolvedValue({ ...NOTHING, names: [{ tag: "t", value: "food" }] });
    panel({ event: foodHeader, header: true, tab: "relationships" });
    expect(await screen.findByRole("heading", { name: "This list names 1" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /^On these lists/ })).toBeNull();
  });

  it("is kept when the reader moves to another tab and back, and not read again", async () => {
    panel();
    openTab("Relationships");
    await screen.findByText("Nothing links here yet");
    openTab("Raw");
    // Hidden, not gone: the tab's page isn't what the Raw tab shows.
    expect(screen.getByText("Nothing links here yet").closest("[hidden]")).toBeTruthy();
    openTab("Relationships");
    expect(screen.getByText("Nothing links here yet").closest("[hidden]")).toBeNull();
    await act(async () => {});
    expect(relationships.loadRelationships).toHaveBeenCalledTimes(1);
  });

  it("is read afresh for another event, and only once the reader chooses it there", async () => {
    const props = { header: false, definition: food, eventHref, onClose: vi.fn() };
    const { rerender } = render(<EventPanel event={steak} {...props} />);
    openTab("Relationships");
    await screen.findByText("Nothing links here yet");

    const next = event({ id: "22".repeat(32), tags: [["d", "next"], ["z", FOOD], ["name", "Next"]] });
    rerender(<EventPanel event={next} {...props} />);
    // The next event opens on its own first tab, and nothing is read for it yet.
    expect(tab("Item").getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByText("Nothing links here yet")).toBeNull();
    expect(relationships.loadRelationships).toHaveBeenCalledTimes(1);

    openTab("Relationships");
    await screen.findByText("Nothing links here yet");
    expect(relationships.loadRelationships).toHaveBeenCalledTimes(2);
    expect(relationships.loadRelationships.mock.calls[1][0]).toBe(next);
  });

  it("opens a link to an event in the panel's own link format", async () => {
    const OTHER = `39999:${CURATOR}:other`;
    relationships.loadRelationships.mockResolvedValue({ ...NOTHING, names: [{ tag: "a", value: OTHER }] });
    panel();
    openTab("Relationships");
    expect((await screen.findByRole("link", { name: OTHER })).getAttribute("href")).toBe(eventHref(OTHER));
  });
});

describe("Pretty", () => {
  it("labels every tag: client as metadata, g as a field with its description", () => {
    panel({ event: { ...steak, tags: [...steak.tags, ["client", "Brainstorm"]] }, tab: "pretty" });
    expect(within(rowFor("client")).getByText("metadata")).toBeTruthy();
    const g = rowFor("g");
    expect(within(g).getByText("field")).toBeTruthy();
    expect(within(g).getByText("Geohash of the location")).toBeTruthy();
    expect(within(rowFor("d")).getByText("protocol")).toBeTruthy();
    expect(within(rowFor("t")).getByText("undeclared")).toBeTruthy();
    expect(screen.getAllByRole("rowheader")).toHaveLength(steak.tags.length + 1);
  });

  it("links a z to its list, an address or id to its panel, and shows who a p is", () => {
    const coordinate = `39999:${CURATOR}:espresso`;
    panel({
      event: event({
        tags: [["z", FOOD], ["a", coordinate], ["e", HEX], ["p", HEX], ["z", "bare-name"], ["e", "nothex"]],
      }),
      definition: null,
      foreign: true,
    });
    expect(within(rowFor("z")).getByRole("link", { name: FOOD }).getAttribute("href")).toBe(
      `/list?c=${encodeURIComponent(FOOD)}`,
    );
    expect(within(rowFor("a")).getByRole("link").getAttribute("href")).toBe(eventHref(coordinate));
    expect(within(rowFor("e")).getByRole("link", { name: HEX }).getAttribute("href")).toBe(eventHref(HEX));
    expect(within(rowFor("p")).getByTestId("person").textContent).toBe("abab");
    expect(within(rowFor("p")).queryByRole("link")).toBeNull();
    // A bare-name z and a short e are text.
    const bare = screen.getAllByRole("rowheader").find((h) => h.closest("tr")!.textContent!.includes("bare-name"))!;
    expect(within(bare.closest("tr")!).queryByRole("link")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("never links a url field that isn't http(s)", () => {
    panel({
      event: event({
        tags: [["name", "X"], ["website", "javascript:alert(1)"], ["image", "data:text/html,<b>hi</b>"], ["menu", "https://ok.example/menu"]],
      }),
      tab: "pretty",
    });
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("https://ok.example/menu");
    expect(links[0].getAttribute("target")).toBe("_blank");
    // The hostile values are shown as the text they are.
    expect(screen.getByText("javascript:alert(1)")).toBeTruthy();
    expect(screen.getByText("data:text/html,<b>hi</b>")).toBeTruthy();
  });

  it("pretty-prints the JSON a tag item keeps in its content", () => {
    const { container } = panel({ event: classics, definition: tags, tab: "pretty" });
    expect(screen.getByRole("dialog", { name: "Classics" })).toBeTruthy();
    expect(within(rowFor("client")).getByText("metadata")).toBeTruthy();
    const json = screen.getByRole("group", { name: "JSON" });
    expect(json.textContent).toBe(JSON.stringify(JSON.parse(classics.content), null, 2));
    expect(json.textContent).toContain('\n  "tag": {\n    "slug": "classics"');
    // The content isn't shown twice.
    expect(container.querySelectorAll("pre")).toHaveLength(1);
  });

  it("shows content that isn't JSON as the text it is", () => {
    panel({ event: event({ content: "just {some words", tags: [["d", "x"]] }), definition: null, foreign: true });
    expect(screen.queryByRole("group", { name: "JSON" })).toBeNull();
    expect(screen.getByRole("group", { name: "Content" }).textContent).toBe("just {some words");
  });

  it("a 200 KB content renders", () => {
    const content = JSON.stringify({ blob: "x".repeat(200 * 1024), n: [1, 2, 3] });
    const start = performance.now();
    panel({ event: event({ content, tags: [["d", "x"]] }), definition: null, foreign: true });
    expect(screen.getByRole("group", { name: "JSON" }).textContent).toContain('"blob"');
    expect(performance.now() - start).toBeLessThan(2000);
    openTab("Raw");
    expect(screen.getByRole("group", { name: "Raw event" }).textContent!.length).toBeGreaterThan(200 * 1024);
  });

  it("names the event: id, coordinate and naddr, each with a copy button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    panel({ tab: "pretty" });
    const coordinate = `39999:${steak.pubkey}:osm-way-91202967`;
    expect(screen.getByText(coordinate)).toBeTruthy();
    expect(screen.getByText(/^naddr1/)).toBeTruthy();
    expect(screen.getByText(steak.id)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy coordinate" })));
    expect(writeText).toHaveBeenCalledWith(coordinate);
    expect(screen.getByRole("button", { name: "Copy coordinate" }).textContent).toBe("Copied");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy event id" })));
    expect(writeText).toHaveBeenLastCalledWith(steak.id);
  });

  it("says when no relay is recorded for an event", () => {
    panel({ tab: "pretty" });
    expect(screen.getByText("No relay is recorded for this visit.")).toBeTruthy();
  });

  it("an event not addressable gets an nevent", () => {
    panel({ event: event({ kind: 9999, tags: [["d", "x"]] }), definition: null, foreign: true });
    expect(screen.getByText(/^nevent1/)).toBeTruthy();
    expect(screen.queryByText("Coordinate")).toBeNull();
  });

  it("says who wrote it, when, and which relays returned it", () => {
    relays.seenOn.mockImplementation((id: string) =>
      id === steak.id ? ["wss://dcosl.brainstorm.world", "wss://search.brainstorm.world"] : [],
    );
    panel({ tab: "pretty" });
    expect(screen.getByTestId("person").textContent).toBe(steak.pubkey.slice(0, 4));
    expect(screen.getByText("wss://dcosl.brainstorm.world")).toBeTruthy();
    expect(screen.getByText("wss://search.brainstorm.world")).toBeTruthy();
    const when = new Date(steak.created_at * 1000);
    expect(document.querySelector("time")?.getAttribute("datetime")).toBe(when.toISOString());
  });

  it("survives a date that can't be read", () => {
    panel({ event: event({ created_at: 9e15, tags: [["d", "x"]] }), definition: null, foreign: true });
    expect(screen.getByText("an unreadable date")).toBeTruthy();
  });
});

describe("a header's Pretty", () => {
  it("names its b as itself (canonical)", () => {
    panel({ event: foodHeader, header: true });
    expect(screen.getByRole("dialog", { name: "Food and Drink Places" })).toBeTruthy();
    expect(screen.getByText(/^List header .* kind 39998$/)).toBeTruthy();
    expect(screen.getByText("Itself (canonical)")).toBeTruthy();
    // Its tags are the list's own, not strays outside a definition.
    expect(within(rowFor("names")).getByText("list tag")).toBeTruthy();
    expect(within(rowFor("required")).queryByText("undeclared")).toBeNull();
  });

  it("links the concept a copy points at", () => {
    const copy = foodCopies[0] as NostrEvent;
    panel({ event: copy, header: true });
    expect(screen.queryByText("Itself (canonical)")).toBeNull();
    expect(screen.getAllByRole("link", { name: FOOD }).some((l) => l.getAttribute("href") === `/list?c=${encodeURIComponent(FOOD)}`)).toBe(true);
  });

  it("says a withdrawn header is out of its concept", () => {
    panel({ event: foodCopies[3] as NostrEvent, header: true });
    expect(screen.getByText(/opted out of any concept/)).toBeTruthy();
  });

  it("names the URL templates it pins", async () => {
    const id = "cd".repeat(32);
    const pinned = event({
      kind: 39998,
      tags: [["d", "accounts"], ["names", "account", "accounts"], ["required", "username"], ["link", id, "", "username", "username"]],
    });
    templates.fetchTemplates.mockResolvedValue(
      new Map([[id, { id, pubkey: CURATOR, name: "GitHub profile", template: "https://github.com/{username}" }]]),
    );
    panel({ event: pinned, header: true });
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(await screen.findByText("GitHub profile")).toBeTruthy();
    expect(screen.getByText("github.com")).toBeTruthy();
    expect(templates.fetchTemplates).toHaveBeenCalledWith([{ templateId: id, relay: "", bindings: [["username", "username"]] }]);
  });

  it("says when a pinned template can't be found", async () => {
    const id = "cd".repeat(32);
    panel({
      event: event({ kind: 39998, tags: [["d", "a"], ["required", "u"], ["link", id, "", "u", "u"]] }),
      header: true,
    });
    expect(await screen.findByText(/Template cdcdcdcd… was not found/)).toBeTruthy();
  });
});

describe("Raw", () => {
  it("is the event exactly as signed, and the copy button copies exactly that", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { container } = panel({ tab: "raw" });
    const exact = JSON.stringify(steak, null, 2);
    expect(pre(container).textContent).toBe(exact);
    expect(JSON.parse(pre(container).textContent!)).toEqual(steak);
    expect(pre(container).textContent).toContain(steak.sig);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy event" })));
    expect(writeText).toHaveBeenCalledWith(exact);
  });

  it("says when it could not copy", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    panel({ tab: "raw" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy event" })));
    expect(screen.getByRole("status").textContent).toBe("Could not copy event");
  });

  it("a header's Raw switches between the concept's copies", () => {
    const copies = (foodCopies as NostrEvent[]).slice(0, 3).map((e, i) => ({
      label: (["community", "house", "copy"] as const)[i],
      author: e.pubkey,
      event: e,
    }));
    const { container } = panel({ event: foodHeader, header: true, copies: [{ label: "community", author: CURATOR, event: foodHeader }, ...copies] });
    openTab("Raw");
    expect(pre(container).textContent).toBe(JSON.stringify(foodHeader, null, 2));
    const select = screen.getByRole("combobox", { name: "Copy of the concept" });
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      expect.stringMatching(/^Community header · npub1/),
      expect.stringMatching(/^Community header · npub1/),
      expect.stringMatching(/^Brainstorm’s · npub1/),
      expect.stringMatching(/^Copy · npub1/),
    ]);
    const other = (foodCopies as NostrEvent[])[1];
    fireEvent.change(select, { target: { value: other.id } });
    expect(pre(container).textContent).toBe(JSON.stringify(other, null, 2));
  });

  it("an item's Raw has no copies to choose from", () => {
    panel({ tab: "raw" });
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("when there is no event", () => {
  it("says why in the dialog", () => {
    panel({ event: null, notice: "No relay returned that event." });
    expect(screen.getByRole("dialog", { name: "Event" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("No relay returned that event.");
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });
});

describe("a different event", () => {
  it("starts on its first tab, not the one the last was left on", () => {
    const { rerender, onClose } = panel();
    openTab("Raw");
    rerender(
      <EventPanel
        event={classics}
        header={false}
        definition={tags}
        eventHref={eventHref}
        onClose={onClose}
      />,
    );
    expect(tab("Item").getAttribute("aria-selected")).toBe("true");
  });
});
