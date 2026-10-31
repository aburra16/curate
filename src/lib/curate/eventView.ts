/**
 * How the event panel reads an event, as plain data the panel
 * draws. Pure: nothing here reads a relay.
 *
 * - **`classifyTags`** sorts every tag of an event into what it is: a field
 *   the definition declares (labelled with the header's own description), a
 *   protocol tag, metadata, or undeclared. It also says where a value
 *   points. Only a few values point anywhere, and each by a strict rule: a
 *   `z` or `b` that parses as a coordinate (or a `z` that is an event id,
 *   the way a 9998 list is named) is a list; an `a` coordinate or a 64-hex
 *   `e` is an event; a 64-hex `p` is a profile; a declared field typed
 *   `url` is a link only when it is http(s). Nothing else is ever a link:
 *   not `javascript:`, not `data:`, not a bare-name `z` like `list`.
 * - **`eventIdentity`** names an event: its id, its coordinate when it is
 *   addressable, and an `naddr` (addressable) or `nevent` that carries the
 *   hub as its relay hint.
 * - **`jsonOf` / `prettyJson`** read the event's JSON the way jsonData does,
 *   the `json` tag first, then `content`. Only an object or an array counts
 *   as JSON worth printing; anything else (bad JSON, `42`, a sentence) is
 *   null and shown as the text it is. Nothing here throws.
 * - **`itemView`** is the Item tab: the definition's facts, every declared
 *   field through `fieldCell`, what the definition doesn't declare, and why
 *   there is nothing to show when the definition can't read the item.
 *
 * No rank, weight or score of a person appears in anything here.
 */
import { nip19 } from "nostr-tools";
import type { NostrEvent } from "nostr-tools/pure";
import type { ConceptDefinition } from "@/lib/conceptResolution";
import {
  coordinateOf,
  fieldCell,
  formatCoordinate,
  httpUrl,
  parseCoordinate,
  undeclaredFields,
  type FieldCell,
  type FieldDecl,
} from "@/lib/dlistFields";
import { DCOSL } from "@/services/relays";
import { jsonDataOf, jsonKeyOf, presentCurateItem } from "@/services/jsonData";

/** What the view reads of an event. A relay's event also carries its `sig`, which Raw shows. */
export type EventFields = Pick<NostrEvent, "id" | "pubkey" | "kind" | "created_at" | "content" | "tags">;

// -- tags --------------------------------------------------------------------

export type TagRole = "field" | "protocol" | "metadata" | "undeclared";

export interface TagTarget {
  /** `list`: a list's page. `event`: an event's panel. `profile`: a person. `url`: out of Curate. */
  kind: "list" | "event" | "profile" | "url";
  /** The coordinate, event id or pubkey (lower-case), or the http(s) URL. */
  value: string;
}

export interface TagRow {
  /** The tag as the event has it. */
  tag: string[];
  role: TagRole;
  /** A field's description, from the header; null for everything else. */
  label: string | null;
  /** Where the value points, or null. */
  target: TagTarget | null;
}

const PROTOCOL_TAGS = new Set(["d", "z", "b", "q", "e", "a", "p", "k", "n", "s", "o"]);
const METADATA_TAGS = new Set(["client", "alt", "expiration"]);
const HEX64 = /^[0-9a-f]{64}$/i;

/** The address a value is, spelled the way lists and items are filed under it, or null. */
function coordinateIn(value: string): string | null {
  const parsed = parseCoordinate(value);
  return parsed ? formatCoordinate(parsed) : null;
}

/** Where a tag's value points. Structure decides (`z`, `b`, `a`, `e`, `p`), then a declared field's type. */
function targetOf(name: string, value: string, decl: FieldDecl | undefined): TagTarget | null {
  const v = value.trim();
  switch (name) {
    case "z": {
      // A 9998 list is named by its header's event id.
      const list = coordinateIn(v) ?? (HEX64.test(v) ? v.toLowerCase() : null);
      return list ? { kind: "list", value: list } : null;
    }
    case "b": {
      const list = coordinateIn(v);
      return list ? { kind: "list", value: list } : null;
    }
    case "a": {
      const address = coordinateIn(v);
      return address ? { kind: "event", value: address } : null;
    }
    case "e":
      return HEX64.test(v) ? { kind: "event", value: v.toLowerCase() } : null;
    case "p":
      return HEX64.test(v) ? { kind: "profile", value: v.toLowerCase() } : null;
  }
  if (decl?.type === "url") {
    const url = httpUrl(value);
    return url ? { kind: "url", value: url } : null;
  }
  return null;
}

/**
 * Every tag of the event, in order, with what it is and where it points. A
 * tag the definition declares is a field, whatever its name; a definition of
 * null (no header found) declares nothing.
 */
export function classifyTags(event: EventFields, definition: ConceptDefinition | null): TagRow[] {
  const declared = new Map<string, FieldDecl>();
  for (const f of definition?.fields ?? []) if (!declared.has(f.name)) declared.set(f.name, f);

  const tags = Array.isArray(event.tags) ? event.tags.filter(Array.isArray) : [];
  return tags.map((tag): TagRow => {
    const name = typeof tag[0] === "string" ? tag[0] : "";
    const value = typeof tag[1] === "string" ? tag[1] : "";
    const decl = declared.get(name);
    const target = value ? targetOf(name, value, decl) : null;
    if (decl) return { tag, role: "field", label: decl.description, target };
    if (METADATA_TAGS.has(name)) return { tag, role: "metadata", label: null, target };
    if (PROTOCOL_TAGS.has(name)) return { tag, role: "protocol", label: null, target };
    return { tag, role: "undeclared", label: null, target };
  });
}

// -- identity ------------------------------------------------------------------

export interface EventIdentity {
  id: string;
  /** `kind:pubkey:d`, for an addressable event (kinds 30000 to 39999) that has a `d` tag. */
  coordinate: string | null;
  /** An `naddr` for an addressable event, else an `nevent`; either carries the hub as its relay hint. */
  bech32: string;
}

const isAddressable = (kind: number): boolean => kind >= 30000 && kind < 40000;

export function eventIdentity(event: EventFields): EventIdentity {
  const coordinate = isAddressable(event.kind) ? coordinateOf(event) : null;
  if (coordinate) {
    const d = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
    return {
      id: event.id,
      coordinate,
      bech32: nip19.naddrEncode({ identifier: d, pubkey: event.pubkey, kind: event.kind, relays: [DCOSL] }),
    };
  }
  return {
    id: event.id,
    coordinate: null,
    bech32: nip19.neventEncode({ id: event.id, author: event.pubkey, kind: event.kind, relays: [DCOSL] }),
  };
}

// -- JSON ----------------------------------------------------------------------

/** Text as pretty-printed JSON when it is an object or an array, else null. */
function prettyOf(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  // Most content is prose: don't parse what can't be an object or an array.
  const first = text.trimStart()[0];
  if (first !== "{" && first !== "[") return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? JSON.stringify(value, null, 2) : null;
  } catch {
    // Not JSON, or too deep to print.
    return null;
  }
}

/** The event's JSON, pretty-printed, and where it came from: the `json` tag first, then `content`. Null when neither is JSON. */
export function jsonOf(event: EventFields): { source: "json" | "content"; text: string } | null {
  const tag = Array.isArray(event.tags) ? event.tags.find((t) => Array.isArray(t) && t[0] === "json") : undefined;
  const fromTag = prettyOf(tag?.[1]);
  if (fromTag !== null) return { source: "json", text: fromTag };
  const fromContent = prettyOf(event.content);
  return fromContent === null ? null : { source: "content", text: fromContent };
}

export const prettyJson = (event: EventFields): string | null => jsonOf(event)?.text ?? null;

// -- the Item tab ----------------------------------------------------------------

export interface ItemView {
  /** Why the item can't be read through its list, or null when it can. */
  notice: string | null;
  /** The item's title, as its list reads it. */
  title: string | null;
  /** The definition's facts this item has a value for, labelled. */
  facts: { field: string; label: string; value: string; href: string | null; extra: number }[];
  /** Every field the definition declares, in its order, with what the item gives it. */
  fields: { decl: FieldDecl; cell: FieldCell }[];
  /** Tags the definition never declared. */
  more: { name: string; value: string }[];
}

const NO_VIEW: Omit<ItemView, "notice"> = { title: null, facts: [], fields: [], more: [] };

export function itemView(event: EventFields, definition: ConceptDefinition | null): ItemView {
  if (!definition) {
    return {
      ...NO_VIEW,
      notice:
        "This list’s header was not found, so Curate cannot tell which of this item’s tags are fields. Pretty and Raw show the event as it is.",
    };
  }
  const p = presentCurateItem(event, definition);
  // A list that declares no fields and keeps its items' data in JSON: the data is what the item says.
  const key = definition.fields.length === 0 ? jsonKeyOf(definition.event) : null;
  const unreadable = key !== null && jsonDataOf(event, key) === null;
  return {
    notice: unreadable
      ? "This list keeps its items’ data in JSON, and this item’s JSON could not be read. Pretty and Raw show the event as it is."
      : null,
    title: p.title,
    facts: p.facts.map(({ field, label, value, href, extra }) => ({ field, label, value, href, extra })),
    fields: definition.fields.map((decl) => ({ decl, cell: fieldCell(event, decl) })),
    more: undeclaredFields(event, definition.fields),
  };
}
