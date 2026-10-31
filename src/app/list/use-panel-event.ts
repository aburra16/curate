"use client";

/**
 * Which event the event panel shows, from what the
 * page's query string asks for.
 *
 * - `?event=header` is the header the page shows (or, with none, nothing to
 *   open).
 * - `?item=<address or id>` is an item the page holds, if it holds it. A
 *   shared link rarely points into the first page of a list of thousands,
 *   and a link in the panel names events of any list, so an event that
 *   isn't held is read (`readListEvents`) once the first page is in. One
 *   that is filed under this list is an item of it; any other is a
 *   foreign event, which has no Item tab (the list's definition doesn't
 *   describe it).
 * - A link that names no event is `invalid`, and one nobody has is `missing`.
 *
 * The answer is kept with the question it answers, so a new link shows
 * nothing of an old answer, and nothing sets state while an effect runs.
 */
import { useEffect, useMemo, useState } from "react";
import type { NostrEvent } from "nostr-tools/pure";
import { filedItems, type ItemEvent } from "@/services/concepts";
import { shownItems } from "@/services/items";
import { readListEvents } from "@/services/listReads";
import { heldFor, panelFilter, panelKeyOf, panelRefOf } from "./panel-model";

export type PanelSubject =
  | { status: "closed" }
  | { status: "loading" }
  | { status: "invalid" }
  | { status: "missing" }
  | { status: "ready"; event: NostrEvent; role: "header" | "item" | "foreign" };

interface Input {
  /** `?item=`. */
  item: string | null;
  /** `?event=header`. */
  header: boolean;
  /** The header the page shows; null when none was found. */
  headerEvent: NostrEvent | null;
  /** What the list's items are filed under, and the extra kinds its header names. */
  handles: string[];
  itemKinds: number[];
  /** What the page holds of the list's items, and whether its first page is in. */
  held: ItemEvent[];
  firstLoaded: boolean;
}

/** The newer version of an address; a tie keeps the lower id (NIP-01). */
function newest(events: NostrEvent[]): NostrEvent | null {
  let best: NostrEvent | null = null;
  for (const ev of events) {
    if (!best || ev.created_at > best.created_at || (ev.created_at === best.created_at && ev.id < best.id)) best = ev;
  }
  return best;
}

export function usePanelEvent({ item, header, headerEvent, handles, itemKinds, held, firstLoaded }: Input): PanelSubject {
  const ref = useMemo(() => panelRefOf(item), [item]);
  const key = ref ? panelKeyOf(ref) : null;
  const inList = useMemo(() => (ref && !header ? heldFor(ref, shownItems(held)) : null), [ref, header, held]);
  // Read only once the page has had its chance to hold it.
  const reading = !header && ref !== null && inList === null && firstLoaded;

  const [fetched, setFetched] = useState<{ key: string; event: NostrEvent | null } | null>(null);
  useEffect(() => {
    if (!reading || !ref || key === null) return;
    let cancelled = false;
    readListEvents([panelFilter(ref)])
      .catch((): NostrEvent[] => [])
      .then((events) => {
        if (!cancelled) setFetched({ key, event: newest(events) });
      });
    return () => {
      cancelled = true;
    };
  }, [reading, ref, key]);

  const read = fetched && fetched.key === key ? fetched.event : undefined;
  const filedHere = useMemo(
    () => (read ? filedItems([read], handles, itemKinds).length > 0 : false),
    [read, handles, itemKinds],
  );

  if (header) return headerEvent ? { status: "ready", event: headerEvent, role: "header" } : { status: "missing" };
  if (!item) return { status: "closed" };
  if (!ref) return { status: "invalid" };
  // Held items come off a relay signed; ItemEvent only leaves out what the readers never use.
  if (inList) return { status: "ready", event: inList as NostrEvent, role: "item" };
  if (read === undefined) return { status: "loading" };
  if (read === null) return { status: "missing" };
  return { status: "ready", event: read, role: filedHere ? "item" : "foreign" };
}
