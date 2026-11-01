/**
 * What a reader can do to the list a page shows, and what each choice
 * publishes. Pure: the page hands in the concept's headers as it grouped them.
 *
 * - **Edit list** changes a header the reader wrote: their own list, or their
 *   own version of someone else's.
 * - **Make my own version** copies someone else's header into one of the
 *   reader's own; saved untouched it is that header's exact copy.
 * - **Edit my version** changes the reader's copy while another version is shown.
 * - **Withdraw my version** retires the reader's copy (lib/conceptCopy
 *   `withdrawnTemplate`).
 *
 * A withdrawn header is never edited: saving one unchanged would give it
 * names it never had, and it stands for a decision, not for a list to keep up.
 * "Withdrawn" is as grouping reads it (services/concepts `isWithdrawn`): it
 * carries `["b", "b-tag-deferred"]` and points at no concept. A header that
 * carries the mark and also a pointer is still a version of that concept.
 */
import { draftProblems, exactCopyTemplate, type CopyDraft, type EventTemplate } from "@/lib/conceptCopy";
import { definitionOf, versionOf, type HeaderEvent } from "@/lib/conceptResolution";
import { editedHeaderTemplate } from "@/lib/curate/headerEdit";
import { freeShortName, hasNoFields, NO_FIELDS, ownShortNames } from "@/lib/curate/newList";
import { checkHeader, type Problem } from "@/lib/listCheck";
import { listDraftOf, listHeaderTemplate } from "@/lib/listDraft";
import { newestPerAddress } from "@/lib/newestPerAddress";
import { handleOf, isWithdrawn, type ConceptGroup } from "@/services/concepts";
import { copyBy } from "@/services/dictionary";

/** A change the reader can make to the list shown. */
export type ListEdit =
  /** "Edit list": the reader's own header or own copy. */
  | { kind: "edit"; header: HeaderEvent }
  /** "Edit my version": the reader's copy, while another version is shown. */
  | { kind: "edit-mine"; copy: HeaderEvent }
  /** "Make my own version": a copy of someone else's header. */
  | { kind: "make-mine"; community: HeaderEvent };

/** A header's short name (`d`); empty when it has none. */
export const shortNameOf = (header: HeaderEvent): string => header.tags.find((t) => t[0] === "d")?.[1] ?? "";

/** A header an edit can replace: a list at an address of its author's own, which only a 39998 is. */
const replaceable = (header: HeaderEvent): boolean => header.kind === 39998;

/**
 * What `reader` can do to `shown`, a header of `group`.
 *
 * - Signed out, nothing.
 * - The header the reader wrote is theirs to edit.
 * - Otherwise their own copy of the concept is, when they have one.
 * - Otherwise the community header is the reader's to edit, if they wrote it
 *   (a copy of one's own list would be published over it), or to copy.
 * - Withdrawing is the reader's copy, never the community header and never one
 *   that is withdrawn already.
 * - A withdrawn header that is shown is neither edited nor withdrawn; the
 *   reader may make a version of the community header, if it can be copied.
 */
export function listActionsFor(
  reader: string | null,
  group: ConceptGroup,
  shown: HeaderEvent,
): { edit: ListEdit | null; withdraw: HeaderEvent | null } {
  if (!reader) return { edit: null, withdraw: null };

  const mine = copyBy(reader, group.root, group.copies);
  const { rootHeader } = group;
  const community = rootHeader && !isWithdrawn(rootHeader) ? rootHeader : null;

  if (isWithdrawn(shown)) {
    const copyable = !mine && community && community.pubkey !== reader && shortNameOf(community) !== "";
    return { edit: copyable ? { kind: "make-mine", community } : null, withdraw: null };
  }

  const withdraw = mine && handleOf(mine) !== group.root && !isWithdrawn(mine) ? mine : null;
  if (shown.pubkey === reader) {
    return { edit: replaceable(shown) ? { kind: "edit", header: shown } : null, withdraw };
  }
  if (mine) return { edit: replaceable(mine) ? { kind: "edit-mine", copy: mine } : null, withdraw };
  if (!community) return { edit: null, withdraw };
  if (community.pubkey === reader) {
    return { edit: replaceable(community) ? { kind: "edit", header: community } : null, withdraw };
  }
  return { edit: shortNameOf(community) !== "" ? { kind: "make-mine", community } : null, withdraw };
}

/** The header the edit starts from: the one to change, or the one to copy. */
export const listEditHeader = (edit: ListEdit): HeaderEvent =>
  edit.kind === "edit" ? edit.header : edit.kind === "edit-mine" ? edit.copy : edit.community;

/** The draft the form opens with: the header being changed, or copied, as it stands. */
export function listEditDraft(edit: ListEdit): CopyDraft {
  return listDraftOf(definitionOf(listEditHeader(edit)));
}

/**
 * The short name a version made of `community` is published at, by `reader`.
 * It is the community header's own, as an exact copy has, unless a list of the
 * reader's already goes by that name: publishing there would replace that
 * list, and its items would belong to the version. Then it is the first of
 * `<name>-2`, `<name>-3`, ... they have not taken; a copy is found by its
 * pointer, so a name of its own does it no harm. A header of theirs that is
 * withdrawn, or is a version of this concept already, is replaced on purpose
 * and does not count. `own` is the reader's list headers as read (`loadOwnHeaders`'s `headers`).
 */
export function versionShortName(community: HeaderEvent, reader: string, own: HeaderEvent[]): string {
  const concept = handleOf(community);
  const kept = newestPerAddress(own).filter((header) => !isWithdrawn(header) && versionOf(header) !== concept);
  return freeShortName(shortNameOf(community), ownShortNames(kept, reader));
}

/**
 * The header `draft` publishes for `edit`, signed by `reader`. A change keeps
 * the header's `d`, its author and every tag the form doesn't speak
 * (`editedHeaderTemplate`). A version made takes the tags an exact copy takes,
 * pointing back at the community header, at `shortName` (`versionShortName`;
 * the community header's own `d` when not given), so saving the draft the form
 * opened with publishes `exactCopyTemplate`'s tags.
 */
export function listEditTemplate(edit: ListEdit, reader: string, draft: CopyDraft, shortName?: string): EventTemplate {
  if (edit.kind === "edit") return editedHeaderTemplate(definitionOf(edit.header), draft);
  if (edit.kind === "edit-mine") return editedHeaderTemplate(definitionOf(edit.copy), draft);
  const d = shortName ?? shortNameOf(edit.community);
  const exact = exactCopyTemplate(definitionOf(edit.community));
  const previous = { ...exact, tags: exact.tags.map((tag) => (tag[0] === "d" ? ["d", d] : tag)) };
  return listHeaderTemplate(draft, { d, author: reader, previous });
}

/**
 * What Brainstorm's checks find in the header `draft` would publish. The
 * draft's own problems come first, as problems that stop the write: the
 * header check reads the names and fields back from tags, where a name left
 * empty can pass for another. So does taking away every field the list had,
 * which would leave it with nothing to add; a list that never declared one
 * is saved as it stands. The rest of what the header check notes follows.
 */
export function listEditProblems(edit: ListEdit, reader: string, draft: CopyDraft, shortName?: string): Problem[] {
  const emptied = hasNoFields(draft) && !hasNoFields(listEditDraft(edit));
  const own = [...draftProblems(draft), ...(emptied ? [NO_FIELDS] : [])];
  return [
    ...own.map((message): Problem => ({ code: "unpublishable", field: null, message, blocking: true })),
    ...checkHeader(listEditTemplate(edit, reader, draft, shortName).tags).problems.filter(
      (problem) => !own.includes(problem.message),
    ),
  ];
}
