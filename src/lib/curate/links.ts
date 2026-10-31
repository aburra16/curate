/**
 * An item's links as a row and the item's own page both draw them: the item's
 * own link (a URL-typed field the definition shows as its link) first, then
 * the links its definition's URL templates build, each address once.
 */
import type { ItemLink } from "@/lib/linkTemplates";

export function distinctLinks(own: ItemLink | null, built: ItemLink[]): ItemLink[] {
  const all = own ? [own, ...built] : built;
  return all.filter((l, i) => all.findIndex((m) => m.href === l.href) === i);
}
