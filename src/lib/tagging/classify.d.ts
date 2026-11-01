import type { NostrEvent } from "nostr-tools";

/** What the classifier reads of a tagging: its id, who made it and when, and its tags. */
export type TaggingCandidate = Pick<NostrEvent, "id" | "pubkey" | "created_at" | "tags">;

/** What it reads of a tag's tagging header: who made it and its tags. */
export type TaggingHeader = Pick<NostrEvent, "pubkey" | "tags">;

/** A tag, by the author of its element and its slug. */
export interface TagRef {
  authorPubkey: string;
  slug: string;
}

export interface TaggingEntry {
  eventId: string;
  authorPubkey: string;
  createdAt: number;
  polarity: number;
}

export interface ClassifiedTag {
  tag: TagRef;
  applications: TaggingEntry[];
  disputes: TaggingEntry[];
}

/** A tagging whose header was not among those given, so it cannot be told to count. */
export interface UnverifiableTagging {
  eventId: string;
  authorPubkey: string;
  /** The coordinate of the header it names. */
  descriptor: string;
  createdAt: number;
}

/** The viewer's own latest stance on a tag, whether or not it counts. */
export interface OwnTagging {
  tag: TagRef;
  stance: "apply" | "dispute";
  eventId: string;
  createdAt: number;
}

/**
 * Groups the taggings of one event by tag. A tagging counts only when its
 * header is among `headers`, joins a namespace of `honoredAuthorities`, and its
 * author passes `isAsserterTrusted`; a tagging whose header is missing comes
 * back as unverifiable, and one whose header joins another namespace is left
 * out. `mine` carries the viewer's own taggings that pass the header checks,
 * trusted or not.
 */
export function classifyEventTaggings(args: {
  candidates: readonly TaggingCandidate[];
  headers: readonly TaggingHeader[];
  honoredAuthorities: readonly string[];
  isAsserterTrusted: (pubkey: string) => boolean;
  viewerPubkey?: string;
}): {
  tags: ClassifiedTag[];
  unverifiable: UnverifiableTagging[];
  mine: OwnTagging[];
};
