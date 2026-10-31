/**
 * What a list page's top says, as plain data the page draws.
 * Pure: the page reads the headers and the reader, and hands them here.
 *
 * - **A link names a list.** `c` is whatever the link carried: a coordinate,
 *   an `naddr` or a header's event id (`conceptRefOf`). It is found among the
 *   headers' concepts (`groupConcepts`), the same grouping Discover shows.
 * - **A copy's link opens its concept,** with that copy's author as the
 *   `version`: the page redirects, and the concept's page is the only place
 *   a list is read.
 * - **The governing version** is the reader's own copy, then their Assistant's,
 *   then the house's, then the community header (`resolveForReader`). A
 *   `version` (an author) overrides that: it is a reader choosing a version
 *   to read, and says so (`source: "version"`).
 * - **Names are not here.** The definition's `singular` and `plural` read
 *   tags only; the page names the list with `namesOf` on `definition.event`.
 * - **A root that can't be fetched** still makes a list from its copies
 *   (`headerMissing`). If none of them applies to this reader either, the
 *   newest copy is shown, as a version chosen for them, since the page would
 *   otherwise have nothing to say; the versions menu is how to read another.
 * - **A withdrawn header** that a link names opens as a list of its own: it
 *   is no copy of the concept it opted out of, but it is a list somebody
 *   linked to.
 */
import {
  definitionOf,
  differencesBetween,
  type Agreement,
  type ConceptDefinition,
  type DefinitionSource,
  type Difference,
  type HeaderEvent,
} from "@/lib/conceptResolution";
import { conceptHandles, conceptRefOf, groupConcepts, handleOf, type ConceptGroup } from "@/services/concepts";
import { copyBy, resolveForReader, type DictionaryReader } from "@/services/dictionary";

export type VersionLabel = "community" | "house" | "yours" | "assistant" | "copy";

export interface ListVersion {
  /** Whose version it is. The page's `?version=`. */
  author: string;
  /** The version's address (a 9998 copy: its event id). */
  coordinate: string;
  label: VersionLabel;
}

export interface ListModel {
  /** The community coordinate the copies point at (a 9998 header: its event id). */
  root: string;
  /** What items of this list are filed under: the root and every copy. */
  handles: string[];
  /** The definition the page shows. Its names come from `namesOf(definition.event)`. */
  definition: ConceptDefinition;
  /** Whose it is. "version" is a version a reader picked (or, with no root to compare, the newest copy). */
  source: DefinitionSource | "version";
  agreement: Agreement;
  /** What differs from the community header; empty when there's nothing to compare or nothing differs. */
  differences: Difference[];
  /** The community header, then each author's copy: yours, your Assistant's, the house's, others. */
  versions: ListVersion[];
  /** The community header couldn't be fetched. */
  headerMissing: boolean;
}

export interface ListModelInput {
  /** The page's `c`: a coordinate, an `naddr` or an event id. */
  c: string;
  headers: HeaderEvent[];
  reader: DictionaryReader;
  /** Whose copies are Brainstorm's own definitions (`houseCopyAuthors`). */
  houseAuthors: string[];
  /** An author whose version the reader chose to read, from `?version=`. */
  version: string | null;
}

/** Where a copy's link goes: its concept, with the copy's author as the version. */
export const listHref = (root: string, version?: string): string =>
  `/list?c=${encodeURIComponent(root)}${version ? `&version=${encodeURIComponent(version)}` : ""}`;

/** The address the page is at, without `edit`: the form it asked for has closed. */
export function withoutEdit(current: Iterable<[string, string]>): string {
  const next = new URLSearchParams();
  for (const [key, value] of current) if (key !== "edit") next.append(key, value);
  return `/list?${next}`;
}

/** The key of the list a link names: an address as written, an id as the header that has it is kept. */
function keyNamed(c: string, headers: HeaderEvent[]): string | null {
  const ref = conceptRefOf(c);
  if (!ref) return null;
  if ("coordinate" in ref) return ref.coordinate;
  const held = headers.find((h) => h.id === ref.id);
  return held ? handleOf(held) : ref.id;
}

const LABEL_ORDER: VersionLabel[] = ["community", "yours", "assistant", "house", "copy"];

function versionsOf(group: ConceptGroup, reader: DictionaryReader, houseAuthors: string[]): ListVersion[] {
  const labelOf = (author: string): VersionLabel =>
    author === reader.pubkey
      ? "yours"
      : author === reader.taPubkey
        ? "assistant"
        : houseAuthors.includes(author)
          ? "house"
          : "copy";
  const community: ListVersion[] = group.rootHeader
    ? [{ author: group.rootHeader.pubkey, coordinate: group.root, label: "community" }]
    : [];
  // One version per author, the one `copyBy` would pick: that is what `?version=<author>` selects.
  const copies = [...new Set(group.copies.map((h) => h.pubkey))]
    .map((author) => copyBy(author, group.root, group.copies))
    .filter((h): h is HeaderEvent => !!h)
    .map((h): ListVersion => ({ author: h.pubkey, coordinate: handleOf(h), label: labelOf(h.pubkey) }));
  // Array.sort is stable: within a label, copies stay newest first.
  return [...community, ...copies.sort((a, b) => LABEL_ORDER.indexOf(a.label) - LABEL_ORDER.indexOf(b.label))];
}

type Shown = Pick<ListModel, "definition" | "source" | "agreement" | "differences">;

const compared = (definition: ConceptDefinition, community: ConceptDefinition | null): Pick<Shown, "agreement" | "differences"> => {
  const differences = community ? differencesBetween(definition, community) : [];
  return { differences, agreement: !community ? "unknown" : differences.length ? "differs" : "agrees" };
};

/** What the page shows for this group: a chosen version, else what governs for the reader. Null when nothing can be shown. */
function shownFor(group: ConceptGroup, input: ListModelInput): Shown | null {
  const { reader, houseAuthors, version } = input;
  const community = group.rootHeader ? definitionOf(group.rootHeader) : null;

  if (version) {
    const picked = copyBy(version, group.root, group.copies);
    if (picked) return { definition: definitionOf(picked), source: "version", ...compared(definitionOf(picked), community) };
    // The community header's author picks the community's own, unless they also made a copy.
    if (community && group.rootHeader?.pubkey === version) {
      return { definition: community, source: "community", agreement: "no-local-copy", differences: [] };
    }
    // A version nobody made is nothing to choose: read what governs.
  }

  const resolved = resolveForReader(group, reader, houseAuthors);
  if (resolved) {
    return {
      definition: resolved.governing,
      source: resolved.source,
      agreement: resolved.agreement,
      differences: resolved.differences,
    };
  }

  // No copy applies and the community header wasn't fetched: the newest copy is all there is.
  const newest = group.copies[0];
  if (!newest) return null;
  return { definition: definitionOf(newest), source: "version", agreement: "unknown", differences: [] };
}

export function listModel(input: ListModelInput): ListModel | { redirect: string } | null {
  const key = keyNamed(input.c, input.headers);
  if (!key) return null;

  const { groups } = groupConcepts(input.headers);
  let group = groups.find((g) => g.root === key);
  if (!group) {
    const copy = groups.flatMap((g) => g.copies.map((h) => ({ g, h }))).find(({ h }) => handleOf(h) === key);
    if (copy) return { redirect: listHref(copy.g.root, copy.h.pubkey) };
    const withdrawn = groups.flatMap((g) => g.withdrawn).find((h) => handleOf(h) === key);
    if (!withdrawn) return null;
    group = { root: key, rootHeader: withdrawn, kind: "standalone", copies: [], withdrawn: [withdrawn] };
  }

  const shown = shownFor(group, input);
  if (!shown) return null;
  return {
    root: group.root,
    handles: conceptHandles(group),
    ...shown,
    versions: versionsOf(group, input.reader, input.houseAuthors),
    headerMissing: group.rootHeader === null,
  };
}
