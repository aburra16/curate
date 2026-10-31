/**
 * URL templates, fetched by the event id a header's `link` pins
 * (lib/linkTemplates). Mirrors Brainstorm-UI's services/linkTemplates.ts
 * `fetchTemplates` at the pinned commit, reading dcosl and the tag hub, where
 * templates are filed. The header's own relay hint isn't followed: Curate
 * doesn't connect to relays named inside events.
 *
 * An id names one frozen event, so a template found is kept for the visit. A
 * template not found is asked for again next time: its relay may have been
 * down. A template that breaks lib/linkTemplates' rules (not a literal
 * `https://host/` start, anything past RFC 6570 level 1) is no link.
 */
import { templateOf, templatePlaceholders, type LinkRef, type UrlTemplate } from "@/lib/linkTemplates";
import { readRelays } from "@/services/nostr";
import { DCOSL, TAG_HUB } from "@/services/relays";

const byId = new Map<string, UrlTemplate>();

/** The templates these links pin, by id. Only well-formed templates are kept. */
export async function fetchTemplates(refs: LinkRef[]): Promise<Map<string, UrlTemplate>> {
  const missing = [...new Set(refs.map((r) => r.templateId))].filter((id) => !byId.has(id));
  if (missing.length) {
    const events = await readRelays([DCOSL, TAG_HUB], [{ ids: missing }]).catch(() => []);
    for (const ev of events) {
      const tpl = templateOf(ev);
      if (tpl && templatePlaceholders(tpl.template)) byId.set(ev.id, tpl);
    }
  }
  return new Map(refs.flatMap((r) => (byId.has(r.templateId) ? [[r.templateId, byId.get(r.templateId)!]] : [])));
}

/** Forget the templates found. Tests start each case from here. */
export function clearTemplateCache(): void {
  byId.clear();
}
