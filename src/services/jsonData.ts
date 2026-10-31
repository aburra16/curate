/**
 * Data kept as JSON. Some lists keep what they say in JSON rather than in
 * tags: a Tags item holds `{"tag":{"slug":…,"name":"Classics",…}}` in its
 * `content` and carries only `d`, `z` and `["client","Brainstorm"]`; Unbnd's
 * `book-submissions` header has no `names`, only a `json` tag whose
 * `word.title` is "Book submissions". A tapestry concept header names the
 * JSON key its items use at `conceptHeader.oKeys.singular`.
 *
 * The standard disagrees with itself on where an item's JSON lives (the
 * `json` tag or `content`), so Curate reads both,
 * the tag first. Everything is parsed inside try/catch: JSON that is bad,
 * or isn't an object, is no data, and never throws.
 *
 * Pure: nothing here reads a relay. The lib/ files it builds on are
 * vendored, so JSON is handled here, beside them.
 */
import { headerNames } from "@/lib/dlistFields";
import type { ConceptDefinition, HeaderEvent } from "@/lib/conceptResolution";
import { presentItem, type ItemPresentation } from "@/lib/itemPresentation";
import type { ItemEvent } from "@/services/concepts";

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** An own property's value: JSON keys like `__proto__` and `constructor` never reach the prototype chain. */
const ownValue = (object: JsonObject, key: string): unknown =>
  Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined;

/** An own property that is an object, or null. */
const objectAt = (object: JsonObject | null, key: string): JsonObject | null => {
  const value = object ? ownValue(object, key) : undefined;
  return isObject(value) ? value : null;
};

/** An own property that is a string with something in it, or null. */
const textAt = (object: JsonObject | null, key: string): string | null => {
  const value = object ? ownValue(object, key) : undefined;
  return typeof value === "string" && value.trim() !== "" ? value : null;
};

/** Text as a JSON object, or null: bad JSON, and JSON that isn't an object, are no data. */
function parseObject(text: string | null | undefined): JsonObject | null {
  if (typeof text !== "string" || text === "") return null;
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

const tagsOf = (event: { tags: string[][] }): string[][] =>
  Array.isArray(event.tags) ? event.tags.filter(Array.isArray) : [];

/** The first value of the first tag of that name, or null. */
const tagText = (event: { tags: string[][] }, name: string): string | null => {
  const tag = tagsOf(event).find((t) => t[0] === name);
  return tag && typeof tag[1] === "string" ? tag[1] : null;
};

/** A header's `json` tag, parsed. */
const headerJson = (header: HeaderEvent): JsonObject | null => parseObject(tagText(header, "json"));

/**
 * An item's JSON documents, in the order they are read: the `json` tag, then
 * `content`. Lazy, so a reader that has what it wants never parses the rest.
 */
function* documentsOf(item: ItemEvent): Generator<JsonObject> {
  const fromTag = parseObject(tagText(item, "json"));
  if (fromTag) yield fromTag;
  const fromContent = parseObject(item.content);
  if (fromContent) yield fromContent;
}

/**
 * A header's names: its `names`, then its `name`, then what its `json` tag
 * says — `conceptHeader.oNames`, else `word.title`, else `word.name` — then
 * its `d`. The description is the `description` tag, else the json's
 * `conceptHeader.description`. Never capitalized: a name is the list's own.
 */
export function namesOf(header: HeaderEvent): { singular: string; plural: string; description: string | null } {
  const own = headerNames(header);
  // headerNames reads `names`, then `name`, then `d`; the json comes between `name` and `d`.
  const namesTag = tagsOf(header).find((t) => t[0] === "names");
  const declared = !!namesTag?.[1] || !!tagText(header, "name");

  const json = headerJson(header);
  const conceptHeader = objectAt(json, "conceptHeader");
  const word = objectAt(json, "word");
  const description = own.description ?? textAt(conceptHeader, "description");
  if (declared) return { ...own, description };

  const oNames = objectAt(conceptHeader, "oNames");
  const singularName = textAt(oNames, "singular");
  const pluralName = textAt(oNames, "plural");
  if (singularName || pluralName) {
    const singular = (singularName ?? pluralName) as string;
    return { singular, plural: pluralName ?? singular, description };
  }

  const title = textAt(word, "title") ?? textAt(word, "name");
  if (title) return { singular: title, plural: title, description };

  return { ...own, description };
}

/** The key a concept header says its items' JSON sits under: `conceptHeader.oKeys.singular`. */
export function jsonKeyOf(header: HeaderEvent): string | null {
  return textAt(objectAt(objectAt(headerJson(header), "conceptHeader"), "oKeys"), "singular");
}

/**
 * The object an item keeps under `key` in its JSON: the `json` tag first,
 * then `content`. A tag that is bad, or lacks the key, hands over to content.
 */
export function jsonDataOf(item: ItemEvent, key: string): JsonObject | null {
  for (const doc of documentsOf(item)) {
    const data = objectAt(doc, key);
    if (data) return data;
  }
  return null;
}

/**
 * How an item reads. `presentItem`'s answer, unless the definition declares
 * no fields and its header names a JSON key: then the item's title is the
 * JSON's `name`, `title`, `word.title`, `word.name`, else its `d`, and its
 * summary the JSON's `description` when it has one. Declared fields always
 * win. An item whose JSON can't be read has no title here; the caller's row
 * says "Untitled {singular}".
 */
export function presentCurateItem(item: ItemEvent, definition: ConceptDefinition): ItemPresentation {
  const base = presentItem(item, definition);
  if (definition.fields.length > 0) return base;
  const key = jsonKeyOf(definition.event);
  if (!key) return base;

  let data: JsonObject | null = null;
  let word: JsonObject | null = null;
  for (const doc of documentsOf(item)) {
    data ??= objectAt(doc, key);
    word ??= objectAt(doc, "word");
    if (data && word) break;
  }
  if (!data && !word) return base;

  const title =
    textAt(data, "name") ??
    textAt(data, "title") ??
    textAt(word, "title") ??
    textAt(word, "name") ??
    tagText(item, "d");
  return { ...base, title: title || null, summary: textAt(data, "description") ?? base.summary };
}
