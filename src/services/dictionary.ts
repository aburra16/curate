/**
 * The Dictionary, every list's header, and whose copy of a concept governs
 * for a reader. Mirrors Brainstorm-UI's services/dictionary.ts (the house,
 * `copyBy`) and hooks/useDictionaryConcepts (who curates, what's in) at the
 * pinned commit; the decisions themselves are the vendored lib/ files'.
 *
 * - **The Dictionary** is decided by events, never by code: the house's
 *   taggings with the curator tag say who curates (`curatorsOf`), and the
 *   curators' self-pointing headers say what's in (`conceptsOf`). Concepts
 *   that play a role (URL Templates: links, not a list) are left out.
 * - **Every header** is every 39998 and 9998, and the 39999 and 9999 events
 *   that declare themselves headers (tapestry's dlist-header-declaration).
 * - **The governing version** is the reader's own copy, then their
 *   Assistant's, then the house's, then the community header
 *   (lib/conceptResolution `resolveConcept`), never by timestamp across
 *   authors. The house's copies are its own and its Assistant's.
 *
 * Every read goes to the index and the hub at once. Blank events are kept
 * here (services/listReads drops them): a header blanked since must reach
 * `groupConcepts`, which sets it apart, or its older version on a lagging
 * relay would come back as if nothing happened. A relay that fails or
 * refuses reads as empty; its outcome is in the relay-status store.
 */
import type { Filter, NostrEvent } from "nostr-tools";
import { URL_TEMPLATES_CONCEPT } from "@/config/dictionary";
import {
  pointsAt,
  resolveConcept,
  versionOf,
  type HeaderEvent,
  type ResolvedConcept,
} from "@/lib/conceptResolution";
import { conceptsOf, curatorsOf } from "@/lib/dictionaryConcepts";
import { coordinateOf, isDListHeader, parseCoordinate } from "@/lib/dlistFields";
import { conceptRefOf, type ConceptGroup } from "@/services/concepts";
import { readIndex, readRelays } from "@/services/nostr";
import { listRelays, TAG_HUB } from "@/services/relays";
import { resolveHouseObserver, resolveTrustSource } from "@/services/trust";

/** The tag the house applies to make someone a Dictionary curator, by its address (`#a` on a person tagging). */
export const CURATOR_TAG = "39999:2efaa715bbb46dd5be6b7da8d7700266d11674b913b8178addb5c2e63d987331:dictionary-concept-curator";

/** URL Templates: the concept whose items links are built from (lib/linkTemplates). */
export { URL_TEMPLATES_CONCEPT };

/** Concepts that play a role: their items render through them, but the Dictionary doesn't list them. */
export const ROLE_CONCEPTS: readonly string[] = [URL_TEMPLATES_CONCEPT];

/** Coordinates per `#z` filter: a filter of thousands of values is one no relay takes. */
const CHUNK = 100;

/** Who is reading: their pubkey, and the Assistant their 10040 names. Both null for a reader not signed in. */
export interface DictionaryReader {
  pubkey: string | null;
  taPubkey: string | null;
}

const chunks = <T>(values: T[], size = CHUNK): T[][] =>
  Array.from({ length: Math.ceil(values.length / size) }, (_, i) => values.slice(i * size, (i + 1) * size));

/**
 * The index and `relays` asked at once and merged by id, blank events kept.
 * Never rejects: a side that fails is an empty answer from that side.
 */
async function readWithIndex(relays: string[], filters: Filter[]): Promise<NostrEvent[]> {
  if (!filters.length) return [];
  const [indexed, hub] = await Promise.all([
    readIndex(filters).catch(() => [] as NostrEvent[]),
    readRelays(relays, filters).catch(() => [] as NostrEvent[]),
  ]);
  return [...new Map([...indexed, ...hub].map((ev) => [ev.id, ev])).values()];
}

const dOf = (ev: { tags: string[][] }) => ev.tags.find((t) => t[0] === "d")?.[1];

/**
 * Every list header, in two rounds. First every 39998 and 9998, and the 39999
 * and 9999 that say `["z","list"]`. Then the 39999 and 9999 whose `z` names a
 * `…:concept-header`: a relay can't filter on the end of a value, so they are
 * asked for by the coordinates of the 39998 concept-headers the first round
 * found. Only what `isDListHeader` accepts is kept; blank headers stay.
 */
export async function loadAllHeaders(): Promise<HeaderEvent[]> {
  const relays = listRelays();
  const first = await readWithIndex(relays, [
    { kinds: [39998, 9998] },
    { kinds: [39999, 9999], "#z": ["list"] },
  ]);
  const conceptHeaders = [
    ...new Set(
      first
        .filter((ev) => ev.kind === 39998 && dOf(ev) === "concept-header")
        .map((ev) => coordinateOf(ev))
        .filter((c): c is string => !!c),
    ),
  ];
  const second = await readWithIndex(
    relays,
    chunks(conceptHeaders).map((coordinates) => ({ kinds: [39999, 9999], "#z": coordinates })),
  );
  const byId = new Map([...first, ...second].map((ev) => [ev.id, ev]));
  return [...byId.values()].filter(isDListHeader);
}

/**
 * The 39998 headers `pubkey` has published to the list relays: the short names
 * they have taken, for a write that would land on one. Blank headers are kept
 * (as in `loadAllHeaders`), and only headers are returned. Never rejects: a
 * relay that fails is an empty answer from that relay, in the relay-status store.
 */
export async function loadOwnHeaders(pubkey: string): Promise<HeaderEvent[]> {
  const found = await readRelays(listRelays(), [{ kinds: [39998], authors: [pubkey] }]).catch(() => [] as NostrEvent[]);
  return found.filter(isDListHeader);
}

/** Every kind a header can be published as, 39999 and 9999 only when they declare themselves one. */
const HEADER_KINDS = [39998, 9998, 39999, 9999];

/**
 * The headers one list page needs, for whatever its link names (`c`): the
 * list's header and every header that points at it, so the page can group
 * them as Discover does without reading every list there is. Blank headers
 * are kept (as in `loadAllHeaders`), and only headers are returned.
 *
 * An address is one round: its header, and the copies naming it by `b`. An id
 * is read first; if it names an addressable header that isn't a copy, that
 * header's address is read next, since its copies name the address and the
 * address's current version is the list. A copy needs nothing more: it names
 * its concept, and the page sends the reader there.
 */
export async function loadConceptHeaders(c: string): Promise<HeaderEvent[]> {
  const ref = conceptRefOf(c);
  if (!ref) return [];
  const relays = listRelays();
  const read = async (filters: Filter[]) => (await readWithIndex(relays, filters)).filter(isDListHeader);
  const byAddress = (coordinate: string): Filter[] => {
    const { kind, pubkey, d } = parseCoordinate(coordinate)!;
    return [
      { kinds: [kind], authors: [pubkey], "#d": [d] },
      { kinds: HEADER_KINDS, "#b": [coordinate] },
    ];
  };

  if ("coordinate" in ref) return read(byAddress(ref.coordinate));

  const first = await read([{ ids: [ref.id] }, { kinds: HEADER_KINDS, "#b": [ref.id] }]);
  const named = first.find((ev) => ev.id === ref.id);
  const coordinate = named && coordinateOf(named);
  if (!named || !coordinate || versionOf(named)) return first;
  const second = await read(byAddress(coordinate));
  return [...new Map([...first, ...second].map((ev) => [ev.id, ev])).values()];
}

/**
 * The Dictionary's concepts, in its order (by name): the self-pointing
 * headers of the people the house tagged a curator, less the role concepts.
 * Read from the hub, the tag hub and the index. Empty when the house can't be
 * found: without it, nobody curates.
 */
export async function loadDictionaryConcepts(): Promise<string[]> {
  const house = await resolveHouseObserver().catch(() => null);
  if (!house) return [];
  const relays = [...listRelays(), TAG_HUB];
  const taggings = await readWithIndex(relays, [{ kinds: [39999], authors: [house], "#a": [CURATOR_TAG] }]);
  const curators = curatorsOf(taggings, { house, curatorTag: CURATOR_TAG });
  if (!curators.length) return [];
  const headers = await readWithIndex(relays, [{ kinds: [39998], authors: curators }]);
  return conceptsOf(headers, curators).filter((c) => !ROLE_CONCEPTS.includes(c));
}

/**
 * Whose copies are Brainstorm's own definitions: the house observer, then the
 * Assistant its kind 10040 names (its `30382:rank` provider), when that's
 * someone else. What a reader with no copy of their own sees, signed in or
 * not. Empty when the house can't be found: the community's definition governs.
 */
export async function houseCopyAuthors(): Promise<string[]> {
  const house = await resolveHouseObserver().catch(() => null);
  if (!house) return [];
  const assistant = (await resolveTrustSource(house).catch(() => null))?.taPubkey;
  return assistant && assistant !== house ? [house, assistant] : [house];
}

/**
 * One author's copy of a community concept: their header pointing at it,
 * preferring the one sharing its `d` (the convention a copy follows), else
 * the newest.
 */
export function copyBy(author: string | null, community: string, copies: HeaderEvent[]): HeaderEvent | null {
  if (!author) return null;
  const d = parseCoordinate(community)?.d;
  const mine = copies.filter((h) => h.pubkey === author && pointsAt(h, community));
  return (
    mine.find((h) => h.tags.some((t) => t[0] === "d" && t[1] === d)) ??
    mine.sort((a, b) => b.created_at - a.created_at)[0] ??
    null
  );
}

/**
 * The governing definition of a concept for this reader: their own copy,
 * then their Assistant's, then the house's (`houseAuthors`, from
 * `houseCopyAuthors`), then the community header. A withdrawn header is no
 * copy. Null when there is nothing to show: no copy applies and the
 * community header wasn't found.
 */
export function resolveForReader(
  group: ConceptGroup,
  reader: DictionaryReader,
  houseAuthors: string[],
): ResolvedConcept | null {
  const { root, rootHeader, copies } = group;
  return resolveConcept({
    community: rootHeader,
    communityCoordinate: root,
    personal: copyBy(reader.pubkey, root, copies),
    assistant: copyBy(reader.taPubkey, root, copies),
    house: houseAuthors.map((author) => copyBy(author, root, copies)).find(Boolean) ?? null,
  });
}
