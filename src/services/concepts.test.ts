/**
 * Concepts: headers grouped by their `b` pointers, items given one identity
 * across copies, and a list read in pages. Everything here is pure; the
 * fixtures are real signed events read from the relays (src/test/fixtures).
 * `itemIdentity`, `distinctItems`, `itemFilters` and `filedItems` follow
 * Brainstorm-UI's services/dictionary.test.ts at the pinned commit.
 */
import { nip19 } from "nostr-tools";
import { describe, expect, it } from "vitest";
import { coordinateOf } from "@/lib/dlistFields";
import type { HeaderEvent } from "@/lib/conceptResolution";
import booksHeader from "@/test/fixtures/books.header.json";
import bookSubmissionsHeader from "@/test/fixtures/book-submissions.header.json";
import foodCopies from "@/test/fixtures/food.copies.json";
import foodHeader from "@/test/fixtures/food.header.json";
import foodItems from "@/test/fixtures/food.items.json";
import githubHeader from "@/test/fixtures/github.header.json";
import githubItems from "@/test/fixtures/github.items.json";
import githubTemplate from "@/test/fixtures/github.template.json";
import nipExamples from "@/test/fixtures/nip.examples.json";
import tagsHeaders from "@/test/fixtures/tags.headers.json";
import tagsItems from "@/test/fixtures/tags.items.json";
import v4vHeader from "@/test/fixtures/v4v-songs.header.json";
import v4vItems from "@/test/fixtures/v4v-songs.items.json";
import {
  conceptHandles,
  conceptRefOf,
  distinctItems,
  filedItems,
  groupConcepts,
  handleOf,
  itemFilters,
  itemIdentity,
  nextPage,
  type ItemEvent,
} from "./concepts";

const FOOD_ROOT = "39998:b83a28b7e4e5d20bd960c5faeb6625f95529166b8bdb045d42634a2f35919450:food-and-drink-places";
const TAGS_ROOT = "39998:82b75e474dda005e912bcbb910391c60c2b89cc7faf5d3c30b7c59a324973833:tag";
const BOOKS_ROOT = "39998:6aca05b812da97601151776d13de04ae71afc9d86da1408f0e72cffef72ece4b:books";
const GITHUB_ROOT = "39998:b83a28b7e4e5d20bd960c5faeb6625f95529166b8bdb045d42634a2f35919450:github-accounts";
const V4V_ROOT = "39998:77599c5c4a7ba08456679d812a414037f4b01c975fb4f577187df11d189f80d3:b504f5a8-949f-4d31-ad14-8afcebde2b34";
const HOUSE_COPY_ID = "828a037d"; // be7bf5de…'s copy of Food, in food.copies
const WITHDRAWN_ID = "fd5d5bce"; // 2efaa715…'s ["b","b-tag-deferred"], in food.copies

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);

let n = 0;
const nextId = () => (++n).toString(16).padStart(8, "0").padEnd(64, "e");

/** A header as a relay would hand it over; `extra` tags follow `d` and `names`. */
const header = (
  pubkey: string,
  d: string,
  extra: string[][] = [],
  created_at = 1_790_000_000,
): HeaderEvent => ({
  id: nextId(),
  pubkey,
  kind: 39998,
  created_at,
  content: "",
  tags: [["d", d], ["names", d, `${d}s`], ...extra],
});

const item = (
  tags: string[][],
  { kind = 39999, created_at = 1_790_000_000, pubkey = A }: { kind?: number; created_at?: number; pubkey?: string } = {},
): ItemEvent => ({ id: nextId(), pubkey, kind, created_at, content: "", tags });

const ids = (events: { id: string }[]) => events.map((e) => e.id.slice(0, 8));
const coord = (pubkey: string, d: string) => `39998:${pubkey}:${d}`;
const byPrefix = (events: HeaderEvent[], prefix: string) => {
  const hit = events.find((e) => e.id.startsWith(prefix));
  if (!hit) throw new Error(`no fixture event ${prefix}`);
  return hit;
};

describe("groupConcepts", () => {
  it("four Tags headers make one group with three copies", () => {
    const { groups, blank } = groupConcepts(tagsHeaders);
    expect(blank).toEqual([]);
    expect(groups).toHaveLength(1);
    const [g] = groups;
    expect(g.root).toBe(TAGS_ROOT);
    expect(g.kind).toBe("pointed-at");
    expect(g.rootHeader?.id.slice(0, 8)).toBe("6f38f7b7"); // 82b75e47…, which carries no b
    expect(ids(g.copies).sort()).toEqual(["3cae12a6", "610ea221", "e2f1e3e7"]); // 919ba08a…, a68dbf56…, 8e901369…
    expect(g.withdrawn).toEqual([]);
  });

  it("Food has three copies and one withdrawn", () => {
    const { groups } = groupConcepts([...foodHeader, ...foodCopies]);
    expect(groups).toHaveLength(1);
    const [g] = groups;
    expect(g.root).toBe(FOOD_ROOT);
    expect(g.kind).toBe("canonical");
    expect(g.rootHeader?.id).toBe(foodHeader[0].id);
    expect(ids(g.copies).sort()).toEqual(["34099ab0", HOUSE_COPY_ID, "d87bfb6b"].sort());
    expect(ids(g.withdrawn)).toEqual([WITHDRAWN_ID]); // same d as Food, so it files under Food
  });

  it("a blank header is set apart", () => {
    const blankHeader: HeaderEvent = { ...header(A, "gone"), tags: [["d", "gone"]] };
    const husk: HeaderEvent = { ...header(B, "husk"), tags: [["d", "husk"], ["deleted", "true"], ["names", "x", "xs"]] };
    const { groups, blank } = groupConcepts([...foodHeader, blankHeader, husk]);
    expect(blank.map((h) => h.id).sort()).toEqual([blankHeader.id, husk.id].sort());
    expect(groups.map((g) => g.root)).toEqual([FOOD_ROOT]);
  });

  it("a header blanked since is blank, and its older version doesn't come back", () => {
    const older = header(A, "list", [], 100);
    const blanked: HeaderEvent = { ...older, id: nextId(), created_at: 200, tags: [["d", "list"]] };
    const { groups, blank } = groupConcepts([older, blanked]);
    expect(groups).toEqual([]);
    expect(blank.map((h) => h.id)).toEqual([blanked.id]);
  });

  it("a withdrawn header isn't blank: its b says something", () => {
    const withdrawn = byPrefix(foodCopies, WITHDRAWN_ID);
    expect(groupConcepts([withdrawn]).blank).toEqual([]);
  });

  it("the newest version at an address is the one grouped", () => {
    const root = header(A, "pets", [["b", coord(A, "pets"), "pointer"]]);
    const copyV1 = header(B, "pets", [["b", coord(A, "pets"), "pointer"]], 100);
    const copyV2: HeaderEvent = { ...copyV1, id: nextId(), created_at: 200, tags: [["d", "pets"], ["b", "b-tag-deferred"]] };
    const { groups } = groupConcepts([copyV1, root, copyV2]);
    expect(groups).toHaveLength(1);
    expect(groups[0].copies).toEqual([]);
    expect(groups[0].withdrawn.map((h) => h.id)).toEqual([copyV2.id]);
  });

  it("a self-pointing header is canonical, with or without copies; one nobody points at is standalone", () => {
    const { groups } = groupConcepts([...booksHeader, ...bookSubmissionsHeader, ...githubHeader]);
    const by = Object.fromEntries(groups.map((g) => [g.root, g]));
    expect(by[BOOKS_ROOT].kind).toBe("canonical");
    expect(by[BOOKS_ROOT].copies).toEqual([]);
    expect(by[GITHUB_ROOT].kind).toBe("canonical");
    const submissions = coordinateOf(bookSubmissionsHeader[0])!;
    expect(by[submissions].kind).toBe("standalone");
    expect(by[submissions].rootHeader?.id).toBe(bookSubmissionsHeader[0].id);
    expect(groups).toHaveLength(3);
  });

  it("copies whose root wasn't fetched make a group saying so: no header, still pointed at", () => {
    const copies = foodCopies.filter((h) => h.id.slice(0, 8) !== WITHDRAWN_ID);
    const { groups } = groupConcepts(copies);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ root: FOOD_ROOT, rootHeader: null, kind: "pointed-at" });
    expect(groups[0].copies).toHaveLength(3);
  });

  it("a withdrawn header with no group of its name is a group of its own, marked by its own withdrawal", () => {
    const withdrawn = byPrefix(foodCopies, WITHDRAWN_ID);
    const { groups } = groupConcepts([withdrawn, ...booksHeader]);
    const own = groups.find((g) => g.withdrawn.length)!;
    expect(own.root).toBe(coordinateOf(withdrawn));
    expect(own.rootHeader).toBe(withdrawn);
    expect(own.withdrawn).toEqual([withdrawn]);
    expect(own.copies).toEqual([]);
    expect(own.kind).toBe("standalone");
    expect(groups).toHaveLength(2);
  });

  it("a withdrawn header files under a group by its d only when one group has that d", () => {
    const withdrawn = header(D, "tag", [["b", "b-tag-deferred"]]);
    const elsewhere = header(C, "tag", [["b", coord(C, "tag"), "pointer"]]);
    const ambiguous = groupConcepts([...tagsHeaders, elsewhere, withdrawn]);
    // two concepts called "tag": it belongs to neither on a guess
    expect(ambiguous.groups).toHaveLength(3);
    expect(ambiguous.groups.filter((g) => g.withdrawn.length)).toHaveLength(1);
    expect(ambiguous.groups.find((g) => g.withdrawn.length)!.rootHeader).toBe(withdrawn);
    // one concept called "tag": it files there
    const single = groupConcepts([...tagsHeaders, withdrawn]);
    expect(single.groups).toHaveLength(1);
    expect(single.groups[0].withdrawn).toEqual([withdrawn]);
  });

  it("a header carrying both the sentinel and a real pointer is a copy: the pointer is the affiliation", () => {
    const both = header(B, "pets", [["b", "b-tag-deferred"], ["b", coord(A, "pets"), "pointer"]]);
    const { groups } = groupConcepts([both]);
    expect(groups[0].copies).toEqual([both]);
    expect(groups[0].withdrawn).toEqual([]);
  });

  it("one hop only: a copy of a copy is the copy of the middle one, and the middle one a copy of the top", () => {
    const top = header(A, "t", [["b", coord(A, "t"), "pointer"]]);
    const middle = header(B, "t", [["b", coord(A, "t"), "pointer"]]);
    const leaf = header(C, "t", [["b", coord(B, "t"), "pointer"]]);
    const { groups } = groupConcepts([top, middle, leaf]);
    const by = Object.fromEntries(groups.map((g) => [g.root, g]));
    expect(Object.keys(by).sort()).toEqual([coord(A, "t"), coord(B, "t")].sort());
    expect(by[coord(A, "t")].copies).toEqual([middle]);
    expect(by[coord(B, "t")].copies).toEqual([leaf]);
  });

  it("a root that itself withdrew is still the root of its copies, without a header", () => {
    const withdrawnRoot = header(A, "pets", [["b", "b-tag-deferred"]]);
    const copy = header(B, "pets", [["b", coord(A, "pets"), "pointer"]]);
    const { groups } = groupConcepts([withdrawnRoot, copy]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ root: coord(A, "pets"), rootHeader: null });
    expect(groups[0].copies).toEqual([copy]);
    expect(groups[0].withdrawn).toEqual([withdrawnRoot]);
  });

  it("a 9998 header is its own list, named by its event id", () => {
    const dogNames = nipExamples.find((e) => e.kind === 9998) as HeaderEvent;
    const { groups } = groupConcepts([dogNames]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ root: dogNames.id, kind: "standalone" });
    expect(groups[0].rootHeader).toBe(dogNames);
  });

  it("groups come newest header first", () => {
    const old = header(A, "old", [], 100);
    const fresh = header(B, "fresh", [], 300);
    const mid = header(C, "mid", [], 200);
    const freshCopy = header(D, "old", [["b", coord(A, "old"), "pointer"]], 400);
    const { groups } = groupConcepts([old, fresh, mid, freshCopy]);
    expect(groups.map((g) => g.root)).toEqual([coord(A, "old"), coord(B, "fresh"), coord(C, "mid")]);
  });
});

describe("handleOf", () => {
  it("names an addressable header by its coordinate, and any other by its event id", () => {
    const at = (kind: number, tags: string[][]): HeaderEvent => ({ id: nextId(), pubkey: A, kind, created_at: 1, content: "", tags });
    const list = at(39998, [["d", "food"]]);
    const declared = at(39999, [["d", "clips"], ["z", "list"]]);
    const legacy = at(9998, [["d", "dogs"], ["names", "dog", "dogs"]]);

    expect(handleOf(list)).toBe(`39998:${A}:food`);
    expect(handleOf(declared)).toBe(`39999:${A}:clips`);
    expect(handleOf(at(30000, [["d", "set"]]))).toBe(`30000:${A}:set`);
    // A 9998's items name it by id, whatever `d` it carries.
    expect(handleOf(legacy)).toBe(legacy.id);
    // An addressable header with no `d` has no coordinate to be named by.
    const bare = at(39998, [["names", "x", "xs"]]);
    expect(handleOf(bare)).toBe(bare.id);
  });

  it("is how groups are keyed: a 9998 that carries a d is still its event id", () => {
    const legacy: HeaderEvent = { ...(nipExamples.find((e) => e.kind === 9998) as HeaderEvent), id: "8".repeat(64) };
    const withD: HeaderEvent = { ...legacy, tags: [["d", "dog-names"], ...legacy.tags] };
    expect(groupConcepts([withD]).groups.map((g) => g.root)).toEqual([withD.id]);
  });

  it("is what a 39999 header's copies are filed under: their coordinates", () => {
    const root: HeaderEvent = { id: nextId(), pubkey: A, kind: 39999, created_at: 1, content: "", tags: [["d", "clips"], ["z", "list"], ["b", `39999:${A}:clips`]] };
    const copy: HeaderEvent = { id: nextId(), pubkey: B, kind: 39999, created_at: 2, content: "", tags: [["d", "clips"], ["z", "list"], ["b", `39999:${A}:clips`]] };
    const [g] = groupConcepts([root, copy]).groups;
    expect(conceptHandles(g)).toEqual([`39999:${A}:clips`, `39999:${B}:clips`]);
  });
});

describe("conceptHandles", () => {
  it("is the root and every copy's coordinate, and no withdrawn one's", () => {
    const [g] = groupConcepts([...foodHeader, ...foodCopies]).groups;
    const handles = conceptHandles(g);
    expect(handles).toHaveLength(4);
    expect(handles[0]).toBe(FOOD_ROOT);
    expect(new Set(handles)).toEqual(
      new Set([FOOD_ROOT, ...g.copies.map((c) => coordinateOf(c)!)]),
    );
    expect(handles).not.toContain(coordinateOf(g.withdrawn[0]));
  });

  it("names the Tags root and its three copies", () => {
    const [g] = groupConcepts(tagsHeaders).groups;
    expect(conceptHandles(g)).toHaveLength(4);
    expect(conceptHandles(g)).toContain(TAGS_ROOT);
    expect(conceptHandles(g)).toContain(coordinateOf(byPrefix(tagsHeaders, "610ea221")));
  });

  it("a root whose header wasn't found is still a handle", () => {
    const [g] = groupConcepts(foodCopies.filter((h) => h.id.slice(0, 8) !== WITHDRAWN_ID)).groups;
    expect(conceptHandles(g)).toContain(FOOD_ROOT);
  });

  it("names a 9998 by its event id, and lists nothing twice", () => {
    const dogNames = nipExamples.find((e) => e.kind === 9998) as HeaderEvent;
    const copy9998: HeaderEvent = { ...dogNames, id: "9".repeat(64), tags: [["names", "dog name", "dog names"], ["b", dogNames.id, "pointer"]] };
    const [g] = groupConcepts([dogNames, copy9998]).groups;
    expect(conceptHandles(g)).toEqual([dogNames.id, copy9998.id]);
  });
});

describe("itemIdentity", () => {
  it("an addressable item is its coordinate: a republish replaces it", () => {
    const v1 = item([["d", "cafe"], ["z", FOOD_ROOT]], { created_at: 10 });
    const v2 = { ...v1, id: nextId(), created_at: 15 };
    expect(itemIdentity(v1)).toBe(`39999:${A}:cafe`);
    expect(itemIdentity(v2)).toBe(itemIdentity(v1));
    expect(distinctItems([v1, v2]).map((e) => e.id)).toEqual([v2.id]);
  });

  it("a kind-9999 item is its id", () => {
    const regular = item([["z", FOOD_ROOT]], { kind: 9999 });
    expect(itemIdentity(regular)).toBe(regular.id);
  });

  it("a curation copy counts as its original", () => {
    const original = item([["d", "vcavallo-1i6dn0p"], ["z", GITHUB_ROOT]]);
    const originalCoordinate = `39999:${A}:vcavallo-1i6dn0p`;
    const copy = item(
      [
        ["d", "copy-x"],
        ["z", coord(B, "github-accounts")],
        ["q", original.id, "wss://hub.example", A],
        ["q", originalCoordinate, "wss://hub.example"],
      ],
      { pubkey: B, created_at: 1_790_000_100 },
    );
    expect(itemIdentity(copy)).toBe(originalCoordinate); // the coordinate, not the id, even though the id q comes first
    expect(itemIdentity(copy)).toBe(itemIdentity(original));
    expect(distinctItems([original, copy])).toEqual([copy]); // the newer of the two
  });

  it("a curation copy that names its original only by id is that id", () => {
    const original = item([["z", FOOD_ROOT]], { kind: 9999 });
    const copy = item([["d", "copy-y"], ["z", coord(B, "x")], ["q", original.id]], { pubkey: B });
    expect(itemIdentity(copy)).toBe(original.id);
  });

  it("a copy- item with no q is only itself", () => {
    const lone = item([["d", "copy-z"], ["z", FOOD_ROOT]]);
    expect(itemIdentity(lone)).toBe(`39999:${A}:copy-z`);
  });

  it("a d that isn't copy-… is not a copy, whatever it quotes", () => {
    const quoting = item([["d", "review-1"], ["q", "39999:" + B + ":other"], ["z", FOOD_ROOT]]);
    expect(itemIdentity(quoting)).toBe(`39999:${A}:review-1`);
  });
});

describe("distinctItems", () => {
  it("keeps the newest version of each, newest first", () => {
    const a1 = item([["d", "a"], ["z", FOOD_ROOT]], { created_at: 10 });
    const a2 = item([["d", "a"], ["z", FOOD_ROOT]], { created_at: 40 });
    const b1 = item([["d", "b"], ["z", FOOD_ROOT]], { created_at: 30 });
    const c1 = item([["d", "c"], ["z", FOOD_ROOT]], { created_at: 20 });
    expect(distinctItems([a1, c1, b1, a2]).map((e) => e.id)).toEqual([a2.id, b1.id, c1.id]);
  });

  it("an item stamped under two copies is one item", () => {
    const parent = "7".repeat(64); // a 9998 parent
    const copyCoordinate = coord(B, "food-and-drink-places");
    const stamped = item([
      ["d", "joes-diner"],
      ["z", FOOD_ROOT],
      ["z", copyCoordinate],
      ["e", parent],
    ]);
    // the relay answers the #z filter and the #e filter, each with it
    const answers = [stamped, stamped, { ...stamped }];
    expect(distinctItems(answers)).toHaveLength(1);
    expect(filedItems(answers, [FOOD_ROOT, copyCoordinate, parent])).toHaveLength(1);
    // republished under both, newer: still one
    const republished = { ...stamped, id: nextId(), created_at: stamped.created_at + 1 };
    expect(distinctItems([stamped, republished, stamped]).map((e) => e.id)).toEqual([republished.id]);
    // not addressable, stamped twice: its id, still one
    const regular = item([["z", FOOD_ROOT], ["z", copyCoordinate], ["e", parent]], { kind: 9999 });
    expect(distinctItems([regular, regular])).toHaveLength(1);
  });

  it("on a tie, the original beats its copy whichever came first", () => {
    const original = item([["d", "o"], ["z", FOOD_ROOT]], { created_at: 50 });
    const copy = item([["d", "copy-o"], ["z", coord(B, "x")], ["q", `39999:${A}:o`]], { created_at: 50, pubkey: B });
    expect(distinctItems([copy, original]).map((e) => e.id)).toEqual([original.id]);
    expect(distinctItems([original, copy]).map((e) => e.id)).toEqual([original.id]);
  });

  it("on a tie between versions, the lower id wins, as NIP-01 says, whichever came first", () => {
    const low = { ...item([["d", "same"], ["z", FOOD_ROOT]], { created_at: 60 }), id: "0".repeat(63) + "1" };
    const high = { ...low, id: "f".repeat(64) };
    expect(distinctItems([high, low]).map((e) => e.id)).toEqual([low.id]);
    expect(distinctItems([low, high]).map((e) => e.id)).toEqual([low.id]);
  });
});

describe("itemFilters", () => {
  it("asks for 39999 and 9999 filed by z, without a limit unless given a page", () => {
    expect(itemFilters([FOOD_ROOT])).toEqual([{ kinds: [39999, 9999], "#z": [FOOD_ROOT] }]);
  });

  it("carries the page's limit and until", () => {
    expect(itemFilters([FOOD_ROOT], { limit: 500 })).toEqual([
      { kinds: [39999, 9999], "#z": [FOOD_ROOT], limit: 500 },
    ]);
    expect(itemFilters([FOOD_ROOT], { limit: 500, until: 1_792_631_622 })).toEqual([
      { kinds: [39999, 9999], "#z": [FOOD_ROOT], limit: 500, until: 1_792_631_622 },
    ]);
  });

  it("adds the header's own item kinds after the two it always reads, once each", () => {
    const [filter] = itemFilters([FOOD_ROOT], { limit: 10 }, [30023, 9999, 30023, 1111]);
    expect(filter.kinds).toEqual([39999, 9999, 30023, 1111]);
  });

  it("also asks by e for a 64-hex handle, a 9998 parent, and only for those", () => {
    const parent = "7".repeat(64);
    const filters = itemFilters([FOOD_ROOT, parent], { limit: 500, until: 9 });
    expect(filters).toEqual([
      { kinds: [39999, 9999], "#z": [FOOD_ROOT, parent], limit: 500, until: 9 },
      { kinds: [39999, 9999], "#e": [parent], limit: 500, until: 9 },
    ]);
    expect(itemFilters([FOOD_ROOT]).some((f) => "#e" in f)).toBe(false);
  });

  it("never asks for a bare name, and asks nothing for no handles", () => {
    expect(itemFilters(["tag-for-nostr-event", FOOD_ROOT])).toEqual([{ kinds: [39999, 9999], "#z": [FOOD_ROOT] }]);
    expect(itemFilters(["tag-for-nostr-event"])).toEqual([]);
    expect(itemFilters([])).toEqual([]);
  });

  it("reads a Tags concept's items by every handle of its group", () => {
    const [g] = groupConcepts(tagsHeaders).groups;
    const [filter] = itemFilters(conceptHandles(g));
    expect(filter["#z"]).toEqual(conceptHandles(g));
  });
});

describe("filedItems", () => {
  const [tagsGroup] = groupConcepts(tagsHeaders).groups;

  it("files Tags' items under the concept, once each", () => {
    const filed = filedItems([...tagsItems, ...tagsItems], conceptHandles(tagsGroup));
    expect(filed).toHaveLength(3);
    expect(ids(filed).sort()).toEqual(["21a4ddd4", "4d4ada49", "f2d21097"]);
  });

  it("bare-name z files nothing", () => {
    // each Tags item names the concept twice and a bare name ("tag-for-nostr-event") once
    const hintOnly = item([["d", "espresso"], ["z", "tag-for-nostr-event"]]);
    expect(filedItems([hintOnly], conceptHandles(tagsGroup))).toEqual([]);
    // even asked for by that very name
    expect(filedItems(tagsItems, ["tag-for-nostr-event", "tag-for-nostr-pubkey"])).toEqual([]);
    // and the bare name beside a real handle changes nothing about what is filed
    expect(filedItems(tagsItems, ["tag-for-nostr-event", TAGS_ROOT])).toHaveLength(3);
    // a hint that is almost a coordinate (short pubkey) is still a hint
    const almost = item([["d", "x"], ["z", "39998:abcd:tag"]]);
    expect(filedItems([almost], ["39998:abcd:tag"])).toEqual([]);
  });

  it("an item filed under a copy only is filed under the concept", () => {
    const copyOnly = item([["d", "x"], ["z", coordinateOf(byPrefix(tagsHeaders, "610ea221"))!]]);
    expect(filedItems([copyOnly], conceptHandles(tagsGroup))).toEqual([copyOnly]);
  });

  it("keeps the newer version of an item and drops what is filed elsewhere", () => {
    const older = item([["d", "cafe"], ["z", FOOD_ROOT]], { created_at: 10 });
    const newer = item([["d", "cafe"], ["z", FOOD_ROOT]], { created_at: 20 });
    const other = item([["d", "x"], ["z", GITHUB_ROOT]], { created_at: 30 });
    expect(filedItems([older, other, newer], [FOOD_ROOT]).map((e) => e.created_at)).toEqual([20]);
  });

  it("files a 9998's items by its id, whether they name it with z or, lacking one, with e", () => {
    const parent = nipExamples.find((e) => e.kind === 9998)!;
    const byZ = item([["z", parent.id], ["name", "one"]], { kind: 9999 });
    const byE = item([["e", parent.id], ["name", "two"]], { kind: 9999 });
    // a z elsewhere wins over an e here: it's filed under the other list
    const elsewhere = item([["z", FOOD_ROOT], ["e", parent.id]], { kind: 9999 });
    expect(ids(filedItems([byZ, byE, elsewhere], [parent.id])).sort()).toEqual(ids([byZ, byE]).sort());
  });

  it("leaves out an event that is a header in a 39999's clothing", () => {
    const stray = item([["d", "x"], ["z", "list"]]);
    const real = item([["d", "y"], ["z", FOOD_ROOT]]);
    expect(filedItems([stray, real], [FOOD_ROOT, "list"])).toEqual([real]);
  });

  describe("items of a kind the header declares", () => {
    const EXTRA = 34550;
    const extra = () => item([["d", "post-1"], ["z", FOOD_ROOT]], { kind: EXTRA });

    it("files when its kind is passed in itemKinds, and not when it isn't", () => {
      const post = extra();
      expect(filedItems([post], [FOOD_ROOT], [EXTRA])).toEqual([post]);
      expect(filedItems([post], [FOOD_ROOT])).toEqual([]);
      expect(filedItems([post], [FOOD_ROOT], [30023])).toEqual([]);
    });

    it("is read with the kinds itemFilters asks for, so nothing it fetches is dropped", () => {
      const post = extra();
      const asked = itemFilters([FOOD_ROOT], undefined, [EXTRA])[0].kinds!;
      expect(asked).toContain(post.kind);
      expect(filedItems([post], [FOOD_ROOT], asked)).toEqual([post]);
    });

    it("sits beside the standard kinds, newest version of each", () => {
      const standard = item([["d", "std"], ["z", FOOD_ROOT]]);
      const v1 = extra();
      const v2 = { ...v1, id: nextId(), created_at: v1.created_at + 1 };
      const filed = filedItems([standard, v1, v2], [FOOD_ROOT], [EXTRA]);
      expect(ids(filed).sort()).toEqual(ids([standard, v2]).sort());
    });

    it("is filed by z or, with none, by an e naming a 64-hex handle, as a standard item is", () => {
      const parent = "7".repeat(64);
      const byE = item([["d", "e-post"], ["e", parent]], { kind: EXTRA });
      const elsewhere = item([["d", "z-post"], ["z", GITHUB_ROOT], ["e", parent]], { kind: EXTRA });
      expect(filedItems([byE, elsewhere], [parent], [EXTRA])).toEqual([byE]);
      // an e that is not an id names nothing
      const coordinateE = item([["d", "c-post"], ["e", FOOD_ROOT]], { kind: EXTRA });
      expect(filedItems([coordinateE], [FOOD_ROOT], [EXTRA])).toEqual([]);
    });

    it("still files nothing by a bare-name z", () => {
      const hint = item([["d", "post-2"], ["z", "tag-for-nostr-event"]], { kind: EXTRA });
      expect(filedItems([hint], ["tag-for-nostr-event", FOOD_ROOT], [EXTRA])).toEqual([]);
    });

    it("never files a header, whatever kinds are listed", () => {
      const stray = item([["d", "x"], ["z", "list"]]); // a 39999 header
      const conceptHeader = item([["d", "y"], ["z", `39998:${A}:concept-header`]], { kind: 9999 });
      const listed = [39999, 9999, 39998, 9998];
      expect(filedItems([stray, conceptHeader], ["list", `39998:${A}:concept-header`], listed)).toEqual([]);
      const realHeader = { ...header(A, "h", [["z", FOOD_ROOT]]), content: "" } as unknown as ItemEvent;
      expect(filedItems([realHeader], [FOOD_ROOT], listed)).toEqual([]);
    });
  });

  it("reads real lists: Food, GitHub (without the url-templates role), V4V songs", () => {
    expect(filedItems(foodItems, [FOOD_ROOT])).toHaveLength(3);
    expect(filedItems([...githubItems, ...githubTemplate], [GITHUB_ROOT])).toHaveLength(2);
    expect(filedItems(githubTemplate, [GITHUB_ROOT])).toEqual([]);
    expect(filedItems(v4vItems, [V4V_ROOT])).toHaveLength(2); // kind 9999: each its own item
    expect(coordinateOf(v4vHeader[0])).toBe(V4V_ROOT);
  });
});

/** A relay that honours since, until and limit: newest first, ties in id order, the same first `limit` every time. */
function fakeRelay(corpus: ItemEvent[]) {
  const ordered = [...corpus].sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1));
  const calls: { since?: number; until?: number; limit: number }[] = [];
  const relay = (q: { since?: number; until?: number; limit: number }): ItemEvent[] => {
    calls.push(q);
    return ordered
      .filter((e) => (q.since === undefined || e.created_at >= q.since) && (q.until === undefined || e.created_at <= q.until))
      .slice(0, q.limit);
  };
  return Object.assign(relay, { calls });
}

/** What the loader does: a page, then its second filled when the page came back full, then the next page. */
function readAll(relay: ReturnType<typeof fakeRelay>, limit: number) {
  const seen = new Set<string>();
  const got = new Map<string, ItemEvent>();
  let repeated = 0;
  let page: { limit: number; until?: number } = { limit };
  for (let guard = 0; guard < 200; guard++) {
    const events = relay({ until: page.until, limit: page.limit });
    repeated += events.filter((e) => got.has(e.id)).length; // a later page re-sending an earlier one's events
    const { until, fillSecond } = nextPage(events, page, seen);
    for (const e of events) got.set(e.id, e);
    if (fillSecond !== null) {
      for (const e of relay({ since: fillSecond, until: fillSecond, limit: 10_000 })) got.set(e.id, e);
    }
    if (until === null) return { got, seen, repeated, pages: guard + 1 };
    page = { limit, until };
  }
  throw new Error("never stopped");
}

const makeItem = (i: number, created_at: number): ItemEvent => ({
  id: i.toString(16).padStart(64, "0"),
  pubkey: A,
  kind: 39999,
  created_at,
  content: "",
  tags: [["d", `item-${i}`], ["z", BOOKS_ROOT]],
});

describe("nextPage", () => {
  const T = 1_792_631_623;
  const page = (count: number, created_at = T) => Array.from({ length: count }, (_, i) => makeItem(i + 1, created_at));

  it("a page that came back short is the last", () => {
    expect(nextPage(page(499), { limit: 500 }, new Set())).toEqual({ until: null, fillSecond: null });
    expect(nextPage([], { limit: 500, until: 10 }, new Set())).toEqual({ until: null, fillSecond: null });
  });

  it("a full page asks for its oldest second to be filled, then goes on from the second before", () => {
    const events = [...page(499, T), makeItem(900, T - 7)];
    expect(nextPage(events, { limit: 500 }, new Set())).toEqual({ until: T - 8, fillSecond: T - 7 });
  });

  it("a page with more than its limit is full too", () => {
    expect(nextPage(page(700), { limit: 500 }, new Set())).toEqual({ until: T - 1, fillSecond: T });
  });

  it("records the page's ids in seen", () => {
    const seen = new Set<string>(["already"]);
    const events = page(3);
    nextPage(events, { limit: 500 }, seen);
    expect([...seen].sort()).toEqual(["already", ...events.map((e) => e.id)].sort());
  });

  it("stops rather than loop when a relay ignores until and sends the same page again", () => {
    expect(nextPage(page(500, T), { limit: 500, until: T - 100 }, new Set())).toEqual({ until: null, fillSecond: null });
  });

  it("pages through 1,200 items that share one second", () => {
    const sameSecond = Array.from({ length: 1200 }, (_, i) => makeItem(i + 1, T));
    const older = Array.from({ length: 300 }, (_, i) => makeItem(2000 + i, T - 1 - (i % 40)));
    const relay = fakeRelay([...older, ...sameSecond]);

    // the premise: one page of it can't show the rest of the second
    expect(relay({ until: T, limit: 500 })).toEqual(relay({ until: T, limit: 500 }));

    relay.calls.length = 0;
    const { got, seen, repeated, pages } = readAll(relay, 500);
    expect(got.size).toBe(1500);
    expect(seen.size).toBe(500 + 300); // the pages saw 500 at T, then the 300 older; the fill is not a page
    expect(repeated).toBe(0);
    expect(pages).toBe(2);
    expect(relay.calls).toEqual([
      { until: undefined, limit: 500 },
      { since: T, until: T, limit: 10_000 },
      { until: T - 1, limit: 500 },
    ]);
  });

  it("pages through several crowded seconds, and a list that is an exact number of pages", () => {
    const crowded = [
      ...Array.from({ length: 1200 }, (_, i) => makeItem(i + 1, T)),
      ...Array.from({ length: 1100 }, (_, i) => makeItem(5000 + i, T - 5)),
      ...Array.from({ length: 500 }, (_, i) => makeItem(9000 + i, T - 60)),
    ];
    const { got, repeated } = readAll(fakeRelay(crowded), 500);
    expect(got.size).toBe(2800);
    expect(repeated).toBe(0);

    const exact = Array.from({ length: 500 }, (_, i) => makeItem(i + 1, T - (i % 7)));
    const result = readAll(fakeRelay(exact), 500);
    expect(result.got.size).toBe(500);
    expect(result.pages).toBe(2); // the full page, then an empty one that says it's over
  });

  it("pages through a list with one item a second, and an empty list", () => {
    const spread = Array.from({ length: 1300 }, (_, i) => makeItem(i + 1, T - i));
    const { got, repeated } = readAll(fakeRelay(spread), 500);
    expect(got.size).toBe(1300);
    expect(repeated).toBe(0);
    expect(readAll(fakeRelay([]), 500).got.size).toBe(0);
  });
});

describe("conceptRefOf", () => {
  const D_ADDRESS = `39998:${A}:birds`;

  it("reads the address of a list header: a coordinate, an naddr, either with nostr:", () => {
    const naddr = nip19.naddrEncode({ kind: 39998, pubkey: A, identifier: "birds" });

    expect(conceptRefOf(D_ADDRESS)).toEqual({ coordinate: D_ADDRESS });
    expect(conceptRefOf(` ${D_ADDRESS} `)).toEqual({ coordinate: D_ADDRESS });
    expect(conceptRefOf(naddr)).toEqual({ coordinate: D_ADDRESS });
    expect(conceptRefOf(`nostr:${naddr}`)).toEqual({ coordinate: D_ADDRESS });
  });

  it("reads one version of a list by id: a 64-hex id, a note, an nevent", () => {
    const id = "e".repeat(64);

    expect(conceptRefOf(id)).toEqual({ id });
    expect(conceptRefOf(nip19.noteEncode(id))).toEqual({ id });
    expect(conceptRefOf(nip19.neventEncode({ id }))).toEqual({ id });
  });

  it("reads a 39999 that declares itself a header, which listRef does not", () => {
    const address = `39999:${A}:songs`;
    const naddr = nip19.naddrEncode({ kind: 39999, pubkey: A, identifier: "songs" });

    expect(conceptRefOf(address)).toEqual({ coordinate: address });
    expect(conceptRefOf(naddr)).toEqual({ coordinate: address });
  });

  it("reads nothing else", () => {
    expect(conceptRefOf("")).toBeNull();
    expect(conceptRefOf("birds")).toBeNull();
    expect(conceptRefOf(`30023:${A}:essay`)).toBeNull();
    expect(conceptRefOf(nip19.npubEncode(A))).toBeNull();
    expect(conceptRefOf(nip19.naddrEncode({ kind: 30023, pubkey: A, identifier: "essay" }))).toBeNull();
  });
});
