import { describe, expect, it } from "vitest";
import type { ItemEvent } from "@/services/concepts";
import { heldFor, panelFilter, panelHref, panelRefOf } from "./panel-model";

const CURATOR = "b83a28b7e4e5d20bd960c5faeb6625f95529166b8bdb045d42634a2f35919450";
const ID = "ab".repeat(32);
const item = (id: string, d: string, tags: string[][] = []): ItemEvent => ({
  id,
  pubkey: CURATOR,
  kind: 39999,
  created_at: 1,
  content: "",
  tags: [["d", d], ...tags],
});

describe("panelRefOf", () => {
  it("reads a coordinate or an event id, and nothing else", () => {
    expect(panelRefOf(`39999:${CURATOR}:steak`)).toEqual({ coordinate: `39999:${CURATOR}:steak` });
    // The way a list is filed under an address: the key lower-cased, the d kept as written.
    expect(panelRefOf(`39999:${CURATOR.toUpperCase()}:Steak 'n Shake`)).toEqual({ coordinate: `39999:${CURATOR}:Steak 'n Shake` });
    expect(panelRefOf(ID.toUpperCase())).toEqual({ id: ID });
    expect(panelRefOf("  " + ID + " ")).toEqual({ id: ID });
    for (const bad of [null, "", "header", "javascript:alert(1)", "39999:nothex:x", ID.slice(1)]) {
      expect(panelRefOf(bad)).toBeNull();
    }
  });
});

describe("panelFilter", () => {
  it("asks for an address by kind, author and d, and an id by id", () => {
    expect(panelFilter({ coordinate: `39999:${CURATOR}:steak:2` })).toEqual({ kinds: [39999], authors: [CURATOR], "#d": ["steak:2"] });
    expect(panelFilter({ id: ID })).toEqual({ ids: [ID] });
  });
});

describe("heldFor", () => {
  const steak = item("1".repeat(64), "steak");
  const held = [item("2".repeat(64), "other"), steak];

  it("finds a held item by its address or its id", () => {
    expect(heldFor({ coordinate: `39999:${CURATOR}:steak` }, held)).toBe(steak);
    expect(heldFor({ id: steak.id }, held)).toBe(steak);
    expect(heldFor({ coordinate: `39999:${CURATOR}:nowhere` }, held)).toBeNull();
    expect(heldFor({ id: "3".repeat(64) }, held)).toBeNull();
  });

  it("finds an item by the address a curation copy stands for", () => {
    const copy = item("4".repeat(64), "copy-steak", [["q", `39999:${CURATOR}:steak`]]);
    expect(heldFor({ coordinate: `39999:${CURATOR}:steak` }, [copy])).toBe(copy);
  });
});

describe("panelHref", () => {
  const here = new URLSearchParams({ c: `39998:${CURATOR}:food`, version: CURATOR });
  const read = (href: string) => {
    const [path, query] = href.split("?");
    return { path, params: new URLSearchParams(query) };
  };

  it("keeps the list's own parameters beside the panel's", () => {
    const { path, params } = read(panelHref(here, { item: `39999:${CURATOR}:steak` }));
    expect(path).toBe("/list");
    expect([...params]).toEqual([
      ["c", `39998:${CURATOR}:food`],
      ["version", CURATOR],
      ["item", `39999:${CURATOR}:steak`],
    ]);
  });

  it("opens the header with event=header", () => {
    expect(read(panelHref(here, { header: true })).params.get("event")).toBe("header");
  });

  it("replaces whatever panel was open, and closing leaves none", () => {
    const open = new URLSearchParams(here);
    open.set("item", "old");
    expect(read(panelHref(open, { header: true })).params.get("item")).toBeNull();
    const closed = read(panelHref(open, {})).params;
    expect(closed.has("item")).toBe(false);
    expect(closed.has("event")).toBe(false);
    expect(closed.get("c")).toBe(`39998:${CURATOR}:food`);
    expect(closed.get("version")).toBe(CURATOR);
  });

  it("round-trips an identity with spaces and quotes", () => {
    const identity = `39999:${CURATOR}:Steak 'n Shake & more`;
    expect(read(panelHref(here, { item: identity })).params.get("item")).toBe(identity);
  });
});
