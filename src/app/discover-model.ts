/**
 * What Discover shows, as plain data the page draws. Pure: the
 * page reads the relays and resolves each concept for the reader, then hands
 * the results here.
 *
 * - **One card per concept.** Copies fold under their concept: they are
 *   listed on its card only with "Show everything" (`copies`), and the card
 *   says "N versions" (`versions`: the concept's header and its real copies;
 *   a withdrawn header is not a version).
 * - **The Dictionary comes first,** in its own order, and its concepts are
 *   not listed again under "All lists".
 * - **Withdrawn and blank** are shown only with "Show everything", each
 *   labelled. A withdrawn header that fits no concept is a card of its own
 *   (a group whose root is its own withdrawal); one inside a concept is
 *   listed under it; a blank header, set apart by `groupConcepts`, is a card
 *   of its own.
 * - **Names come from the governing definition,** through `namesOf` (the
 *   vendored definition reads tags only, so a header named only in its JSON
 *   would read as its `d`). They are never capitalized: a name is the
 *   list's own.
 * - **A header that names nothing** (no names, name, `d` or JSON title: other
 *   apps keep their own records in kind 9998) is not a list a reader can
 *   tell from another. It is hidden until "Show everything", then called
 *   "Untitled list".
 * - **Search** matches names and description, any order, accents and case
 *   folded, the way a list's items are searched.
 */
import { parseDisplayHints } from "@/lib/displayHints";
import type { HeaderEvent, ResolvedConcept } from "@/lib/conceptResolution";
import { fold } from "@/lib/dictionaryItems";
import { parseCoordinate } from "@/lib/dlistFields";
import { handleOf, type ConceptGroup } from "@/services/concepts";
import { namesOf } from "@/services/jsonData";

export interface CardModel {
  /** The address the card opens: the concept's root, or a copy's own. A 9998 header's is its event id. */
  root: string;
  /** The governing version's plural name, as written. */
  plural: string;
  description: string | null;
  /** The list's own image, an http(s) URL, or null. */
  image: string | null;
  /** The public key that made the concept (a copy: whoever made the copy). */
  author: string | null;
  /** The concept's header and its copies. 1 for a copy, a blank header and a withdrawn one. */
  versions: number;
  label: "withdrawn" | "blank" | null;
  /** The concept's other headers, only with "Show everything": its copies, then any withdrawn. */
  copies: CardModel[];
}

export interface DiscoverInput {
  groups: ConceptGroup[];
  /** Headers set apart as blank (`groupConcepts`). */
  blank: HeaderEvent[];
  /** The Dictionary's concepts, by root, in its order. */
  dictionary: string[];
  /** Each group's governing definition for this reader, by `root`; null when nothing governs. */
  resolved: Map<string, ResolvedConcept | null>;
  query: string;
  showEverything: boolean;
}

/** What a card says when nothing could be fetched to say what the concept is. */
export const HEADER_NOT_FOUND = "header not found";

/** What a list that names nothing is called. */
export const UNTITLED_LIST = "Untitled list";

interface Entry {
  card: CardModel;
  /** What a search reads, folded. */
  text: string;
}

const listImageOf = (h: HeaderEvent): string | null => parseDisplayHints(h, []).listImage;

/** A header as a card of its own: a copy, a withdrawn header, a blank one. */
function headerEntry(h: HeaderEvent, label: CardModel["label"]): Entry {
  const { singular, plural, description } = namesOf(h);
  return {
    card: {
      root: handleOf(h),
      plural: plural || UNTITLED_LIST,
      description,
      image: listImageOf(h),
      author: h.pubkey,
      versions: 1,
      label,
      copies: [],
    },
    text: fold([singular, plural || UNTITLED_LIST, description].filter(Boolean).join(" ")),
  };
}

/**
 * A withdrawn header that fits no concept: a group of its own, `standalone`,
 * whose root header is its one withdrawn header. Hidden unless everything is
 * shown.
 */
const isLoner = (g: ConceptGroup): boolean =>
  g.kind === "standalone" && g.rootHeader !== null && g.rootHeader === g.withdrawn[0];

function groupEntry(g: ConceptGroup, resolved: ResolvedConcept | null, showEverything: boolean): Entry | null {
  const loner = isLoner(g);
  if (loner && !showEverything) return null;

  const author = g.rootHeader?.pubkey ?? parseCoordinate(g.root)?.pubkey ?? null;
  const versions = g.copies.length + 1;
  const label = loner ? "withdrawn" : null;
  const copies = showEverything
    ? [
        ...g.copies.map((h) => headerEntry(h, null).card),
        // The root's own withdrawal, when it is the root (a loner), is the card itself.
        ...g.withdrawn.filter((h) => h !== g.rootHeader).map((h) => headerEntry(h, "withdrawn").card),
      ]
    : [];

  if (resolved) {
    const governing = resolved.governing.event;
    const { singular, plural, description } = namesOf(governing);
    // Nothing to call it by: not worth a card until everything is shown.
    if (!plural && !showEverything) return null;
    const name = plural || UNTITLED_LIST;
    return {
      card: { root: g.root, plural: name, description, image: listImageOf(governing), author, versions, label, copies },
      text: fold([singular, name, description].filter(Boolean).join(" ")),
    };
  }

  // Nothing governs: no copy of the reader's, the Assistant's or the house's applies, and the concept's own
  // header wasn't fetched. Name it by a copy if there is one, else its d, and say the header is missing.
  const named = g.copies[0] ? namesOf(g.copies[0]) : null;
  const plural = named?.plural || parseCoordinate(g.root)?.d || g.root;
  return {
    card: { root: g.root, plural, description: HEADER_NOT_FOUND, image: null, author, versions, label, copies },
    text: fold([named?.singular, plural, HEADER_NOT_FOUND].filter(Boolean).join(" ")),
  };
}

export function discoverModel(input: DiscoverInput): { dictionary: CardModel[]; all: CardModel[] } {
  const { groups, blank, dictionary, resolved, showEverything } = input;
  const words = fold(input.query).split(/\s+/).filter(Boolean);
  const matches = ({ text }: Entry) => words.every((w) => text.includes(w));

  const entries = new Map<string, Entry>();
  for (const g of groups) {
    const entry = groupEntry(g, resolved.get(g.root) ?? null, showEverything);
    if (entry) entries.set(g.root, entry);
  }

  const inDictionary = new Set(dictionary);
  const listed = (roots: Iterable<string>) =>
    [...roots]
      .map((root) => entries.get(root))
      .filter((entry): entry is Entry => !!entry && matches(entry))
      .map((entry) => entry.card);

  const blanks = showEverything ? blank.map((h) => headerEntry(h, "blank")) : [];
  return {
    dictionary: listed(new Set(dictionary)),
    all: [
      ...listed([...entries.keys()].filter((root) => !inDictionary.has(root))),
      ...blanks.filter(matches).map((entry) => entry.card),
    ],
  };
}
