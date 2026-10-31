/**
 * What the event panel is asked to show, from the page's query string
 *. Pure.
 *
 * The panel's state lives beside `c` in the URL, so it can be shared:
 * `&item=<identity>` for an item (or, from a link in the panel, any event:
 * its address or its id) and `&event=header` for the list's header. The
 * list's own parameters (`c`, `version`) are kept as they are.
 */
import type { Filter } from "nostr-tools";
import { coordinateOf, formatCoordinate, parseCoordinate } from "@/lib/dlistFields";
import { itemIdentity, type ItemEvent } from "@/services/concepts";

/** An event a link names: an address, or an event id. */
export type PanelRef = { coordinate: string } | { id: string };

const HEX64 = /^[0-9a-f]{64}$/i;

/** The event `?item=` names: `kind:pubkey:d` or a 64-hex id. Anything else names nothing. */
export function panelRefOf(item: string | null): PanelRef | null {
  const text = item?.trim() ?? "";
  if (HEX64.test(text)) return { id: text.toLowerCase() };
  const coordinate = parseCoordinate(text);
  return coordinate ? { coordinate: formatCoordinate(coordinate) } : null;
}

/** What the ref is kept under. */
export const panelKeyOf = (ref: PanelRef): string => ("id" in ref ? ref.id : ref.coordinate);

/** The filter that fetches the event a ref names. */
export function panelFilter(ref: PanelRef): Filter {
  if ("id" in ref) return { ids: [ref.id] };
  const { kind, pubkey, d } = parseCoordinate(ref.coordinate)!;
  return { kinds: [kind], authors: [pubkey], "#d": [d] };
}

/** Of the items the page holds, the one a ref names: by its id, its address, or the address a curation copy stands for. */
export function heldFor(ref: PanelRef, held: ItemEvent[]): ItemEvent | null {
  for (const ev of held) {
    if ("id" in ref) {
      if (ev.id === ref.id || itemIdentity(ev) === ref.id) return ev;
    } else if (coordinateOf(ev) === ref.coordinate || itemIdentity(ev) === ref.coordinate) {
      return ev;
    }
  }
  return null;
}

/**
 * The page's address with the panel set: an event (`item`), the header, or
 * neither. Whatever panel the current address had is replaced.
 */
export function panelHref(current: Iterable<[string, string]>, change: { item?: string | null; header?: boolean }): string {
  const next = new URLSearchParams();
  for (const [key, value] of current) if (key !== "item" && key !== "event") next.append(key, value);
  if (change.item) next.set("item", change.item);
  else if (change.header) next.set("event", "header");
  return `/list?${next}`;
}
