import type { Filter } from "nostr-tools";

/** What a tagging points at: an event by its id, or an addressable event by its coordinate. */
export type TaggingTarget =
  | { id: string; address?: never }
  | { address: string; id?: never };

/**
 * The filter for kind-39999 events that point at a target (`#e` for an id, `#a`
 * for a coordinate). What it finds are candidates; whether each counts is for
 * `classifyEventTaggings` to say. Throws when the target is neither.
 */
export function filterTagsAppliedToEvent(args: { target: TaggingTarget }): Filter;
