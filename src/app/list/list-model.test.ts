/**
 * What a list page's top says: which version of the concept
 * governs for this reader, how it relates to the community header, the
 * versions a reader can read instead, and what the page does with a link to
 * a copy. The Food cases read the real header, copies and withdrawn header
 * of 31 October (src/test/fixtures); the rest are built to isolate one rule.
 */
import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";
import type { HeaderEvent } from "@/lib/conceptResolution";
import foodCopies from "@/test/fixtures/food.copies.json";
import foodHeader from "@/test/fixtures/food.header.json";
import { listModel, type ListModel } from "./list-model";

const CURATOR = "b83a28b7e4e5d20bd960c5faeb6625f95529166b8bdb045d42634a2f35919450";
const HOUSE = "be7bf5de068c1d842ed34a7c270507ec940f5ea51671cfd062a95e9d09420d0a";
const OTHER_COPY = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
/** The newest copy of Food, by a third author. */
const NEWEST_COPY = "e5272de914bd301755c439b88e6959a43c9d2664831f093c51e9c799a16a102f";
const WITHDRAWER = "2efaa715bbb46dd5be6b7da8d7700266d11674b913b8178addb5c2e63d987331";
const FOOD = `39998:${CURATOR}:food-and-drink-places`;

const food = [...(foodHeader as HeaderEvent[]), ...(foodCopies as HeaderEvent[])];

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);

let n = 0;
const nextId = () => (++n).toString(16).padStart(8, "0").padEnd(64, "e");

/** A header as a relay hands it over; `extra` tags follow `d` and `names`. */
const header = (
  pubkey: string,
  d: string,
  extra: string[][] = [],
  { kind = 39998, created_at = 1_790_000_000 }: { kind?: number; created_at?: number } = {},
): HeaderEvent => ({
  id: nextId(),
  pubkey,
  kind,
  created_at,
  content: "",
  tags: [["d", d], ["names", d, `${d}s`], ...extra],
});

const coord = (pubkey: string, d: string) => `39998:${pubkey}:${d}`;
const pointer = (target: string) => ["b", target, "pointer"];

const SIGNED_OUT = { pubkey: null, taPubkey: null };

const input = (over: Partial<Parameters<typeof listModel>[0]> = {}): Parameters<typeof listModel>[0] => ({
  c: FOOD,
  headers: food,
  reader: SIGNED_OUT,
  houseAuthors: [HOUSE],
  version: null,
  ...over,
});

/** The model, asserting the page is not being sent elsewhere or left empty. */
const modelOf = (over?: Partial<Parameters<typeof listModel>[0]>): ListModel => {
  const out = listModel(input(over));
  if (!out || "redirect" in out) throw new Error(`expected a model, got ${JSON.stringify(out)}`);
  return out;
};

describe("listModel", () => {
  it("a copy's slug redirects to its concept with version", () => {
    const houseCopy = food.find((h) => h.pubkey === HOUSE)!;
    const out = listModel(input({ c: `39998:${HOUSE}:food-and-drink-places` }));

    expect(houseCopy.kind).toBe(39998);
    expect(out).toEqual({ redirect: `/list?c=${encodeURIComponent(FOOD)}&version=${HOUSE}` });
  });

  it("a copy named by its event id, or by naddr, redirects the same way", () => {
    const houseCopy = food.find((h) => h.pubkey === HOUSE)!;
    const naddr = nip19.naddrEncode({ kind: 39998, pubkey: HOUSE, identifier: "food-and-drink-places" });
    const redirect = { redirect: `/list?c=${encodeURIComponent(FOOD)}&version=${HOUSE}` };

    expect(listModel(input({ c: houseCopy.id }))).toEqual(redirect);
    expect(listModel(input({ c: naddr }))).toEqual(redirect);
    expect(listModel(input({ c: `nostr:${naddr}` }))).toEqual(redirect);
  });

  it("reader null resolves to the house copy", () => {
    const model = modelOf();

    expect(model.root).toBe(FOOD);
    expect(model.source).toBe("house");
    expect(model.definition.event.pubkey).toBe(HOUSE);
    expect(model.headerMissing).toBe(false);
    // The house words its copy differently from the community header, and says so.
    expect(model.agreement).toBe("differs");
    expect(model.differences).toContain("fields");
  });

  it("reader null with no house found resolves to the community header", () => {
    const model = modelOf({ houseAuthors: [] });

    expect(model.source).toBe("community");
    expect(model.agreement).toBe("no-local-copy");
    expect(model.differences).toEqual([]);
    expect(model.definition.event.pubkey).toBe(CURATOR);
  });

  it("reader with own copy resolves personal", () => {
    const mine = header(C, "food-and-drink-places", [pointer(FOOD)]);
    const model = modelOf({ headers: [...food, mine], reader: { pubkey: C, taPubkey: null } });

    expect(model.source).toBe("personal");
    expect(model.definition.event.id).toBe(mine.id);
  });

  it("the reader's Assistant's copy governs when the reader has none, ahead of the house", () => {
    const theirs = header(D, "food-and-drink-places", [pointer(FOOD)]);
    const model = modelOf({ headers: [...food, theirs], reader: { pubkey: C, taPubkey: D } });

    expect(model.source).toBe("assistant");
    expect(model.definition.event.id).toBe(theirs.id);
  });

  it("differences name the fields that differ", () => {
    const root = coord(A, "thing");
    const community = header(A, "thing", [["required", "name"], pointer(root)]);
    const copy = header(B, "thing", [["required", "name"], ["optional", "extra"], pointer(root)]);

    const model = modelOf({
      c: root,
      headers: [community, copy],
      reader: { pubkey: B, taPubkey: null },
      houseAuthors: [],
    });

    expect(model.source).toBe("personal");
    expect(model.agreement).toBe("differs");
    expect(model.differences).toEqual(["fields"]);
  });

  it("a copy that matches the community header agrees", () => {
    const root = coord(A, "thing");
    const community = header(A, "thing", [["required", "name"], pointer(root)]);
    const copy = header(B, "thing", [["required", "name"], pointer(root)]);

    const model = modelOf({ c: root, headers: [community, copy], houseAuthors: [B] });

    expect(model.source).toBe("house");
    expect(model.agreement).toBe("agrees");
    expect(model.differences).toEqual([]);
  });

  it("a 39999 header slug resolves", () => {
    const declared = header(A, "declared", [["z", "list"], ["required", "name"]], { kind: 39999 });
    const slug = `39999:${A}:declared`;

    const model = modelOf({ c: slug, headers: [declared], houseAuthors: [] });

    expect(model.root).toBe(slug);
    expect(model.definition.event.id).toBe(declared.id);
    expect(model.source).toBe("community");
    expect(model.handles).toEqual([slug]);
  });

  it("a 9998 header resolves by its event id", () => {
    const unreplaceable = header(A, "x", [["required", "name"]], { kind: 9998 });
    unreplaceable.tags = unreplaceable.tags.filter((t) => t[0] !== "d");

    const model = modelOf({ c: unreplaceable.id, headers: [unreplaceable], houseAuthors: [] });

    expect(model.root).toBe(unreplaceable.id);
    expect(model.handles).toEqual([unreplaceable.id]);
    expect(model.definition.event.id).toBe(unreplaceable.id);
  });

  it("a missing root still renders from copies, headerMissing true", () => {
    const copies = food.filter((h) => h.pubkey !== CURATOR);

    const model = modelOf({ headers: copies });

    expect(model.headerMissing).toBe(true);
    expect(model.root).toBe(FOOD);
    expect(model.source).toBe("house");
    // Nothing to compare the house's copy with.
    expect(model.agreement).toBe("unknown");
    expect(model.versions.map((v) => v.label)).not.toContain("community");
  });

  it("a missing root with no copy that applies shows the newest copy, as one a reader chose", () => {
    const copies = food.filter((h) => h.pubkey !== CURATOR);

    const model = modelOf({ headers: copies, houseAuthors: [] });

    expect(model.headerMissing).toBe(true);
    expect(model.source).toBe("version");
    expect(model.agreement).toBe("unknown");
    expect(model.definition.event.pubkey).toBe(NEWEST_COPY);
  });

  it("nothing known about the slug is nothing to show", () => {
    expect(listModel(input({ c: coord(A, "nowhere"), headers: food }))).toBeNull();
    expect(listModel(input({ c: "not a list", headers: food }))).toBeNull();
    expect(listModel(input({ c: "", headers: [] }))).toBeNull();
    // Only list headers are lists.
    expect(listModel(input({ c: `30023:${A}:essay`, headers: food }))).toBeNull();
  });

  it("handles are the root and every copy", () => {
    const model = modelOf();

    expect(model.handles[0]).toBe(FOOD);
    expect(model.handles).toContain(`39998:${HOUSE}:food-and-drink-places`);
    expect(model.handles).toContain(`39998:${OTHER_COPY}:food-and-drink-places`);
    // The withdrawn header is no copy.
    expect(model.handles.some((h) => h.includes(WITHDRAWER))).toBe(false);
  });

  describe("version", () => {
    it("selects that copy's definition", () => {
      const model = modelOf({ version: OTHER_COPY });

      expect(model.source).toBe("version");
      expect(model.definition.event.pubkey).toBe(OTHER_COPY);
      expect(model.agreement).toBe("differs");
      expect(model.differences).toContain("fields");
    });

    it("selects the community header by its author when that author has no copy", () => {
      const model = modelOf({ version: CURATOR });

      expect(model.source).toBe("community");
      expect(model.agreement).toBe("no-local-copy");
      expect(model.definition.event.pubkey).toBe(CURATOR);
    });

    it("is ignored when it names nobody's version", () => {
      const model = modelOf({ version: A });

      expect(model.source).toBe("house");
    });

    it("beats the reader's own copy", () => {
      const mine = header(C, "food-and-drink-places", [pointer(FOOD)]);
      const model = modelOf({ headers: [...food, mine], reader: { pubkey: C, taPubkey: null }, version: HOUSE });

      expect(model.source).toBe("version");
      expect(model.definition.event.pubkey).toBe(HOUSE);
    });
  });

  describe("versions", () => {
    it("lists the community header, then each author's copy, labelled", () => {
      const mine = header(C, "food-and-drink-places", [pointer(FOOD)]);
      const theirs = header(D, "food-and-drink-places", [pointer(FOOD)]);
      const model = modelOf({
        headers: [...food, mine, theirs],
        reader: { pubkey: C, taPubkey: D },
      });

      expect(model.versions.map((v) => [v.author.slice(0, 8), v.label])).toEqual([
        [CURATOR.slice(0, 8), "community"],
        [C.slice(0, 8), "yours"],
        [D.slice(0, 8), "assistant"],
        [HOUSE.slice(0, 8), "house"],
        // Within a label, newest first.
        [NEWEST_COPY.slice(0, 8), "copy"],
        [OTHER_COPY.slice(0, 8), "copy"],
      ]);
      expect(model.versions[0].coordinate).toBe(FOOD);
      expect(model.versions[1].coordinate).toBe(`39998:${C}:food-and-drink-places`);
    });

    it("lists one version for an author who made two", () => {
      const first = header(C, "food-and-drink-places", [pointer(FOOD)], { created_at: 1_790_000_000 });
      const second = header(C, "food-v2", [pointer(FOOD)], { created_at: 1_790_000_100 });
      const model = modelOf({ headers: [...food, first, second] });

      expect(model.versions.filter((v) => v.author === C)).toHaveLength(1);
      // The one that shares the concept's `d` is the author's copy, as `copyBy` picks it.
      expect(model.versions.find((v) => v.author === C)?.coordinate).toBe(`39998:${C}:food-and-drink-places`);
    });

    it("has only the community header for a list nobody copied", () => {
      const lonely = header(A, "lonely", [pointer(coord(A, "lonely"))]);
      const model = modelOf({ c: coord(A, "lonely"), headers: [lonely] });

      expect(model.versions).toEqual([{ author: A, coordinate: coord(A, "lonely"), label: "community" }]);
    });
  });

  describe("a withdrawn header", () => {
    it("opens as a list of its own", () => {
      const slug = `39998:${WITHDRAWER}:food-and-drink-places`;
      const model = modelOf({ c: slug });

      expect(model.root).toBe(slug);
      expect(model.definition.event.pubkey).toBe(WITHDRAWER);
      expect(model.source).toBe("community");
      expect(model.handles).toEqual([slug]);
    });
  });
});
