import type { NostrEvent } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { exactCopyTemplate, withdrawnTemplate } from "@/lib/conceptCopy";
import { B_DEFERRED, definitionOf, type ConceptDefinition } from "@/lib/conceptResolution";
import { coordinateOf, headerReferenceOf } from "@/lib/dlistFields";
import { templateOf, type UrlTemplate } from "@/lib/linkTemplates";
import { checkHeader, checkItemUnder } from "@/lib/listCheck";
import { itemTemplate } from "@/lib/listItem";
import { listDraftOf } from "@/lib/listDraft";
import booksHeaders from "@/test/fixtures/books.header.json";
import booksItems from "@/test/fixtures/books.items.json";
import foodCopies from "@/test/fixtures/food.copies.json";
import foodHeaders from "@/test/fixtures/food.header.json";
import foodItems from "@/test/fixtures/food.items.json";
import githubHeaders from "@/test/fixtures/github.header.json";
import githubItems from "@/test/fixtures/github.items.json";
import githubTemplates from "@/test/fixtures/github.template.json";
import tagHeaders from "@/test/fixtures/tags.headers.json";
import tagItems from "@/test/fixtures/tags.items.json";
import v4vHeaders from "@/test/fixtures/v4v-songs.header.json";
import v4vItems from "@/test/fixtures/v4v-songs.items.json";
import { editedHeaderTemplate } from "./headerEdit";
import { editedItemTemplate } from "./writeTemplates";

const events = (list: unknown) => list as NostrEvent[];

/** The tags as a sorted list of their JSON, with `client` left out: what saving unchanged must keep. */
const multiset = (tags: string[][]) =>
  tags
    .filter((t) => t[0] !== "client")
    .map((t) => JSON.stringify(t))
    .sort();

const blocking = (problems: { blocking: boolean; message: string }[]) =>
  problems.filter((p) => p.blocking).map((p) => p.message);

const headerSets: [string, NostrEvent[]][] = [
  ["food", events(foodHeaders)],
  ["food copies", events(foodCopies)],
  ["tags", events(tagHeaders)],
  ["books", events(booksHeaders)],
  ["github accounts", events(githubHeaders)],
  ["v4v songs", events(v4vHeaders)],
];

const headers = headerSets.flatMap(([, list]) => list);

/** A copy someone withdrew: no longer a version of the list, so it is never opened for editing. */
const isWithdrawn = (h: NostrEvent) => h.tags.some((t) => t[0] === "b" && t[1] === B_DEFERRED);
const WITHDRAWN_COPY = "fd5d5bce5be7b34135cbdeb662874512100b1d1a31ecfc5ad8a83da0ed5b1435";

const label = (h: NostrEvent) => `${h.tags.find((t) => t[0] === "d")?.[1]} by ${h.pubkey.slice(0, 8)} (${h.id.slice(0, 8)})`;

describe("the headers left out of the unchanged-save check", () => {
  it("a withdrawn copy is never opened for editing: it is the only header left out", () => {
    expect(headers.filter(isWithdrawn).map((h) => h.id)).toEqual([WITHDRAWN_COPY]);
  });
});

describe.each(headerSets)("headers: %s", (_name, list) => {
  const named = list.map((h) => [label(h), h] as const);
  const editable = list.filter((h) => !isWithdrawn(h)).map((h) => [label(h), h] as const);

  it.each(editable)("%s saves unchanged with the same tags", (_label, header) => {
    const def = definitionOf(header);
    const saved = editedHeaderTemplate(def, listDraftOf(def));
    expect(saved.kind).toBe(39998);
    expect(multiset(saved.tags)).toEqual(multiset(header.tags));
  });

  it.each(named)("%s: what it saves unchanged passes the header check", (_label, header) => {
    const def = definitionOf(header);
    const saved = editedHeaderTemplate(def, listDraftOf(def));
    expect(blocking(checkHeader(saved.tags).problems)).toEqual([]);
  });

  it.each(named)("%s: an exact copy of it passes the header check", (_label, header) => {
    const copy = exactCopyTemplate(definitionOf(header));
    expect(blocking(checkHeader(copy.tags).problems)).toEqual([]);
  });
});

describe("withdrawing a copy", () => {
  it.each(events(foodCopies).map((h) => [label(h), h] as const))("%s passes the header check", (_label, copy) => {
    const withdrawn = withdrawnTemplate(definitionOf(copy));
    expect(blocking(checkHeader(withdrawn.tags).problems)).toEqual([]);
  });
});

const urlTemplates = new Map<string, UrlTemplate>(
  events(githubTemplates).flatMap((ev): [string, UrlTemplate][] => {
    const t = templateOf(ev);
    return t ? [[ev.id, t]] : [];
  }),
);

const itemSets: [string, NostrEvent[]][] = [
  ["food", events(foodItems)],
  ["tags", events(tagItems)],
  ["books", events(booksItems)],
  ["github accounts", events(githubItems)],
  ["v4v songs", events(v4vItems)],
];

/** Each header by its coordinate: the list an item names in its first `z`. */
const headerByCoordinate = new Map<string, ConceptDefinition>(
  headers.flatMap((h): [string, ConceptDefinition][] => {
    const coordinate = coordinateOf(h);
    return coordinate ? [[coordinate, definitionOf(h)]] : [];
  }),
);

const governing = (item: NostrEvent) => {
  const coordinate = headerReferenceOf(item);
  const def = coordinate ? headerByCoordinate.get(coordinate) : undefined;
  if (!def) throw new Error(`no header for ${coordinate} in the fixtures`);
  return def;
};

/** For each field the definition declares, the item's first value of that tag, if it has one. */
const ownValues = (def: ConceptDefinition, item: NostrEvent) =>
  Object.fromEntries(
    def.fields.flatMap((f) => {
      const value = item.tags.find((t) => t[0] === f.name)?.[1];
      return value == null ? [] : [[f.name, value]];
    }),
  );

describe.each(itemSets)("items: %s", (_name, list) => {
  const named = list.map((item, i) => [`item ${i + 1} (${item.id.slice(0, 8)})`, item] as const);

  it.each(named.filter(([, item]) => item.kind === 39999))("%s saves unchanged with the same tags", (_label, item) => {
    const saved = editedItemTemplate(item, {});
    expect(saved.kind).toBe(39999);
    expect(saved.content).toBe(item.content);
    expect(multiset(saved.tags)).toEqual(multiset(item.tags));
  });

  it.each(named)("%s passes the item check under its list", (_label, item) => {
    expect(blocking(checkItemUnder(governing(item), item.tags, urlTemplates).problems)).toEqual([]);
  });

  it.each(named)("%s: a new item with the same values passes the item check", (_label, item) => {
    const def = governing(item);
    const made = itemTemplate(def, ownValues(def, item), "0a1b2c3d");
    expect(blocking(checkItemUnder(def, made.tags, urlTemplates).problems)).toEqual([]);
  });
});
