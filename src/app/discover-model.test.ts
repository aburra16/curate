/**
 * What Discover shows: the Dictionary first, then one card per
 * concept; copies, withdrawn copies and blank headers only with "Show
 * everything". Pure: the groups come from `groupConcepts` and the governing
 * definitions from `resolveForReader`, the services the page uses, so the
 * cases run on real headers (src/test/fixtures) and small made-up ones.
 */
import { describe, expect, it } from "vitest";
import type { HeaderEvent } from "@/lib/conceptResolution";
import { coordinateOf } from "@/lib/dlistFields";
import { groupConcepts } from "@/services/concepts";
import { resolveForReader, type DictionaryReader } from "@/services/dictionary";
import booksHeader from "@/test/fixtures/books.header.json";
import bookSubmissionsHeader from "@/test/fixtures/book-submissions.header.json";
import dictionaryHeaders from "@/test/fixtures/dictionary.headers.json";
import foodCopies from "@/test/fixtures/food.copies.json";
import foodHeader from "@/test/fixtures/food.header.json";
import githubHeader from "@/test/fixtures/github.header.json";
import tagsHeaders from "@/test/fixtures/tags.headers.json";
import { discoverModel, type CardModel } from "./discover-model";

const CURATOR = "b83a28b7e4e5d20bd960c5faeb6625f95529166b8bdb045d42634a2f35919450";
const FOOD = `39998:${CURATOR}:food-and-drink-places`;
const GITHUB = `39998:${CURATOR}:github-accounts`;
const BOOKS = "39998:6aca05b812da97601151776d13de04ae71afc9d86da1408f0e72cffef72ece4b:books";
const TAGS = "39998:82b75e474dda005e912bcbb910391c60c2b89cc7faf5d3c30b7c59a324973833:tag";
const WITHDRAWN_FOOD_ID = "fd5d5bce"; // 2efaa715…'s ["b","b-tag-deferred"] on Food's d

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

let n = 0;
const nextId = () => (++n).toString(16).padStart(8, "0").padEnd(64, "e");
const coord = (pubkey: string, d: string) => `39998:${pubkey}:${d}`;

/** A header as a relay would hand it over; `extra` tags follow `d` and `names`. */
const header = (
  pubkey: string,
  d: string,
  names: [string, string] | null,
  extra: string[][] = [],
  created_at = 1_790_000_000,
): HeaderEvent => ({
  id: nextId(),
  pubkey,
  kind: 39998,
  created_at,
  content: "",
  tags: [["d", d], ...(names ? [["names", ...names]] : []), ...extra],
});

/** A header that points at itself: a shared concept. */
const concept = (pubkey: string, d: string, names: [string, string], extra: string[][] = [], created_at?: number) =>
  header(pubkey, d, names, [["b", coord(pubkey, d), "pointer"], ...extra], created_at);

const NOBODY: DictionaryReader = { pubkey: null, taPubkey: null };

interface Options {
  dictionary?: string[];
  query?: string;
  showEverything?: boolean;
  reader?: DictionaryReader;
  house?: string[];
}

/** The page's own steps: group the headers, resolve each group for the reader, build the model. */
function build(headers: HeaderEvent[], options: Options = {}) {
  const { groups, blank } = groupConcepts(headers);
  const resolved = new Map(
    groups.map((g) => [g.root, resolveForReader(g, options.reader ?? NOBODY, options.house ?? [])]),
  );
  return discoverModel({
    groups,
    blank,
    dictionary: options.dictionary ?? [],
    resolved,
    query: options.query ?? "",
    showEverything: options.showEverything ?? false,
  });
}

const plurals = (cards: CardModel[]) => cards.map((c) => c.plural);
const food = [...foodHeader, ...foodCopies] as HeaderEvent[];

describe("discoverModel", () => {
  it("Food appears once, with 4 versions", () => {
    const { dictionary, all } = build(food);
    expect(dictionary).toEqual([]);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      root: FOOD,
      plural: "Food and Drink Places",
      versions: 4, // the community header and three copies; the withdrawn one is not a version
      label: null,
      copies: [], // folded away until "Show everything"
    });
    expect(all[0].description).toMatch(/^Restaurants, cafes, bars/);
    expect(all[0].author).toBe(CURATOR);

    const shown = build(food, { showEverything: true });
    expect(shown.all).toHaveLength(1);
    expect(shown.all[0].versions).toBe(4);
  });

  it("the four Tags headers are one card, not four", () => {
    const { all } = build(tagsHeaders as HeaderEvent[]);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ root: TAGS, plural: "tags", versions: 4 });
  });

  it("the Dictionary lists its concepts first and not again in all", () => {
    const headers = [...food, ...booksHeader, ...githubHeader, ...tagsHeaders] as HeaderEvent[];
    const { dictionary, all } = build(headers, { dictionary: [GITHUB, FOOD] });
    expect(plurals(dictionary)).toEqual(["GitHub Accounts", "Food and Drink Places"]); // the Dictionary's order
    expect(plurals(all).sort()).toEqual(["Books", "tags"]);
    expect(all.some((c) => c.root === FOOD || c.root === GITHUB)).toBe(false);
  });

  it("a Dictionary concept no header was found for is left out, and the rest still list", () => {
    const { dictionary, all } = build(food, { dictionary: [BOOKS, FOOD] });
    expect(dictionary.map((c) => c.root)).toEqual([FOOD]);
    expect(all).toEqual([]);
  });

  it("withdrawn and blank appear only with showEverything, labelled", () => {
    const loner = header(C, "retired", null, [["b", "b-tag-deferred"]]);
    const blank: HeaderEvent = { ...header(B, "gone", ["gone", "gone"]), tags: [["d", "gone"]] };
    const headers = [...food, loner, blank];

    const folded = build(headers);
    expect(folded.all.map((c) => c.root)).toEqual([FOOD]);
    expect(folded.all[0].copies).toEqual([]);

    const everything = build(headers, { showEverything: true });
    const byRoot = Object.fromEntries(everything.all.map((c) => [c.root, c]));
    expect(Object.keys(byRoot).sort()).toEqual([FOOD, coordinateOf(loner)!, coordinateOf(blank)!].sort());
    expect(byRoot[FOOD].label).toBeNull();
    expect(byRoot[coordinateOf(loner)!]).toMatchObject({ label: "withdrawn", versions: 1, copies: [] });
    expect(byRoot[coordinateOf(blank)!]).toMatchObject({ label: "blank", versions: 1, copies: [] });
  });

  it("a withdrawn copy inside a concept is listed under it only with showEverything, labelled", () => {
    const folded = build(food);
    expect(folded.all[0].copies).toEqual([]);

    const [card] = build(food, { showEverything: true }).all;
    expect(card.copies).toHaveLength(4); // three copies and the withdrawn one
    const withdrawn = card.copies.filter((c) => c.label === "withdrawn");
    expect(withdrawn).toHaveLength(1);
    expect(withdrawn[0].author?.slice(0, 8)).toBe("2efaa715");
    expect(withdrawn[0].root).toMatch(/^39998:2efaa715[0-9a-f]{56}:food-and-drink-places$/); // its own address
    expect(card.copies.filter((c) => c.label === null)).toHaveLength(3);
    expect(card.versions).toBe(4);
    // sanity: the fixture really is the 2efaa715 copy
    expect(foodCopies.find((e) => e.id.startsWith(WITHDRAWN_FOOD_ID))!.pubkey.startsWith("2efaa715")).toBe(true);
  });

  it("a copy is listed with its own name, author and address", () => {
    const root = concept(A, "pets", ["pet", "pets"], [["description", "Animals people keep."]]);
    const copy = header(B, "pets-mine", ["critter", "critters"], [["b", coord(A, "pets"), "pointer"]]);
    const [card] = build([root, copy], { showEverything: true }).all;
    expect(card.copies).toEqual([
      {
        root: coord(B, "pets-mine"),
        plural: "critters",
        description: null,
        image: null,
        author: B,
        versions: 1,
        label: null,
        copies: [],
      },
    ]);
  });

  it("search folds accents and matches description", () => {
    const cafes = concept(A, "cafes", ["Café", "Cafés"]);
    const bakeries = concept(B, "bakeries", ["bakery", "bakeries"], [["description", "Pâtisseries and bread shops"]]);
    const books = concept(C, "books", ["book", "books"]);
    const headers = [cafes, bakeries, books];

    expect(plurals(build(headers, { query: "cafe" }).all)).toEqual(["Cafés"]);
    expect(plurals(build(headers, { query: "CAFÉS" }).all)).toEqual(["Cafés"]);
    expect(plurals(build(headers, { query: "patisserie" }).all)).toEqual(["bakeries"]); // the description
    expect(plurals(build(headers, { query: "shops bread" }).all)).toEqual(["bakeries"]); // any order
    expect(plurals(build(headers, { query: "book" }).all)).toEqual(["books"]); // the singular too
    expect(build(headers, { query: "zebra" }).all).toEqual([]);
    expect(build(headers, { query: "   " }).all).toHaveLength(3);
  });

  it("search filters the Dictionary too", () => {
    const headers = [...food, ...githubHeader] as HeaderEvent[];
    const { dictionary, all } = build(headers, { dictionary: [FOOD, GITHUB], query: "github" });
    expect(plurals(dictionary)).toEqual(["GitHub Accounts"]);
    expect(all).toEqual([]);
  });

  it("names keep their capitals", () => {
    const apps = concept(A, "iphone-apps", ["iPhone app", "iPhone apps"]);
    const [card] = build([apps]).all;
    expect(card.plural).toBe("iPhone apps");
    // and a name already in capitals is not lower-cased or title-cased
    const nfts = concept(B, "nfts", ["NFT", "NFTs"]);
    expect(build([nfts]).all[0].plural).toBe("NFTs");
  });

  it("a header that names nothing is hidden until showEverything, then called 'Untitled list'", () => {
    // Other apps keep their own records in kind 9998: no names, no name, no d, nothing to call a list.
    const offer: HeaderEvent = {
      id: nextId(),
      pubkey: C,
      kind: 9998,
      created_at: 1_790_000_000,
      content: '{"schema":"contentport.offer.v1"}',
      tags: [["t", "contentport-offer-v1"]],
    };
    const pets = concept(A, "pets", ["pet", "pets"]);
    const folded = build([pets, offer]);
    expect(folded.all.map((c) => c.root)).toEqual([coord(A, "pets")]);

    const shown = build([pets, offer], { showEverything: true }).all;
    expect(shown.map((c) => c.plural).sort()).toEqual(["Untitled list", "pets"]);
    expect(shown.find((c) => c.plural === "Untitled list")).toMatchObject({ root: offer.id, author: C, label: null });
  });

  it("an unnamed copy inside a concept is listed as 'Untitled list', not as nothing", () => {
    const root = concept(A, "pets", ["pet", "pets"]);
    const bare: HeaderEvent = { ...header(B, "x", null, [["b", coord(A, "pets"), "pointer"]]), tags: [["b", coord(A, "pets"), "pointer"]] };
    const [card] = build([root, bare], { showEverything: true }).all;
    expect(card.copies.map((c) => c.plural)).toEqual(["Untitled list"]);
  });

  it("a name kept only in the json tag reads as its title, not its d", () => {
    const { all } = build(bookSubmissionsHeader as HeaderEvent[]);
    expect(plurals(all)).toEqual(["Book submissions"]);
  });

  it("the governing version names the card; the concept's maker stays the author", () => {
    const root = concept(A, "pets", ["pet", "pets"], [["description", "Animals people keep."]]);
    const mine = header(B, "pets", ["critter", "Furry friends"], [
      ["description", "My take."],
      ["b", coord(A, "pets"), "pointer"],
    ]);
    const signedOut = build([root, mine]).all[0];
    expect(signedOut).toMatchObject({ root: coord(A, "pets"), plural: "pets", description: "Animals people keep." });

    const reader = build([root, mine], { reader: { pubkey: B, taPubkey: null } }).all[0];
    expect(reader).toMatchObject({
      root: coord(A, "pets"),
      plural: "Furry friends",
      description: "My take.",
      author: A,
      versions: 2,
    });

    const house = build([root, mine], { house: [B] }).all[0];
    expect(house.plural).toBe("Furry friends");
  });

  it("the list's own image shows, but only an http(s) one", () => {
    const pretty = concept(A, "pretty", ["pretty", "pretties"], [["image", "https://example.com/a.png"]]);
    const hostile = concept(B, "hostile", ["hostile", "hostiles"], [["image", "javascript:alert(1)"]]);
    const inline = concept(C, "inline", ["inline", "inlines"], [["image", "data:image/svg+xml,<svg/>"]]);
    const { all } = build([pretty, hostile, inline]);
    const byPlural = Object.fromEntries(all.map((c) => [c.plural, c.image]));
    expect(byPlural).toEqual({ pretties: "https://example.com/a.png", hostiles: null, inlines: null });
  });

  it("a concept whose header can't be found says so, named by what is left", () => {
    const orphanCopy = header(B, "pets", ["critter", "critters"], [["b", coord(A, "pets"), "pointer"]]);
    const [card] = build([orphanCopy]).all;
    expect(card).toMatchObject({ root: coord(A, "pets"), plural: "critters", description: "header not found", author: A });
    expect(card.versions).toBe(2);

    // nothing at all to name it by: its d
    const { groups, blank } = groupConcepts([orphanCopy]);
    const bare = discoverModel({
      groups: groups.map((g) => ({ ...g, copies: [] })),
      blank,
      dictionary: [],
      resolved: new Map(),
      query: "",
      showEverything: false,
    });
    expect(bare.all[0]).toMatchObject({ plural: "pets", description: "header not found", versions: 1 });
  });

  it("the real Dictionary headers: every concept once, Food's withdrawn copy only with showEverything", () => {
    const headers = dictionaryHeaders as HeaderEvent[];
    const folded = build(headers, { dictionary: [FOOD, GITHUB] });
    expect(plurals(folded.dictionary)).toEqual(["Food and Drink Places", "GitHub Accounts"]);
    const roots = [...folded.dictionary, ...folded.all].map((c) => c.root);
    expect(new Set(roots).size).toBe(roots.length); // none twice
    expect(folded.all.some((c) => c.label !== null)).toBe(false);
    // the withdrawn headers (Food's, GitHub's) sit inside their concepts, not as cards of their own
    expect(roots.filter((root) => /:(food-and-drink-places|github-accounts)$/.test(root)).sort()).toEqual([FOOD, GITHUB].sort());

    const everything = build(headers, { dictionary: [FOOD, GITHUB], showEverything: true });
    const foodCard = everything.dictionary.find((c) => c.root === FOOD)!;
    expect(foodCard.copies.filter((c) => c.label === "withdrawn").map((c) => c.author?.slice(0, 8))).toEqual(["2efaa715"]);
    expect(everything.dictionary.find((c) => c.root === GITHUB)!.copies.map((c) => c.label)).toContain("withdrawn");
  });
});
