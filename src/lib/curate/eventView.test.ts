import { nip19 } from "nostr-tools";
import type { NostrEvent } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { definitionOf, type HeaderEvent } from "@/lib/conceptResolution";
import { DCOSL } from "@/services/relays";
import foodHeaders from "@/test/fixtures/food.header.json";
import foodItems from "@/test/fixtures/food.items.json";
import tagHeaders from "@/test/fixtures/tags.headers.json";
import tagItems from "@/test/fixtures/tags.items.json";
import { classifyTags, eventIdentity, itemNotice, jsonOf, prettyJson } from "./eventView";

const CURATOR = "b83a28b7e4e5d20bd960c5faeb6625f95529166b8bdb045d42634a2f35919450";
const FOOD = `39998:${CURATOR}:food-and-drink-places`;
const HEX = "ab".repeat(32);

const food = definitionOf(foodHeaders[0] as HeaderEvent);
const tags = definitionOf(tagHeaders[0] as HeaderEvent);
const steak = foodItems[0] as NostrEvent;
const espresso = tagItems.find((e) => e.id.startsWith("21a4ddd4")) as NostrEvent;

/** A signed-looking event; nothing here is verified. */
const event = (over: Partial<NostrEvent> & { tags: string[][] }): NostrEvent => ({
  id: HEX,
  pubkey: CURATOR,
  kind: 39999,
  created_at: 1_790_000_000,
  content: "",
  sig: "0".repeat(128),
  ...over,
});

const rowOf = (rows: ReturnType<typeof classifyTags>, name: string, index = 0) =>
  rows.filter((r) => r.tag[0] === name)[index];

describe("classifyTags", () => {
  it("client on a tag item is metadata", () => {
    const rows = classifyTags(espresso, tags);
    expect(rowOf(rows, "client")).toMatchObject({ role: "metadata", label: null, target: null });
    // The tag item's other tags are the protocol's, and every row keeps its tag.
    expect(rowOf(rows, "d")).toMatchObject({ role: "protocol", tag: ["d", "espresso"] });
    expect(rows).toHaveLength(espresso.tags.length);
  });

  it("a declared field is a field, labelled with the header's description", () => {
    const rows = classifyTags(steak, food);
    expect(rowOf(rows, "g")).toMatchObject({ role: "field", label: "Geohash of the location" });
    // `g` repeats once per precision: each is a row.
    expect(rows.filter((r) => r.tag[0] === "g")).toHaveLength(4);
    expect(rowOf(rows, "name")).toMatchObject({ role: "field", label: "Name of the business" });
    expect(rowOf(rows, "alt")).toMatchObject({ role: "metadata" });
    expect(rowOf(rows, "t")).toMatchObject({ role: "undeclared", label: null, target: null });
  });

  it("with no definition nothing is a field", () => {
    const rows = classifyTags(steak, null);
    expect(rowOf(rows, "name")).toMatchObject({ role: "undeclared" });
    expect(rowOf(rows, "z")).toMatchObject({ role: "protocol" });
    expect(rows.some((r) => r.role === "field")).toBe(false);
  });

  it("a protocol tag the definition declares is a field", () => {
    const withS = definitionOf(
      event({ kind: 39998, tags: [["d", "x"], ["optional", "s", "Source of it"]] }) as HeaderEvent,
    );
    const rows = classifyTags(event({ tags: [["s", "somewhere"], ["k", "1"]] }), withS);
    expect(rows[0]).toMatchObject({ role: "field", label: "Source of it" });
    expect(rows[1]).toMatchObject({ role: "protocol" });
  });

  it("every protocol name is protocol, and every metadata name is metadata", () => {
    const names = ["d", "z", "b", "q", "e", "a", "p", "k", "n", "s", "o"];
    const rows = classifyTags(event({ tags: names.map((n) => [n, "x"]) }), null);
    expect(rows.map((r) => r.role)).toEqual(names.map(() => "protocol"));
    const meta = classifyTags(event({ tags: [["client", "c"], ["alt", "a"], ["expiration", "1"]] }), null);
    expect(meta.map((r) => r.role)).toEqual(["metadata", "metadata", "metadata"]);
  });

  it("z coordinates link to their list; bare-name z doesn't", () => {
    const rows = classifyTags(
      event({
        tags: [
          ["z", FOOD],
          ["z", "tag-for-nostr-event"],
          ["z", "list"],
          ["b", FOOD, "pointer"],
          ["b", "b-tag-deferred"],
          ["z", `39998:${CURATOR.toUpperCase()}:mixed-case`],
          ["z", "39998:nothex:x"],
          ["z", HEX],
        ],
      }),
      null,
    );
    expect(rows.map((r) => r.target)).toEqual([
      { kind: "list", value: FOOD },
      null,
      null,
      { kind: "list", value: FOOD },
      null,
      // The address is spelled the way a list is filed under it: lower-case.
      { kind: "list", value: `39998:${CURATOR}:mixed-case` },
      null,
      // A 9998 list is named by its header's event id.
      { kind: "list", value: HEX },
    ]);
  });

  it("a coordinate or a 64-hex id opens an event; a 64-hex p opens a profile", () => {
    const coordinate = `39999:${CURATOR}:espresso`;
    const rows = classifyTags(
      event({
        tags: [
          ["a", coordinate],
          ["a", "not-a-coordinate"],
          ["e", HEX],
          ["e", "abc"],
          ["p", HEX],
          ["p", "npub1whatever"],
          ["p", `${HEX}00`],
        ],
      }),
      null,
    );
    expect(rows.map((r) => r.target)).toEqual([
      { kind: "event", value: coordinate },
      null,
      { kind: "event", value: HEX },
      null,
      { kind: "profile", value: HEX },
      null,
      null,
    ]);
  });

  it("a url field links when the value is http(s)", () => {
    const rows = classifyTags(steak, food);
    expect(rowOf(rows, "website")?.target).toEqual({
      kind: "url",
      value: "https://www.steaknshake.com/locations/il-peoria-n-grand-prairie-drive/",
    });
    // The same text in a field that isn't typed url is just text.
    expect(rowOf(rows, "source")?.target).toBeNull();
    expect(rowOf(classifyTags(event({ tags: [["website", "https://x.example/"]] }), null), "website")?.target).toBeNull();
  });

  it("classifyTags never links a non-http url", () => {
    const hostile = ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "  JaVaScRiPt:alert(1)", "ftp://x.example/", "//x.example/", "not a url"];
    const rows = classifyTags(event({ tags: hostile.map((v) => ["website", v]) }), food);
    expect(rows).toHaveLength(hostile.length);
    for (const row of rows) {
      expect(row.role).toBe("field");
      expect(row.target).toBeNull();
    }
  });

  it("survives malformed tags", () => {
    const odd = event({ tags: [["d"], [], ["p"], ["z", ""], ["website"]] });
    expect(() => classifyTags(odd, food)).not.toThrow();
    expect(classifyTags(odd, food).every((r) => r.target === null)).toBe(true);
  });
});

describe("prettyJson", () => {
  it("pretty-prints content that is JSON", () => {
    expect(prettyJson(espresso)).toBe(JSON.stringify(JSON.parse(espresso.content), null, 2));
    expect(jsonOf(espresso)).toMatchObject({ source: "content" });
  });

  it("reads the json tag before content", () => {
    const both = event({ content: '{"from":"content"}', tags: [["json", '{"from":"tag"}']] });
    expect(prettyJson(both)).toBe('{\n  "from": "tag"\n}');
    expect(jsonOf(both)?.source).toBe("json");
    // A json tag that is bad hands over to content.
    const bad = event({ content: '{"from":"content"}', tags: [["json", "{oops"]] });
    expect(jsonOf(bad)).toMatchObject({ source: "content", text: '{\n  "from": "content"\n}' });
  });

  it("bad content JSON shows as text", () => {
    for (const content of ["", "   ", "just words", "{not json", '{"cut":', "[1,2", "42", "true", "null", '"a string"']) {
      expect(prettyJson(event({ content, tags: [] }))).toBeNull();
    }
    expect(prettyJson(event({ content: "{}", tags: [["json", "nope"]] }))).toBe("{}");
  });

  it("a 200 KB content renders", () => {
    const content = JSON.stringify({ blob: "x".repeat(200 * 1024), list: Array.from({ length: 200 }, (_, i) => ({ i })) });
    expect(content.length).toBeGreaterThan(200 * 1024);
    const big = event({ content, tags: [] });
    const start = performance.now();
    const text = prettyJson(big);
    expect(performance.now() - start).toBeLessThan(100);
    expect(text).toContain('"blob"');
    // Content that is 200 KB of something that isn't JSON is as quick to give up on.
    const junk = event({ content: "{" + "y".repeat(200 * 1024), tags: [] });
    const t2 = performance.now();
    expect(prettyJson(junk)).toBeNull();
    expect(performance.now() - t2).toBeLessThan(100);
  });

  it("deeply nested JSON that cannot be read is no JSON, not a crash", () => {
    const deep = event({ content: "[".repeat(200_000) + "]".repeat(200_000), tags: [] });
    expect(() => prettyJson(deep)).not.toThrow();
  });
});

describe("eventIdentity", () => {
  it("naddr for 39999, nevent for 9999", () => {
    const item = event({ kind: 39999, tags: [["d", "espresso"]] });
    const a = eventIdentity(item);
    expect(a.coordinate).toBe(`39999:${CURATOR}:espresso`);
    expect(a.id).toBe(HEX);
    expect(a.bech32.startsWith("naddr1")).toBe(true);
    const decoded = nip19.decode(a.bech32);
    expect(decoded.type).toBe("naddr");
    if (decoded.type === "naddr") {
      expect(decoded.data).toEqual({ kind: 39999, pubkey: CURATOR, identifier: "espresso", relays: [DCOSL] });
    }

    const plain = event({ kind: 9999, tags: [["d", "ignored"]] });
    const n = eventIdentity(plain);
    expect(n.coordinate).toBeNull();
    expect(n.bech32.startsWith("nevent1")).toBe(true);
    const nd = nip19.decode(n.bech32);
    expect(nd.type).toBe("nevent");
    if (nd.type === "nevent") expect(nd.data).toMatchObject({ id: HEX, relays: [DCOSL], author: CURATOR, kind: 9999 });
  });

  it("a header is addressed by its coordinate too", () => {
    expect(eventIdentity(foodHeaders[0] as NostrEvent).coordinate).toBe(FOOD);
  });

  it("an addressable event with no d tag has no coordinate, and is named by its id", () => {
    const id = eventIdentity(event({ kind: 39999, tags: [] }));
    expect(id.coordinate).toBeNull();
    expect(id.bech32.startsWith("nevent1")).toBe(true);
  });

  it("a d tag that is empty is still a d tag", () => {
    expect(eventIdentity(event({ kind: 39999, tags: [["d", ""]] })).coordinate).toBe(`39999:${CURATOR}:`);
  });
});

describe("itemNotice", () => {
  it("has nothing to say about an item its list's definition can read", () => {
    expect(itemNotice(steak, food)).toBeNull();
    expect(itemNotice(event({ tags: [["d", "x"], ["z", FOOD], ["category", "cafe"]] }), food)).toBeNull();
  });

  it("says why there is nothing to draw when the list's header wasn't found", () => {
    expect(itemNotice(steak, null)).toMatch(/header was not found/);
  });

  it("says why when a JSON list's item has no readable JSON", () => {
    const bad = event({ content: "{not json", tags: [["d", "x"], ["z", tags.coordinate]] });
    expect(itemNotice(bad, tags)).toMatch(/JSON could not be read/);
    // A tag item whose JSON reads has nothing to flag; the data is in Pretty.
    expect(itemNotice(espresso, tags)).toBeNull();
  });
});
