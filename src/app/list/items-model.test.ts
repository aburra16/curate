/**
 * What a list page's rows say: each item read through
 * its definition (presentCurateItem), the title from the same field on every
 * row, items from outside the reader's web of trust folded into a count, and
 * nothing folded while ranks are unknown. The Food, Tags and DList NIP cases
 * read the real events saved in src/test/fixtures.
 */
import { describe, expect, it, vi } from "vitest";
import { definitionOf, type HeaderEvent } from "@/lib/conceptResolution";
import type { ItemEvent } from "@/services/concepts";
import { VERIFIED_RANK } from "@/services/trust";
import foodHeader from "@/test/fixtures/food.header.json";
import foodItems from "@/test/fixtures/food.items.json";
import nipExamples from "@/test/fixtures/nip.examples.json";
import tagsHeaders from "@/test/fixtures/tags.headers.json";
import tagsItems from "@/test/fixtures/tags.items.json";
import { itemKindsOf, itemsModel, type ItemsModelInput } from "./items-model";

const food = definitionOf(foodHeader[0] as HeaderEvent);
const foods = foodItems as ItemEvent[];

/** The canonical Tags header: the one the other three copy. */
const TAGS_ROOT = "82b75e474dda005e912bcbb910391c60c2b89cc7faf5d3c30b7c59a324973833";
const tags = definitionOf((tagsHeaders as HeaderEvent[]).find((h) => h.pubkey === TAGS_ROOT)!);
const CLASSICS_ID = "4d4ada496a2b3710d44d9390adbe3e9612a941e271ff3638b13c338faab569a3";

/** DList NIP example 3: a 9998 "dog name" list whose required field is `t`, and its item "Fido". */
const dogNames = definitionOf((nipExamples as HeaderEvent[]).find((e) => e.kind === 9998)!);
const fido = (nipExamples as ItemEvent[]).find((e) => e.kind === 9999)!;

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

let n = 0;
/** An item of the dog-names list by `pubkey`, with the tags given. */
const dog = (pubkey: string, tagList: string[][], created_at = 1_790_000_100): ItemEvent => ({
  id: (++n).toString(16).padStart(64, "0"),
  pubkey,
  kind: 9999,
  created_at,
  content: "",
  tags: [["z", dogNames.event.id], ...tagList],
});

const input = (over: Partial<ItemsModelInput>): ItemsModelInput => ({
  items: [],
  definition: dogNames,
  ranks: null,
  answered: new Set(),
  removed: new Map(),
  showEverything: false,
  query: "",
  order: "newest",
  ...over,
});

/** Three dogs: one by an author inside the line, one below it, one nobody ranked. */
const rex = dog(A, [["t", "Rex"]], 1_790_000_300);
const bo = dog(B, [["t", "Bo"]], 1_790_000_200);
const kip = dog(C, [["t", "Kip"]], 1_790_000_100);
const ranked = new Map([
  [A, VERIFIED_RANK + 3],
  [B, VERIFIED_RANK - 1],
]);
/** The scorer answered for all three: C has no rank, so C is outside too. */
const everyone = new Set([A, B, C]);

describe("itemsModel", () => {
  it("Food rows title from name and summarize from address", () => {
    const { shown, folded } = itemsModel(input({ items: foods, definition: food }));
    const steak = shown.find((r) => r.item.id.startsWith("2bbf8676"))!;

    expect(steak.title).toBe("Steak 'n Shake");
    expect(steak.p.title).toBe("Steak 'n Shake");
    expect(steak.p.summary).toBe("7515 North Grand Prairie Drive Peoria 61615");
    expect(steak.p.link).toMatchObject({ host: "www.steaknshake.com" });
    expect(steak.p.location?.geohash).toBe("dp0pzrexj");
    expect(steak.identity).toBe(`39999:${steak.item.pubkey}:osm-way-91202967`);
    expect(shown).toHaveLength(foods.length);
    expect(folded).toBe(0);
  });

  it("a tag row reads Classics", () => {
    const { shown } = itemsModel(input({ items: tagsItems as ItemEvent[], definition: tags }));
    const classics = shown.find((r) => r.item.id === CLASSICS_ID)!;

    expect(classics.title).toBe("Classics");
    // The bug this pins: the `client` tag's value must never become the title.
    expect(shown.map((r) => r.title)).not.toContain("Brainstorm");
  });

  it("the title field is the same for every row", () => {
    const nameless = dog(A, [["name", "Rover"], ["title", "Rover the dog"]]);
    const { shown } = itemsModel(input({ items: [fido, nameless] }));

    expect(shown.find((r) => r.item.id === fido.id)!.title).toBe("Fido");
    // Missing its `t`, it never borrows another field.
    expect(shown.find((r) => r.item.id === nameless.id)!.title).toBe("Untitled dog name");
    expect(shown.find((r) => r.item.id === nameless.id)!.p.title).toBeNull();
  });

  it("outside items fold into a count", () => {
    const { shown, folded, foldedRows } = itemsModel(input({ items: [rex, bo, kip], ranks: ranked, answered: everyone }));

    expect(shown.map((r) => r.title)).toEqual(["Rex"]);
    expect(folded).toBe(2);
    // The folded rows are kept, in order, to open in place, each marked outside.
    expect(foldedRows.map((r) => r.title)).toEqual(["Bo", "Kip"]);
    expect(foldedRows.every((r) => r.outside)).toBe(true);
    expect(shown[0].outside).toBe(false);
  });

  it("showEverything inlines outside items", () => {
    const { shown, folded, foldedRows } = itemsModel(
      input({ items: [rex, bo, kip], ranks: ranked, answered: everyone, showEverything: true }),
    );

    expect(shown.map((r) => [r.title, r.outside])).toEqual([
      ["Rex", false],
      ["Bo", true],
      ["Kip", true],
    ]);
    expect(folded).toBe(0);
    expect(foldedRows).toEqual([]);
  });

  it("unknown ranks fold nothing", () => {
    // Nothing known at all, and ranks held but no author answered for: the same.
    for (const known of [
      { ranks: null, answered: everyone },
      { ranks: ranked, answered: new Set<string>() },
    ]) {
      const { shown, folded } = itemsModel(input({ items: [rex, bo, kip], ...known }));
      expect(shown.map((r) => r.title)).toEqual(["Rex", "Bo", "Kip"]);
      expect(shown.some((r) => r.outside)).toBe(false);
      expect(folded).toBe(0);
    }
  });

  it("an author the scorer hasn't answered for is shown, never folded", () => {
    // C's read didn't end: C may be anyone, so C's item stays.
    const { shown, folded } = itemsModel(input({ items: [rex, bo, kip], ranks: ranked, answered: new Set([A, B]) }));

    expect(shown.map((r) => [r.title, r.outside])).toEqual([
      ["Rex", false],
      ["Kip", false],
    ]);
    expect(folded).toBe(1);
  });

  it("a blank item never shows, and isn't counted as folded", () => {
    const blank = dog(B, [["deleted", "true"]], 1_790_000_400);
    const { shown, folded } = itemsModel(input({ items: [blank, rex], ranks: ranked, answered: everyone }));

    expect(shown.map((r) => r.item.id)).toEqual([rex.id]);
    expect(folded).toBe(0);
  });

  it("search finds what the rows show: a tag by its name, never by its client", () => {
    const items = tagsItems as ItemEvent[];
    expect(itemsModel(input({ items, definition: tags, query: "CLASSICS" })).shown.map((r) => r.title)).toEqual([
      "Classics",
    ]);
    expect(itemsModel(input({ items, definition: tags, query: "brainstorm" })).shown).toEqual([]);
  });

  it("search reads the title and the summary, in any order, ignoring accents", () => {
    const items = [dog(A, [["t", "Chloé"]]), dog(A, [["t", "Max"]])];
    expect(itemsModel(input({ items, query: "chloe" })).shown.map((r) => r.title)).toEqual(["Chloé"]);

    const { shown } = itemsModel(input({ items: foods, definition: food, query: "peoria steak" }));
    expect(shown.map((r) => r.title)).toEqual(["Steak 'n Shake"]);
  });

  it("the fold counts only what the search finds", () => {
    const { shown, folded } = itemsModel(input({ items: [rex, bo, kip], ranks: ranked, answered: everyone, query: "bo" }));
    expect(shown).toEqual([]);
    expect(folded).toBe(1);
  });

  it("orders newest first, oldest first, or A to Z by the row's title with untitled last", () => {
    const untitled = dog(A, [], 1_790_000_500);
    const items = [kip, untitled, rex, bo];
    const titles = (order: ItemsModelInput["order"]) =>
      itemsModel(input({ items, order })).shown.map((r) => r.title);

    expect(titles("newest")).toEqual(["Untitled dog name", "Rex", "Bo", "Kip"]);
    expect(titles("oldest")).toEqual(["Kip", "Bo", "Rex", "Untitled dog name"]);
    expect(titles("name")).toEqual(["Bo", "Kip", "Rex", "Untitled dog name"]);

    // A to Z reads the shown title, so a Tags list sorts by its tags' names.
    const tagTitles = itemsModel(input({ items: tagsItems as ItemEvent[], definition: tags, order: "name" })).shown.map(
      (r) => r.title,
    );
    expect(tagTitles).toEqual([...tagTitles].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));
  });

  it("items of one second keep one order, whatever order they came in", () => {
    const one = dog(A, [["t", "One"]], 1_790_000_000);
    const two = dog(A, [["t", "Two"]], 1_790_000_000);
    const forward = itemsModel(input({ items: [one, two] })).shown.map((r) => r.item.id);
    const backward = itemsModel(input({ items: [two, one] })).shown.map((r) => r.item.id);
    expect(forward).toEqual(backward);
  });

  it("orders A to Z with one shared collator, not a locale lookup per comparison", () => {
    const compare = vi.spyOn(String.prototype, "localeCompare");
    const titles = itemsModel(input({ items: [kip, rex, bo], order: "name" })).shown.map((r) => r.title);

    expect(titles).toEqual(["Bo", "Kip", "Rex"]);
    expect(compare).not.toHaveBeenCalled();
    compare.mockRestore();
  });

  it("keeps each row the same object while nothing about it changes, so a drawn row isn't drawn again", () => {
    const before = itemsModel(input({ items: [rex, bo, kip], ranks: ranked, answered: everyone, showEverything: true }));
    const searched = itemsModel(
      input({ items: [rex, bo, kip], ranks: ranked, answered: everyone, showEverything: true, query: "o", order: "name" }),
    );
    const byId = new Map(before.shown.map((r) => [r.item.id, r]));
    expect(searched.shown.map((r) => r.title)).toEqual(["Bo"]);
    expect(searched.shown[0]).toBe(byId.get(bo.id));

    // An answer that moves an author outside makes that author's row anew.
    const later = itemsModel(input({ items: [rex, bo, kip], ranks: ranked, answered: new Set([A]), showEverything: true }));
    const laterById = new Map(later.shown.map((r) => [r.item.id, r]));
    expect(laterById.get(rex.id)).toBe(byId.get(rex.id));
    expect(laterById.get(bo.id)).not.toBe(byId.get(bo.id));
    expect(laterById.get(bo.id)?.outside).toBe(false);
  });

  describe("items removed for the session", () => {
    /** One version of the addressable dog `d`, by A. */
    const version = (d: string, created_at: number, name = "Rex"): ItemEvent => ({
      id: (++n).toString(16).padStart(64, "0"),
      pubkey: A,
      kind: 39999,
      created_at,
      content: "",
      tags: [["d", d], ["z", dogNames.event.id], ["t", name]],
    });

    it("leaves a removed item out, whichever of its versions are held", () => {
      const older = version("rex", 1_790_000_100);
      const newer = version("rex", 1_790_000_200);
      const removed = new Map([[`39999:${A}:rex`, 1_790_000_300]]);

      expect(itemsModel(input({ items: [newer, bo], removed })).shown.map((r) => r.title)).toEqual(["Bo"]);
      // A version that came in late, older than the deletion, stays out too.
      expect(itemsModel(input({ items: [older, bo], removed })).shown.map((r) => r.title)).toEqual(["Bo"]);
    });

    it("hides a version made in the second of the deletion, and shows one made after it", () => {
      const removed = new Map([[`39999:${A}:rex`, 1_790_000_300]]);
      const sameSecond = version("rex", 1_790_000_300);
      const after = version("rex", 1_790_000_301, "Rex again");

      expect(itemsModel(input({ items: [sameSecond], removed })).shown).toEqual([]);
      expect(itemsModel(input({ items: [after], removed })).shown.map((r) => r.title)).toEqual(["Rex again"]);
    });

    it("takes a removed item out of the fold's count, and touches no other item", () => {
      const removed = new Map([[bo.id, 1_790_000_900]]);
      const { shown, folded, foldedRows } = itemsModel(
        input({ items: [rex, bo, kip], ranks: ranked, answered: everyone, removed }),
      );

      expect(shown.map((r) => r.title)).toEqual(["Rex"]);
      expect(foldedRows.map((r) => r.title)).toEqual(["Kip"]);
      expect(folded).toBe(1);
    });
  });

  it("with no definition, every row is an Untitled item", () => {
    const { shown } = itemsModel(input({ items: [fido, rex], definition: null }));

    expect(shown.map((r) => r.title)).toEqual(["Untitled item", "Untitled item"]);
    expect(shown.every((r) => r.p.title === null && r.p.link === null && r.p.facts.length === 0)).toBe(true);
  });
});

describe("itemKindsOf", () => {
  it("reads the kinds a header lists beside 39999 and 9999, each once, and nothing that isn't a kind", () => {
    const header = (tags: string[][]): HeaderEvent => ({ id: "1".repeat(64), pubkey: A, kind: 39998, created_at: 1, tags });
    expect(itemKindsOf(header([["item-kind", "34236"], ["item-kind", "34236"], ["item-kind", "1"]]))).toEqual([
      34236, 1,
    ]);
    expect(itemKindsOf(header([["item-kind", "video"], ["item-kind", "-1"], ["item-kind", "70000"], ["item-kind", ""]]))).toEqual(
      [],
    );
    expect(itemKindsOf(food.event)).toEqual([]);
  });
});
