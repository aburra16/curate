/**
 * The typed surface over the tagging reads copied from Brainstorm-UI: the
 * filter that finds taggings of an event, the classifier that decides which of
 * them count, and the address of a tag. The events are built by hand; the
 * classifier reads their tags and never checks a signature.
 */
import { describe, expect, it } from "vitest";
import { HONORED_TAGGING_AUTHORITIES } from "@/config/tagging";
import { classifyEventTaggings } from "@/lib/tagging/classify";
import { filterTagsAppliedToEvent } from "@/lib/tagging/filters";
import { tagElementAddr } from "@/lib/tagging/handles";

const hex = (digit: string) => digit.repeat(64);

const HONOURED_AUTHORITY = HONORED_TAGGING_AUTHORITIES[0];
const OTHER_AUTHORITY = hex("c");
const TAG_AUTHOR = hex("a");
const TAGGER = hex("b");
const OTHER_TAGGER = hex("d");
const HEADER_AUTHOR = hex("e");
const ITEM_ADDRESS = `39999:${hex("f")}:some-item`;
const SLUG = "worth-a-read";

const descriptor = (slug: string) => `39999:${HEADER_AUTHOR}:tagging:${slug}-tagging`;

/** The per-tag header: it joins a namespace and names the tag it is for. */
const header = (slug: string, authority: string) => ({
  pubkey: HEADER_AUTHOR,
  tags: [
    ["d", `tagging:${slug}-tagging`],
    ["z", `39998:${authority}:tagging-with-specific-tag`],
    ["a", tagElementAddr(TAG_AUTHOR, slug)],
  ],
});

/** A tagging of the item, pointing at its header through the descriptor. */
const tagging = (id: string, pubkey: string, slug: string, extra: string[][] = []) => ({
  id,
  pubkey,
  created_at: 1_792_000_000,
  tags: [["a", ITEM_ADDRESS], ["z", descriptor(slug)], ...extra],
});

describe("filterTagsAppliedToEvent", () => {
  it("finds the taggings of an addressable event by its address", () => {
    expect(filterTagsAppliedToEvent({ target: { address: ITEM_ADDRESS } })).toEqual({
      kinds: [39999],
      "#a": [ITEM_ADDRESS],
    });
  });

  it("finds the taggings of any other event by its id", () => {
    expect(filterTagsAppliedToEvent({ target: { id: hex("1") } })).toEqual({
      kinds: [39999],
      "#e": [hex("1")],
    });
  });

  it("refuses a target that is neither", () => {
    // @ts-expect-error a target is an id or an address
    expect(() => filterTagsAppliedToEvent({ target: {} })).toThrow();
  });
});

describe("tagElementAddr", () => {
  it("is the tag element's coordinate", () => {
    expect(tagElementAddr(TAG_AUTHOR, SLUG)).toBe(`39999:${TAG_AUTHOR}:${SLUG}`);
  });
});

describe("classifyEventTaggings", () => {
  const trustAll = () => true;

  it("counts a tagging whose header joins an honoured namespace", () => {
    const result = classifyEventTaggings({
      candidates: [tagging("t1", TAGGER, SLUG)],
      headers: [header(SLUG, HONOURED_AUTHORITY)],
      honoredAuthorities: HONORED_TAGGING_AUTHORITIES,
      isAsserterTrusted: trustAll,
    });
    expect(result.tags).toEqual([
      {
        tag: { authorPubkey: TAG_AUTHOR, slug: SLUG },
        applications: [{ eventId: "t1", authorPubkey: TAGGER, createdAt: 1_792_000_000, polarity: 1 }],
        disputes: [],
      },
    ]);
    expect(result.unverifiable).toEqual([]);
  });

  it("ignores a tagging whose header joins a namespace nobody honours", () => {
    const result = classifyEventTaggings({
      candidates: [tagging("t1", TAGGER, SLUG)],
      headers: [header(SLUG, OTHER_AUTHORITY)],
      honoredAuthorities: HONORED_TAGGING_AUTHORITIES,
      isAsserterTrusted: trustAll,
    });
    expect(result.tags).toEqual([]);
    expect(result.unverifiable).toEqual([]);
  });

  it("keeps a tagging whose header is missing apart, as one it cannot verify", () => {
    const result = classifyEventTaggings({
      candidates: [tagging("t1", TAGGER, SLUG)],
      headers: [],
      honoredAuthorities: HONORED_TAGGING_AUTHORITIES,
      isAsserterTrusted: trustAll,
    });
    expect(result.tags).toEqual([]);
    expect(result.unverifiable).toEqual([
      { eventId: "t1", authorPubkey: TAGGER, createdAt: 1_792_000_000, descriptor: descriptor(SLUG) },
    ]);
  });

  it("counts a negative polarity as a dispute and leaves out people the predicate refuses", () => {
    const result = classifyEventTaggings({
      candidates: [
        tagging("t1", TAGGER, SLUG, [["polarity", "-1"]]),
        tagging("t2", OTHER_TAGGER, SLUG),
      ],
      headers: [header(SLUG, HONOURED_AUTHORITY)],
      honoredAuthorities: HONORED_TAGGING_AUTHORITIES,
      isAsserterTrusted: (pubkey) => pubkey === TAGGER,
      viewerPubkey: OTHER_TAGGER,
    });
    expect(result.tags).toHaveLength(1);
    expect(result.tags[0].applications).toEqual([]);
    expect(result.tags[0].disputes.map((d) => d.eventId)).toEqual(["t1"]);
    expect(result.mine).toEqual([
      { tag: { authorPubkey: TAG_AUTHOR, slug: SLUG }, stance: "apply", eventId: "t2", createdAt: 1_792_000_000 },
    ]);
  });
});
