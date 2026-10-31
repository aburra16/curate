// @vitest-environment jsdom
/**
 * The item as its list defines it (tier 2): what leads it, its links, facts,
 * media and map, what it lacks, and what the list's definition leaves out.
 * Read the way a person reads the Item tab, over the real Food, Tags, Books
 * and V4V Songs headers and items saved from the relays.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { NostrEvent } from "nostr-tools/pure";
import { afterEach, describe, expect, it, vi } from "vitest";
import { definitionOf, type HeaderEvent } from "@/lib/conceptResolution";
import { decodeGeohash, osmEmbedUrl, osmPageUrl } from "@/lib/geohash";
import type { ItemPresentation } from "@/lib/itemPresentation";
import type { UrlTemplate } from "@/lib/linkTemplates";
import bookSubmissionsHeaders from "@/test/fixtures/book-submissions.header.json";
import booksHeaders from "@/test/fixtures/books.header.json";
import booksItems from "@/test/fixtures/books.items.json";
import foodHeaders from "@/test/fixtures/food.header.json";
import foodItems from "@/test/fixtures/food.items.json";
import tagHeaders from "@/test/fixtures/tags.headers.json";
import tagItems from "@/test/fixtures/tags.items.json";
import songHeaders from "@/test/fixtures/v4v-songs.header.json";
import songItems from "@/test/fixtures/v4v-songs.items.json";

// A test can ask for an item to be drawn as a portrait, which nothing in a header does yet.
const reading = vi.hoisted(() => ({ change: null as ((p: ItemPresentation) => ItemPresentation) | null }));
vi.mock("@/services/jsonData", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/services/jsonData")>();
  return {
    ...real,
    presentCurateItem: (...args: Parameters<typeof real.presentCurateItem>) => {
      const read = real.presentCurateItem(...args);
      return reading.change ? reading.change(read) : read;
    },
  };
});

import { ItemHero, type ItemHeroProps } from "./item-hero";

const CURATOR = "b83a28b7e4e5d20bd960c5faeb6625f95529166b8bdb045d42634a2f35919450";
const FOOD = `39998:${CURATOR}:food-and-drink-places`;
const HEX = "ab".repeat(32);

const foodHeader = foodHeaders[0] as NostrEvent;
const food = definitionOf(foodHeader as HeaderEvent);
const steak = foodItems[0] as NostrEvent;
const banhMi = foodItems[1] as NostrEvent;
const tagsDefinition = definitionOf(tagHeaders[0] as HeaderEvent);
const classics = tagItems.find((e) => e.content.includes("Classics")) as NostrEvent;
const books = definitionOf(booksHeaders[0] as HeaderEvent);
const survey = booksItems[0] as NostrEvent;
const songs = songHeaders[0] as NostrEvent;
const kingsfall = songItems[0] as NostrEvent;

/** A header with more tags: the same list, with something else said about it. */
const reread = (header: NostrEvent, extra: string[][]) =>
  definitionOf({ ...header, tags: [...header.tags, ...extra] } as HeaderEvent);

const event = (over: Partial<NostrEvent> & { tags: string[][] }): NostrEvent => ({
  id: HEX,
  pubkey: CURATOR,
  kind: 39999,
  created_at: 1_790_000_000,
  content: "",
  sig: "0".repeat(128),
  ...over,
});
/** The steak house with more said of it. */
const steakWith = (...extra: string[][]) => event({ tags: [...steak.tags, ...extra] });

function hero(props: Partial<ItemHeroProps> = {}) {
  return render(<ItemHero item={steak} definition={food} templates={new Map()} {...props} />);
}

/** The text of an element with its runs of white space made one. */
const said = (el: Element) => el.textContent!.replace(/\s+/g, " ").trim();
/** The value beside a label in a list of facts or fields. */
const valueOf = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;
const picture = (container: HTMLElement) => container.querySelector("[data-picture]");
const openMore = () => fireEvent.click(screen.getByRole("button", { name: /^More fields/ }));

afterEach(() => {
  reading.change = null;
});

describe("the head of the page", () => {
  it("names the list, then the item's title and summary as its row reads them", () => {
    hero();
    expect(screen.getByText((_, el) => el?.tagName === "P" && said(el) === "Food and Drink Place in Food and Drink Places")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Steak 'n Shake" })).toBeTruthy();
    expect(screen.getByText("7515 North Grand Prairie Drive Peoria 61615")).toBeTruthy();
  });

  it("says Untitled with the list's own name when the item has no title", () => {
    hero({ item: event({ tags: [["d", "x"], ["z", FOOD], ["category", "cafe"]] }) });
    expect(screen.getByRole("heading", { name: "Untitled Food and Drink Place" })).toBeTruthy();
  });

  it("takes the list's names from where namesOf finds them, not from the definition's tag-only names", () => {
    const submissions = definitionOf(bookSubmissionsHeaders[0] as HeaderEvent);
    hero({ item: event({ tags: [["d", "x"]] }), definition: submissions });
    expect(screen.getByRole("heading", { name: "Untitled Book submissions" })).toBeTruthy();
    expect(screen.getByText((_, el) => el?.tagName === "P" && said(el) === "Book submissions in Book submissions")).toBeTruthy();
  });

  it("reads a title kept in JSON: a Tags item is Classics, never Brainstorm", () => {
    const { container } = hero({ item: classics, definition: tagsDefinition });
    expect(screen.getByRole("heading", { name: "Classics" })).toBeTruthy();
    expect(screen.getByText((_, el) => el?.tagName === "P" && said(el) === "tag in tags")).toBeTruthy();
    expect(container.textContent).not.toMatch(/Brainstorm/);
    // The item says nothing the list's definition leaves out, and has no link or fold to offer.
    expect(screen.queryByRole("button", { name: /^More fields/ })).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

describe("the picture", () => {
  it("is a plain mark when neither the item nor the list has an image", () => {
    const { container } = hero();
    expect(picture(container)?.getAttribute("data-picture")).toBe("mark");
    expect(container.querySelector("img")).toBeNull();
  });

  it("is the item's image, round", () => {
    const { container } = hero({ item: steakWith(["image", "https://img.example/steak.jpg"]) });
    expect(picture(container)?.getAttribute("data-picture")).toBe("item");
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://img.example/steak.jpg");
    expect(img.getAttribute("data-shape")).toBe("round");
  });

  it("is the list's image when the item has none", () => {
    const { container } = hero({ definition: reread(foodHeader, [["image", "https://img.example/food.png"]]) });
    expect(picture(container)?.getAttribute("data-picture")).toBe("list");
    expect(container.querySelector("img")!.getAttribute("src")).toBe("https://img.example/food.png");
  });

  it("is a portrait when the presentation says so", () => {
    reading.change = (read) => ({ ...read, imageShape: "portrait" });
    const { container } = hero({ item: steakWith(["image", "https://img.example/steak.jpg"]) });
    expect(container.querySelector("img")!.getAttribute("data-shape")).toBe("portrait");
  });

  it("gives way to the mark when the image can't be loaded", () => {
    const { container } = hero({ item: steakWith(["image", "https://img.example/gone.jpg"]) });
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(picture(container)?.getAttribute("data-picture")).toBe("mark");
  });

  it("is never an image that isn't http(s)", () => {
    const { container } = hero({ item: steakWith(["image", "data:text/html,<b>hi</b>"]) });
    expect(container.querySelector("img")).toBeNull();
    expect(picture(container)?.getAttribute("data-picture")).toBe("mark");
  });
});

describe("the links", () => {
  it("shows the item's own link as a button with its label and host, opening in a new tab", () => {
    hero();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    const site = screen.getByRole("link", { name: "Website www.steaknshake.com" });
    expect(site.getAttribute("href")).toBe("https://www.steaknshake.com/locations/il-peoria-n-grand-prairie-drive/");
    expect(site.getAttribute("target")).toBe("_blank");
    expect(site.getAttribute("rel")).toBe("noopener noreferrer nofollow");
  });

  const OPEN_LIBRARY = "e722c94c9ee31ed28b79687b17daa313c0d02a9936a1c07dc73fbab4288fbc10";
  const ISBN_LOOKUP = "a3037637a77a5b0338639f570b6cf24aa292a1bea322e18d2f4e69144df0cb57";
  const template = (id: string, name: string, address: string): [string, UrlTemplate] => [
    id,
    { id, pubkey: CURATOR, name, template: address },
  ];

  it("adds the links the definition's URL templates build, each showing where it goes", () => {
    const templates = new Map([
      template(OPEN_LIBRARY, "Open Library", "https://openlibrary.org/works/{id}"),
      template(ISBN_LOOKUP, "Library lookup", "https://catalog.example.org/isbn/{isbn10}"),
    ]);
    hero({ item: survey, definition: books, templates });
    expect(screen.getAllByRole("link")).toHaveLength(2);
    const [openLibrary, lookup] = [
      screen.getByRole("link", { name: "Open Library openlibrary.org" }),
      screen.getByRole("link", { name: "Library lookup catalog.example.org" }),
    ];
    expect(openLibrary.getAttribute("href")).toBe("https://openlibrary.org/works/OL8307868W");
    expect(lookup.getAttribute("href")).toBe("https://catalog.example.org/isbn/052106418X");
    // In the order the header names them.
    expect(openLibrary.compareDocumentPosition(lookup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const l of [openLibrary, lookup]) {
      expect(l.getAttribute("target")).toBe("_blank");
      expect(l.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    }
  });

  it("shows a link once, though the item's own field and a template both build it", () => {
    const id = "cd".repeat(32);
    const sameSite = reread(foodHeader, [
      ["optional", "slug"],
      ["link", id, "", "place", "slug"],
    ]);
    const templates = new Map([template(id, "Location page", "https://www.steaknshake.com/locations/{place}/")]);
    hero({ item: steakWith(["slug", "il-peoria-n-grand-prairie-drive"]), definition: sameSite, templates });
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("is no button when the field doesn't hold an http(s) address, and the value is shown as the text it is", () => {
    const hostile = steakWith(["menu", "javascript:alert(1)"]);
    hostile.tags = hostile.tags.map((t) => (t[0] === "website" ? ["website", "javascript:alert(1)"] : t));
    hero({ item: hostile });
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    openMore();
    expect(screen.getAllByText("javascript:alert(1)")).toHaveLength(2);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

describe("the facts", () => {
  const withFacts = reread(foodHeader, [
    ["display", "fact", "phone", "Phone"],
    ["display", "fact", "opening-hours"],
    ["display", "fact", "cuisine"],
    ["display", "fact", "menu"],
  ]);

  it("lists what the header names as label: value, in its order, +N more for a repeated one", () => {
    hero({ item: event({ tags: [...banhMi.tags, ["menu", "https://mi-sant.com/menu"]] }), definition: withFacts });
    expect(valueOf("Phone").textContent).toBe("+1-763-355-5947");
    expect(valueOf("Opening hours").textContent).toBe("Mo-Sa 09:00-20:00");
    expect(valueOf("Cuisine").textContent).toBe("vietnamese+1 more");
    expect(screen.getAllByRole("term").map((t) => t.textContent)).toEqual(["Phone", "Opening hours", "Cuisine", "Menu"]);
  });

  it("makes a url fact a link, to http(s) only", () => {
    hero({ item: event({ tags: [...banhMi.tags, ["menu", "https://mi-sant.com/menu"]] }), definition: withFacts });
    const menu = within(valueOf("Menu")).getByRole("link", { name: "https://mi-sant.com/menu" });
    expect(menu.getAttribute("href")).toBe("https://mi-sant.com/menu");
    expect(menu.getAttribute("target")).toBe("_blank");
    expect(menu.getAttribute("rel")).toBe("noopener noreferrer nofollow");
  });

  it("leaves out a fact the item doesn't give", () => {
    hero({ item: steak, definition: withFacts });
    expect(screen.getAllByRole("term").map((t) => t.textContent)).toEqual(["Phone", "Opening hours", "Cuisine"]);
  });

  it("has none when the header names none", () => {
    hero({ item: classics, definition: tagsDefinition });
    expect(screen.queryAllByRole("term")).toHaveLength(0);
  });

  it("reads a book's facts from its header", () => {
    hero({ item: survey, definition: books });
    expect(valueOf("Published").textContent).toBe("1933");
    expect(valueOf("Pages").textContent).toBe("188");
  });
});

describe("the media", () => {
  const playable = reread(songs, [
    ["display", "title", "title"],
    ["display", "summary", "artist"],
    ["display", "image", "artwork"],
    ["display", "media", "url"],
  ]);

  it("plays audio, fetching nothing until it is played", () => {
    const { container } = hero({ item: kingsfall, definition: playable });
    expect(screen.getByRole("heading", { name: "Kingsfall" })).toBeTruthy();
    expect(screen.getByText("Torcon 7")).toBeTruthy();
    const audio = container.querySelector("audio")!;
    expect(audio.getAttribute("src")).toBe("https://mp3s.podcastindex.org/Kingsfall.mp3");
    expect(audio.hasAttribute("controls")).toBe(true);
    expect(audio.getAttribute("preload")).toBe("none");
    expect(container.querySelector("video")).toBeNull();
  });

  it("plays video, with the item's picture as its poster", () => {
    const clip = event({
      tags: kingsfall.tags.map((t) => (t[0] === "url" ? ["url", "https://video.example/kingsfall.mp4"] : t)),
    });
    const { container } = hero({ item: clip, definition: playable });
    const video = container.querySelector("video")!;
    expect(video.getAttribute("src")).toBe("https://video.example/kingsfall.mp4");
    expect(video.getAttribute("poster")).toBe("https://feeds.podcastindex.org/torcon7cover.jpg");
    expect(video.hasAttribute("controls")).toBe(true);
    expect(container.querySelector("audio")).toBeNull();
  });

  it("plays nothing that isn't audio or video", () => {
    const page = event({ tags: kingsfall.tags.map((t) => (t[0] === "url" ? ["url", "https://example.org/notes.pdf"] : t)) });
    const { container } = hero({ item: page, definition: playable });
    expect(container.querySelector("audio, video")).toBeNull();
  });

  it("has no player for an item whose list names no media", () => {
    const { container } = hero({ item: kingsfall, definition: definitionOf(songs as HeaderEvent) });
    expect(container.querySelector("audio, video")).toBeNull();
  });
});

describe("the map", () => {
  it("is offered, and asks no map server for anything until the reader asks", () => {
    const { container } = hero();
    expect(screen.getByRole("button", { name: /show on map/i })).toBeTruthy();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector('[src*="openstreetmap"], [href*="openstreetmap"]')).toBeNull();
  });

  it("shows a spot's map with a pin, and a way to OpenStreetMap, when asked", () => {
    const { container } = hero();
    fireEvent.click(screen.getByRole("button", { name: /show on map/i }));
    const cell = { ...decodeGeohash("dp0pzrexj")!, geohash: "dp0pzrexj" };
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe(osmEmbedUrl(cell));
    expect(frame.getAttribute("src")).toContain("marker=");
    expect(frame.getAttribute("title")).toBe("Map: Steak 'n Shake");
    const open = screen.getByRole("link", { name: /Open in OpenStreetMap/ });
    expect(open.getAttribute("href")).toBe(osmPageUrl(cell));
    expect(open.getAttribute("target")).toBe("_blank");
    expect(open.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(screen.queryByRole("button", { name: /show on map/i })).toBeNull();
  });

  it("frames a coarser cell as the area it is, with no pin", () => {
    const area = event({ tags: [...steak.tags.filter((t) => t[0] !== "g"), ["g", "dp0p"]] });
    const { container } = hero({ item: area });
    fireEvent.click(screen.getByRole("button", { name: /show area on map/i }));
    expect(container.querySelector("iframe")!.getAttribute("src")).not.toContain("marker=");
  });

  it("is not offered for an item with no location", () => {
    hero({ item: classics, definition: tagsDefinition });
    expect(screen.queryByRole("button", { name: /map/i })).toBeNull();
  });
});

describe("a required field the item lacks", () => {
  it("is named in a notice", () => {
    hero({ item: event({ tags: [["d", "x"], ["z", FOOD], ["category", "cafe"]] }) });
    expect(said(screen.getByRole("note"))).toBe("Missing name. The list requires it.");
  });

  it("names them all, in the header's order", () => {
    hero({ item: event({ tags: [["d", "x"], ["z", FOOD]] }) });
    expect(said(screen.getByRole("note"))).toBe("Missing name, category. The list requires them.");
  });

  it("is no notice when the item has them all", () => {
    hero();
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("More fields", () => {
  it("is folded, counts the fields nothing above shows, and opens on request", () => {
    hero({ item: steakWith(["vibe", "loud"]) });
    const toggle = screen.getByRole("button", { name: "More fields (16)" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("category")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("category", { selector: "dt" })).toBeTruthy();
  });

  it("holds only declared fields nothing above shows, each with its value", () => {
    hero();
    openMore();
    const more = screen.getByRole("group", { name: "More fields" });
    expect(within(more).getAllByRole("term").map((t) => t.textContent)).toEqual([
      "category",
      "locality",
      "cuisine",
      "osm-id",
      "country",
      "region",
      "postal-code",
      "lat",
      "lon",
      "phone",
      "opening-hours",
      "accepts-bitcoin",
      "btcmap-id",
      "source",
      "license",
    ]);
    expect(valueOf("category").textContent).toBe("fast_food");
    expect(valueOf("phone").textContent).toBe("+1 309 693 7529");
  });

  it("does not repeat the title, summary, link or location fields, nor the facts", () => {
    hero({ item: steak, definition: reread(foodHeader, [["display", "fact", "phone", "Phone"]]) });
    openMore();
    const more = screen.getByRole("group", { name: "More fields" });
    const names = within(more).getAllByRole("term").map((t) => t.textContent);
    for (const shown of ["name", "address", "website", "g", "phone"]) expect(names).not.toContain(shown);
    expect(names).toContain("category");
  });

  it("does not repeat a field a link is built from", () => {
    const id = "cd".repeat(32);
    const built = reread(foodHeader, [
      ["optional", "slug"],
      ["link", id, "", "place", "slug"],
    ]);
    hero({ item: steakWith(["slug", "x"]), definition: built });
    openMore();
    expect(within(screen.getByRole("group", { name: "More fields" })).queryByText("slug")).toBeNull();
  });

  it("shows a repeated field's first value and how many more", () => {
    hero({ item: banhMi });
    openMore();
    expect(valueOf("cuisine").textContent).toBe("vietnamese+1 more");
  });

  it("keeps the tags the list never declared apart, and says they are outside its definition", () => {
    hero({ item: steakWith(["vibe", "loud"], ["good-for", "late nights"]) });
    openMore();
    const outside = screen.getByRole("group", { name: "Outside this list’s definition" });
    expect(within(outside).getAllByRole("term").map((t) => t.textContent)).toEqual(["vibe", "good-for"]);
    expect(within(outside).getByText("loud")).toBeTruthy();
    const more = screen.getByRole("group", { name: "More fields" });
    expect(within(more).queryByText("vibe")).toBeNull();
    // The protocol's own tags and the client's mark are not fields at all.
    expect(screen.queryByText("alt", { selector: "dt" })).toBeNull();
    expect(screen.queryByText("client", { selector: "dt" })).toBeNull();
  });

  it("is absent when the definition covers the whole item", () => {
    const covered = event({ tags: [["d", "x"], ["z", FOOD], ["name", "A"], ["category", "cafe"]] });
    hero({ item: covered, definition: reread(foodHeader, [["display", "fact", "category"]]) });
    expect(screen.queryByRole("button", { name: /^More fields/ })).toBeNull();
  });
});

describe("the version line", () => {
  const line = () => screen.getByText(/^Read through /);

  it("says which version of the list the item is read through", () => {
    const { rerender } = hero({ version: "yours" });
    expect(line().textContent).toBe("Read through your version of Food and Drink Places.");
    rerender(<ItemHero item={steak} definition={food} templates={new Map()} version="house" />);
    expect(line().textContent).toBe("Read through Brainstorm’s version of Food and Drink Places.");
    rerender(<ItemHero item={steak} definition={food} templates={new Map()} version="assistant" />);
    expect(line().textContent).toBe("Read through your Assistant’s version of Food and Drink Places.");
    rerender(<ItemHero item={steak} definition={food} templates={new Map()} version="community" />);
    expect(line().textContent).toBe("Read through the community’s header for Food and Drink Places.");
    rerender(<ItemHero item={steak} definition={food} templates={new Map()} version="copy" />);
    expect(line().textContent).toBe("Read through another account’s version of Food and Drink Places.");
  });

  it("names the list when nothing says which version it is", () => {
    hero();
    expect(line().textContent).toBe("Read through the Food and Drink Places list.");
  });
});
