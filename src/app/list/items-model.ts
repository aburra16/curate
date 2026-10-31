/**
 * What a list page's rows say, as plain data the
 * page draws. Pure: the page reads the items, ranks and settings, and hands
 * them here.
 *
 * - **Every row reads through the definition** (`presentCurateItem`): the
 *   title from the same field on every row, chosen per definition, never per
 *   item. An item missing it reads "Untitled {singular}", where the singular
 *   is the list's own name (`namesOf`); with no definition at all (a list
 *   opened from its items, its header not found) every row is "Untitled item".
 * - **Blank items never show.** The page holds what `mergePages` keeps, blank
 *   versions included, so a blank can shadow an older version of its item;
 *   they are left out here, as `shownItems` does.
 * - **Removed items stay out.** An item the reader deleted this session
 *   (`removed`: its identity and the second of the deletion) is left out
 *   with every version no newer than that second, whatever page or live
 *   event brought it in, so a lagging relay can't bring it back; a version
 *   made after the deletion shows again.
 * - **Search** reads what a row shows, its title and summary, words in any
 *   order, ignoring case and accents: lib/dictionaryItems' `filterItems`
 *   rule. That function reads `presentItem`, which can't see a title kept in
 *   JSON (a Tags item's name is in its `content`), so the rule is applied
 *   here to the row's own presentation, with the vendored `fold`.
 * - **Order:** newest, oldest, or A to Z by the shown title (`sortItems`'s
 *   comparison, on the same presentation, through one shared collator),
 *   untitled rows last. Items of one second are ordered by id, so rows don't
 *   swap as pages and relays answer.
 * - **Rows keep their identity:** a row is the same object while its item,
 *   definition and fold don't change, so a page that draws rows memoized
 *   draws again only those that did. A crowded second makes one page of
 *   thousands, and a search keystroke reads every one.
 * - **The web of trust:** an item is `outside` when the scorer answered for
 *   its author (`answered`: the read of their rank ended) and they rank
 *   below the line (`inWebOfTrust`). Outside rows fold into a count unless
 *   "Show everything" is on. An author the scorer hasn't answered for (still
 *   being asked, or their read failed) is unknown, so their items are shown
 *   and never folded; ranks unknown altogether (`null`) fold nothing. No rank
 *   is ever part of a row.
 */
import type { ConceptDefinition } from "@/lib/conceptResolution";
import { fold, type ItemOrder } from "@/lib/dictionaryItems";
import type { ItemPresentation } from "@/lib/itemPresentation";
import { itemIdentity, type ItemEvent } from "@/services/concepts";
import { shownItems } from "@/services/items";
import { namesOf, presentCurateItem } from "@/services/jsonData";
import { inWebOfTrust } from "@/services/trust";

export interface RowModel {
  /** What makes the item one item (`itemIdentity`): a row's key and the event panel's `?item=`. */
  identity: string;
  item: ItemEvent;
  p: ItemPresentation;
  /** Its author is outside the reader's web of trust (the scorer answered for them, and they're below the line). */
  outside: boolean;
  /** What the row's title says: the item's title, else "Untitled {singular}". */
  title: string;
}

export interface ItemsModelInput {
  /** What the page holds (`mergePages`), blank versions included. */
  items: ItemEvent[];
  /** The definition the page shows; null when no header was found. */
  definition: ConceptDefinition | null;
  /** The reader's scorer's ranks of the items' authors; null when nothing is known. */
  ranks: Map<string, number> | null;
  /** The authors the scorer answered for. Only their items can fold; anyone else's is unknown, and shown. */
  answered: ReadonlySet<string>;
  /** The items deleted this session, by identity: the second of the deletion. */
  removed: ReadonlyMap<string, number>;
  showEverything: boolean;
  query: string;
  order: ItemOrder;
}

export interface ItemsModel {
  /** The rows to draw, in order. */
  shown: RowModel[];
  /** How many rows fold into "{n} more from accounts outside your web of trust". */
  folded: number;
  /** Those rows, in order, for the fold to open in place. */
  foldedRows: RowModel[];
}

/** What a row says when there is no definition to read it by. */
const NO_PRESENTATION: ItemPresentation = {
  title: null,
  titleField: null,
  summary: null,
  summaryField: null,
  image: null,
  imageField: null,
  link: null,
  linkField: null,
  media: null,
  mediaField: null,
  location: null,
  locationField: null,
  facts: [],
  factFields: [],
  listImage: null,
};

/**
 * The kinds a header lists for its items beside 39999 and 9999 (its
 * `item-kind` tags), each once. A value that isn't a kind (not a whole
 * number from 0 to 65535) is left out.
 */
export function itemKindsOf(header: { tags: string[][] }): number[] {
  const kinds = header.tags
    .filter((t) => t[0] === "item-kind" && /^\d{1,5}$/.test(t[1] ?? ""))
    .map((t) => Number(t[1]))
    .filter((k) => k <= 65535);
  return [...new Set(kinds)];
}

/**
 * `items` without the removed ones: an item whose identity is in `removed`
 * stays out with every version made no later than the deletion's second; a
 * version made after it is kept.
 */
export function withoutRemoved<T extends ItemEvent>(items: T[], removed: ReadonlyMap<string, number>): T[] {
  if (!removed.size) return items;
  return items.filter((item) => {
    const at = removed.get(itemIdentity(item));
    return at === undefined || item.created_at > at;
  });
}

/** The name an item of this list goes by, singular; "item" when the list has none. */
export const singularOf = (definition: ConceptDefinition | null): string =>
  (definition && namesOf(definition.event).singular.trim()) || "item";

/** Where rows made with no definition are kept. */
const NO_DEFINITION = {};

/**
 * Rows already made, per definition and item. A search keystroke or a new
 * page asks again for the same rows; the events never change, so neither
 * does how they read, and a row is made anew only when its fold does.
 */
const made = new WeakMap<object, WeakMap<ItemEvent, RowModel>>();
/** What search reads of a row: its title and summary, folded once. */
const searchable = new WeakMap<ItemPresentation, string>();

function rowOf(item: ItemEvent, definition: ConceptDefinition | null, outside: boolean): RowModel {
  const scope = definition ?? NO_DEFINITION;
  let rows = made.get(scope);
  if (!rows) {
    rows = new WeakMap();
    made.set(scope, rows);
  }
  const kept = rows.get(item);
  if (kept && kept.outside === outside) return kept;
  const p = kept?.p ?? (definition ? presentCurateItem(item, definition) : NO_PRESENTATION);
  const row = { identity: itemIdentity(item), item, p, outside, title: p.title ?? `Untitled ${singularOf(definition)}` };
  rows.set(item, row);
  return row;
}

function searchTextOf(p: ItemPresentation): string {
  let text = searchable.get(p);
  if (text === undefined) {
    text = fold([p.title, p.summary].filter(Boolean).join(" "));
    searchable.set(p, text);
  }
  return text;
}

const newestFirst = (a: RowModel, b: RowModel) =>
  b.item.created_at - a.item.created_at || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0);

/** A to Z as `localeCompare(…, { sensitivity: "base" })` orders, without a locale lookup per comparison. */
const byTitle = new Intl.Collator(undefined, { sensitivity: "base" });

function ordered(rows: RowModel[], order: ItemOrder): RowModel[] {
  const sorted = [...rows];
  if (order === "oldest") return sorted.sort((a, b) => newestFirst(b, a));
  if (order === "name") {
    return sorted.sort((a, b) => {
      const at = a.p.title;
      const bt = b.p.title;
      if (!at || !bt) return at ? -1 : bt ? 1 : newestFirst(a, b);
      return byTitle.compare(at, bt) || newestFirst(a, b);
    });
  }
  return sorted.sort(newestFirst);
}

export function itemsModel(input: ItemsModelInput): ItemsModel {
  const { definition, ranks, answered, showEverything } = input;
  const words = fold(input.query).split(/\s+/).filter(Boolean);

  const rows: RowModel[] = [];
  for (const item of shownItems(withoutRemoved(input.items, input.removed))) {
    const outside = ranks !== null && answered.has(item.pubkey) && !inWebOfTrust(ranks, item.pubkey);
    const row = rowOf(item, definition, outside);
    if (words.length) {
      const text = searchTextOf(row.p);
      if (!words.every((w) => text.includes(w))) continue;
    }
    rows.push(row);
  }

  const sorted = ordered(rows, input.order);
  if (showEverything) return { shown: sorted, folded: 0, foldedRows: [] };
  const foldedRows = sorted.filter((r) => r.outside);
  return { shown: sorted.filter((r) => !r.outside), folded: foldedRows.length, foldedRows };
}
