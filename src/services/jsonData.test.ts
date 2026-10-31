/**
 * Data kept as JSON: names, a title and a summary read from a `json` tag or
 * from `content` when a list declares no fields. The fixtures are real signed
 * events read from the relays (src/test/fixtures).
 */
import { describe, expect, it } from "vitest";
import { definitionOf, type HeaderEvent } from "@/lib/conceptResolution";
import { presentItem } from "@/lib/itemPresentation";
import bookSubmissionsHeader from "@/test/fixtures/book-submissions.header.json";
import foodHeader from "@/test/fixtures/food.header.json";
import foodItems from "@/test/fixtures/food.items.json";
import tagsHeaders from "@/test/fixtures/tags.headers.json";
import tagsItems from "@/test/fixtures/tags.items.json";
import type { ItemEvent } from "./concepts";
import { jsonDataOf, jsonKeyOf, namesOf, presentCurateItem } from "./jsonData";

const CLASSICS_ID = "4d4ada496a2b3710d44d9390adbe3e9612a941e271ff3638b13c338faab569a3";

const tagHeader = tagsHeaders[0] as HeaderEvent;
const submissions = bookSubmissionsHeader[0] as HeaderEvent;
const food = foodHeader[0] as HeaderEvent;
const classics = tagsItems.find((i) => i.id === CLASSICS_ID) as ItemEvent;

const A = "a".repeat(64);

/** A header with only the tags given. */
const header = (tags: string[][]): HeaderEvent => ({
  id: "1".repeat(64),
  pubkey: A,
  kind: 39998,
  created_at: 1,
  tags,
});

/** An item with only the tags and content given. */
const item = (content: string, tags: string[][] = [["d", "x"]]): ItemEvent => ({
  id: "2".repeat(64),
  pubkey: A,
  kind: 39999,
  created_at: 1,
  content,
  tags,
});

const jsonTag = (value: unknown): string[] => ["json", typeof value === "string" ? value : JSON.stringify(value)];

/** A header that declares no fields but names its JSON key, as the Tags headers do. */
const keyed = (key: string, extra: string[][] = []): HeaderEvent =>
  header([
    ["d", "thing"],
    ["names", "thing", "things"],
    jsonTag({ conceptHeader: { oKeys: { singular: key } } }),
    ...extra,
  ]);

describe("namesOf", () => {
  it("book-submissions is named from its json", () => {
    expect(submissions.tags.some((t) => t[0] === "names" || t[0] === "name")).toBe(false);
    const names = namesOf(submissions);
    expect(names.plural).toBe("Book submissions");
    expect(names.singular).toBe("Book submissions");
    expect(names.description).toBeNull();
  });

  it("takes names before anything else", () => {
    expect(namesOf(tagHeader)).toMatchObject({ singular: "tag", plural: "tags" });
    expect(namesOf(food)).toMatchObject({ singular: "Food and Drink Place", plural: "Food and Drink Places" });
  });

  it("takes name when there are no names, ahead of the json", () => {
    const h = header([["d", "d-slug"], ["name", "From name"], jsonTag({ word: { title: "From json" } })]);
    expect(namesOf(h)).toMatchObject({ singular: "From name", plural: "From name" });
  });

  it("takes conceptHeader.oNames from the json, singular and plural", () => {
    const h = header([
      ["d", "d-slug"],
      jsonTag({ word: { title: "Ignored" }, conceptHeader: { oNames: { singular: "relay", plural: "relays" } } }),
    ]);
    expect(namesOf(h)).toMatchObject({ singular: "relay", plural: "relays" });
  });

  it("takes word.title, then word.name, when the json has no oNames", () => {
    expect(namesOf(header([["d", "s"], jsonTag({ word: { title: "Title", name: "name" } })])).singular).toBe("Title");
    expect(namesOf(header([["d", "s"], jsonTag({ word: { name: "name only" } })])).singular).toBe("name only");
  });

  it("takes the json description when the header gives no description tag", () => {
    const h = header([["d", "s"], jsonTag({ conceptHeader: { description: "From json" } })]);
    expect(namesOf(h).description).toBe("From json");
    const tagged = header([
      ["d", "s"],
      ["description", "From tag"],
      jsonTag({ conceptHeader: { description: "From json" } }),
    ]);
    expect(namesOf(tagged).description).toBe("From tag");
  });

  it("falls back to d when the json is bad, or says nothing", () => {
    expect(namesOf(header([["d", "plain-d"], jsonTag("{not json")]))).toMatchObject({
      singular: "plain-d",
      plural: "plain-d",
    });
    expect(namesOf(header([["d", "plain-d"], jsonTag([1, 2])])).singular).toBe("plain-d");
    expect(namesOf(header([["d", "plain-d"], jsonTag({ word: { title: 7 } })])).singular).toBe("plain-d");
    expect(namesOf(header([["d", "plain-d"]])).singular).toBe("plain-d");
  });

  it("returns empty names for a header with nothing at all, and never throws", () => {
    expect(namesOf(header([]))).toEqual({ singular: "", plural: "", description: null });
  });
});

describe("jsonKeyOf", () => {
  it("is conceptHeader.oKeys.singular", () => {
    expect(jsonKeyOf(tagHeader)).toBe("tag");
  });

  it("is null without one, or with a json tag that isn't JSON", () => {
    expect(jsonKeyOf(submissions)).toBeNull();
    expect(jsonKeyOf(food)).toBeNull();
    expect(jsonKeyOf(header([["d", "s"], jsonTag("{oops")]))).toBeNull();
    expect(jsonKeyOf(header([["d", "s"], jsonTag({ conceptHeader: { oKeys: { singular: "" } } })]))).toBeNull();
    expect(jsonKeyOf(header([["d", "s"], jsonTag({ conceptHeader: { oKeys: { singular: 5 } } })]))).toBeNull();
  });
});

describe("jsonDataOf", () => {
  it("reads the object under the key in content", () => {
    expect(jsonDataOf(classics, "tag")).toEqual({ slug: "classics", name: "Classics", description: "" });
  });

  it("reads the json tag before content", () => {
    const i = item(JSON.stringify({ tag: { name: "From content" } }), [
      ["d", "x"],
      jsonTag({ tag: { name: "From tag" } }),
    ]);
    expect(jsonDataOf(i, "tag")).toEqual({ name: "From tag" });
  });

  it("goes on to content when the json tag is bad or lacks the key", () => {
    const content = JSON.stringify({ tag: { name: "From content" } });
    expect(jsonDataOf(item(content, [["d", "x"], jsonTag("{bad")]), "tag")).toEqual({ name: "From content" });
    expect(jsonDataOf(item(content, [["d", "x"], jsonTag({ other: {} })]), "tag")).toEqual({ name: "From content" });
  });

  it("is null for bad JSON, a missing key, or a value that isn't an object", () => {
    expect(jsonDataOf(item("not json at all"), "tag")).toBeNull();
    expect(jsonDataOf(item(""), "tag")).toBeNull();
    expect(jsonDataOf(item("{}"), "tag")).toBeNull();
    expect(jsonDataOf(item('{"tag":"Classics"}'), "tag")).toBeNull();
    expect(jsonDataOf(item('{"tag":[1]}'), "tag")).toBeNull();
    expect(jsonDataOf(item('{"tag":null}'), "tag")).toBeNull();
    expect(jsonDataOf(item("null"), "tag")).toBeNull();
    expect(jsonDataOf(item("[1,2]"), "tag")).toBeNull();
    expect(jsonDataOf(item("42"), "tag")).toBeNull();
  });

  it("does not read inherited properties as data", () => {
    expect(jsonDataOf(item("{}"), "__proto__")).toBeNull();
    expect(jsonDataOf(item("{}"), "constructor")).toBeNull();
  });

  it("survives a 200 KB content", () => {
    expect(jsonDataOf(item("x".repeat(200_000)), "tag")).toBeNull();
    const big = JSON.stringify({ tag: { name: "Big", description: "y".repeat(200_000) } });
    expect(jsonDataOf(item(big), "tag")?.name).toBe("Big");
  });
});

describe("presentCurateItem", () => {
  const tagDefinition = definitionOf(tagHeader);

  it("a tag item titles from its content JSON, never from client", () => {
    expect(classics.tags).toContainEqual(["client", "Brainstorm"]);
    expect(tagDefinition.fields).toEqual([]);
    expect(presentItem(classics, tagDefinition).title).toBeNull();
    const p = presentCurateItem(classics, tagDefinition);
    expect(p.title).toBe("Classics");
    expect(p.title).not.toBe("Brainstorm");
    // The JSON's description is empty, so there is no summary.
    expect(p.summary).toBeNull();
  });

  it("titles every Tags item from its JSON", () => {
    const titles = (tagsItems as ItemEvent[]).map((i) => presentCurateItem(i, tagDefinition).title);
    expect(titles).toContain("Classics");
    expect(titles.every((t) => t && t !== "Brainstorm")).toBe(true);
  });

  it("declared fields win over JSON", () => {
    const definition = definitionOf(food);
    expect(definition.fields.length).toBeGreaterThan(0);
    for (const i of foodItems as ItemEvent[]) {
      expect(presentCurateItem(i, definition)).toEqual(presentItem(i, definition));
    }
    expect(presentCurateItem((foodItems as ItemEvent[])[0], definition).title).toBe("Steak 'n Shake");

    // Even when the header also names a JSON key and the item holds JSON.
    const keyedFood = definitionOf({
      ...food,
      tags: [...food.tags, jsonTag({ conceptHeader: { oKeys: { singular: "place" } } })],
    });
    const withJson = {
      ...(foodItems as ItemEvent[])[0],
      content: JSON.stringify({ place: { name: "Wrong", description: "Wrong" } }),
    };
    expect(presentCurateItem(withJson, keyedFood)).toEqual(presentItem(withJson, keyedFood));
    expect(presentCurateItem(withJson, keyedFood).title).toBe("Steak 'n Shake");
  });

  it("presents as presentItem when the header names no JSON key", () => {
    const definition = definitionOf(submissions);
    const i = item(JSON.stringify({ word: { title: "Ignored" } }), [["d", "a-book"]]);
    expect(presentCurateItem(i, definition)).toEqual(presentItem(i, definition));
    expect(presentCurateItem(i, definition).title).toBeNull();
  });

  it("bad content JSON leaves the title null", () => {
    const broken = { ...classics, content: '{"tag":{"slug":"classics","name":"Cla' };
    const p = presentCurateItem(broken, tagDefinition);
    expect(p.title).toBeNull();
    expect(p.summary).toBeNull();
    // The caller's row reads "Untitled {singular}" from this.
    expect(`Untitled ${tagDefinition.singular}`).toBe("Untitled tag");
    for (const content of ["", "plain text", "null", "[]", "7", '"Classics"', "x".repeat(200_000)]) {
      expect(presentCurateItem({ ...classics, content }, tagDefinition).title).toBeNull();
    }
  });

  it("title is the JSON's name, then title, then word.title, then word.name, then d", () => {
    const definition = definitionOf(keyed("thing"));
    const titleOf = (content: unknown, tags: string[][] = [["d", "the-d"]]) =>
      presentCurateItem(item(JSON.stringify(content), tags), definition).title;

    expect(titleOf({ thing: { name: "N", title: "T" }, word: { title: "WT", name: "WN" } })).toBe("N");
    expect(titleOf({ thing: { title: "T" }, word: { title: "WT", name: "WN" } })).toBe("T");
    expect(titleOf({ thing: { slug: "s" }, word: { title: "WT", name: "WN" } })).toBe("WT");
    expect(titleOf({ thing: { slug: "s" }, word: { name: "WN" } })).toBe("WN");
    expect(titleOf({ thing: { slug: "s" } })).toBe("the-d");
    // Empty and non-string values are not names.
    expect(titleOf({ thing: { name: "", title: 5 }, word: { title: "WT" } })).toBe("WT");
    // No d: nothing is found.
    expect(titleOf({ thing: { slug: "s" } }, [])).toBeNull();
  });

  it("reads word when the item's JSON has no object under the key", () => {
    const definition = definitionOf(keyed("thing"));
    const i = item(JSON.stringify({ word: { title: "Only word" } }));
    expect(presentCurateItem(i, definition).title).toBe("Only word");
  });

  it("summary is the JSON's description when non-empty", () => {
    const definition = definitionOf(keyed("thing"));
    const present = (content: unknown) => presentCurateItem(item(JSON.stringify(content)), definition);
    expect(present({ thing: { name: "N", description: "About it" } }).summary).toBe("About it");
    expect(present({ thing: { name: "N", description: "" } }).summary).toBeNull();
    expect(present({ thing: { name: "N", description: "   " } }).summary).toBeNull();
    expect(present({ thing: { name: "N", description: 3 } }).summary).toBeNull();
    expect(present({ thing: { name: "N" } }).summary).toBeNull();
  });

  it("reads the json tag first, then content", () => {
    const definition = definitionOf(keyed("thing"));
    const i = item(JSON.stringify({ thing: { name: "From content" } }), [
      ["d", "x"],
      jsonTag({ thing: { name: "From tag" } }),
    ]);
    expect(presentCurateItem(i, definition).title).toBe("From tag");
  });

  it("changes only title and summary", () => {
    const definition = definitionOf(tagHeader);
    const base = presentItem(classics, definition);
    expect({ ...presentCurateItem(classics, definition), title: null, summary: null }).toEqual({
      ...base,
      title: null,
      summary: null,
    });
  });
});
