/**
 * A list's header republished from the form: the draft's words and fields, and
 * every other tag the list had kept as it was.
 */
import type { CopyDraft, EventTemplate } from "@/lib/conceptCopy";
import type { ConceptDefinition } from "@/lib/conceptResolution";
import { listHeaderTemplate, pointsAtItself } from "@/lib/listDraft";

/**
 * The header of the list `def` describes, with `draft` as its definition. It
 * keeps the list's `d` and its author, every tag the form doesn't speak, and a
 * `b` pointing at itself only if the list had one, so saving a draft made
 * from the list (`listDraftOf`) without a change publishes the same tags.
 */
export function editedHeaderTemplate(def: ConceptDefinition, draft: CopyDraft): EventTemplate {
  return listHeaderTemplate(draft, {
    d: def.event.tags.find((t) => t[0] === "d")?.[1] ?? "",
    author: def.event.pubkey,
    previous: def.event,
    selfPointer: pointsAtItself(def.event),
  });
}
