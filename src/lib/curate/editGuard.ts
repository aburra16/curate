/**
 * Edit guard: say whether the Edit forms can save a list or an item without
 * changing what the event says.
 *
 * Curate's forms rebuild an event from a lossy model. Saving a header drops the
 * tags Curate does not model (display hints, `b` pointers, `item-kind`, `titles`,
 * `recommended` becomes `allowed`); saving an item drops everything outside the
 * header's declared fields (extra `z`, `p`, `t`, `title`, repeated tags, `content`).
 * Until the forms are fixed, Edit is hidden wherever an unchanged save would
 * publish something different.
 *
 * Each guard runs the form's save on the values the form would be pre-filled
 * with, then compares: same kind, same `content`, same tags as a multiset
 * (each tag compared as JSON, so order does not matter). `created_at` is ignored.
 *
 * `headerFormSave` mirrors `EditHeaderForm`'s submit and `itemFormSave` mirrors
 * `EditItemForm`'s. They sit here, not in the forms, so the forms stay untouched
 * for now; change them together.
 */

import type { EventTemplate, NostrEvent } from "nostr-tools/pure";
import { buildListHeaderEvent, buildListItemEvent } from "@/lib/nostr/events";
import { parseListHeader, parseListItem } from "@/lib/nostr/parsers";
import { singularize } from "@/lib/nostr/pluralize";
import type { FieldSchema, ListHeader, ListItem } from "@/lib/nostr/types";

/** True only when saving the header form without editing it would publish the same event. */
export function headerEditIsLossless(header: NostrEvent): boolean {
  const parsed = parseListHeader(header);
  if (!parsed) return false;
  return sameEvent(header, headerFormSave(parsed));
}

/** True only when saving the item form without editing it, under this header, would publish the same event. */
export function itemEditIsLossless(item: NostrEvent, header: NostrEvent): boolean {
  const parsedHeader = parseListHeader(header);
  const parsedItem = parseListItem(item);
  if (!parsedHeader || !parsedItem) return false;
  return sameEvent(item, itemFormSave(parsedItem, parsedHeader));
}

/** What `EditHeaderForm` publishes when nothing is changed. */
function headerFormSave(header: ListHeader): EventTemplate {
  // The form starts from the header's fields, or from a lone required `name`
  // when it declares none, and offers only required or allowed.
  const draft =
    header.schema.length > 0
      ? header.schema.map((f) => ({
          name: f.name,
          type: f.type,
          presence: f.presence === "recommended" ? ("allowed" as const) : f.presence,
          description: f.description ?? "",
        }))
      : [{ name: "name", type: "text" as const, presence: "required" as const, description: "" }];

  const schema: FieldSchema[] = draft
    .filter((f) => f.name.trim())
    .map((f) => ({
      name: f.name.trim().toLowerCase().replace(/\s+/g, "-"),
      type: f.type,
      presence: f.presence,
      description: f.description.trim() || undefined,
    }));

  return buildListHeaderEvent({
    namePlural: header.namePlural.trim(),
    nameSingular: header.nameSingular.trim() || singularize(header.namePlural.trim()),
    description: (header.description ?? "").trim() || undefined,
    topics: header.topics.length > 0 ? header.topics : undefined,
    schema,
    dTag: header.dTag ?? undefined,
  });
}

/** What `EditItemForm` publishes when nothing is changed. */
function itemFormSave(item: ListItem, header: ListHeader): EventTemplate {
  // The form's inputs: one per declared field, plus `name`.
  const values: Record<string, string> = {};
  for (const f of header.schema) values[f.name] = item.fields[f.name] ?? "";
  if (header.schemaUnknown) values["name"] = item.name ?? "";
  else if (!values["name"] && item.name) values["name"] = item.name;

  const fields: Record<string, string> = {};
  let name: string | undefined;
  for (const [key, val] of Object.entries(values)) {
    if (!val.trim()) continue;
    if (key === "name") name = val.trim();
    else fields[key] = val.trim();
  }

  return buildListItemEvent({
    // Only the first parent survives.
    parentListUuid: item.parentListUuids[0] ?? header.uuid,
    fields,
    name,
    description: (item.description ?? "").trim() || undefined,
    dTag: item.dTag ?? undefined,
  });
}

function sameEvent(original: NostrEvent, saved: EventTemplate): boolean {
  if (original.kind !== saved.kind) return false;
  if (original.content !== saved.content) return false;
  const a = sortedTagJson(original.tags);
  const b = sortedTagJson(saved.tags);
  return a.length === b.length && a.every((tag, i) => tag === b[i]);
}

function sortedTagJson(tags: string[][]): string[] {
  return tags.map((tag) => JSON.stringify(tag)).sort();
}
