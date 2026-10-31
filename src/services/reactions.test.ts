/**
 * Reactions to a list's items: read by `#e` and by `#a`, one per
 * person per item, their latest, counted only for people inside the
 * verified line. The reader's own vote is returned whether or not they
 * count. Ranks never leave this count.
 */
import type { NostrEvent } from "nostr-tools";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { beforeEach, describe, expect, it } from "vitest";
import { applyVote, voteTemplate } from "@/lib/curate/writeTemplates";
import { DEFAULT_RELAYS } from "@/lib/nostr/relays";
import { itemIdentity, type ItemEvent } from "@/services/concepts";
import { clearSeenOn } from "@/services/nostr";
import { DCOSL, INDEX } from "@/services/relays";
import { setTransport } from "@/services/transport";
import { inWebOfTrust, VERIFIED_RANK } from "@/services/trust";
import { useRelayStatus } from "@/stores/relay-status";
import { useSettings } from "@/stores/settings";
import { relayCorpus, type HeldRelay } from "@/test/relayCorpus";
import { loadReactions } from "./reactions";

const T = 1_792_000_000;
const LIST = `39998:${"b".repeat(64)}:food-and-drink-places`;
const OWNER = "a".repeat(64);

const actor = () => {
  const sk = generateSecretKey();
  return { sk, pk: getPublicKey(sk) };
};
type Actor = ReturnType<typeof actor>;

const ALICE = actor();
const BOB = actor();
const LOW = actor();
const STRANGER = actor();
/** Someone reading the list, whose rank is not held. */
const READER = actor();
const ranks = new Map([
  [ALICE.pk, 50],
  [BOB.pk, VERIFIED_RANK],
  [LOW.pk, VERIFIED_RANK - 1],
]);

let n = 0;
/** An item as a relay holds it. Reactions are read from the relays; the items are only named in them. */
const item = (tags: string[][], created_at = T, kind = 39999): ItemEvent => ({
  id: (++n).toString(16).padStart(64, "0"),
  pubkey: OWNER,
  kind,
  created_at,
  content: "",
  tags: [...tags, ["z", LIST]],
});
const coordinate = (ev: ItemEvent) => `${ev.kind}:${ev.pubkey}:${ev.tags.find((t) => t[0] === "d")![1]}`;

/** A reaction as Curate writes it (`voteTemplate`): the item's e and a, its author's p and its k, and no tag naming the list. */
const react = (who: Actor, to: ItemEvent, content: string, created_at = T + 1): NostrEvent =>
  finalizeEvent({ ...voteTemplate(to, "+"), created_at, content }, who.sk) as NostrEvent;

function hold(held: Record<string, HeldRelay>) {
  const corpus = relayCorpus(held);
  setTransport(corpus.transport);
  return corpus;
}

beforeEach(() => {
  clearSeenOn();
  useRelayStatus.getState().reset();
  useSettings.setState({ relays: [...DEFAULT_RELAYS] });
});

describe("loadReactions", () => {
  it("a reaction counted once per person, latest wins", async () => {
    const cafe = item([["d", "cafe"]]);
    hold({
      [DCOSL]: [
        react(ALICE, cafe, "+", T + 1),
        react(ALICE, cafe, "-", T + 2),
        react(BOB, cafe, "+", T + 3),
        react(BOB, cafe, "+", T + 4),
      ],
    });

    const counts = await loadReactions([cafe], ranks);

    expect(counts.get(itemIdentity(cafe))).toEqual({ up: 1, down: 1, mine: null });
  });

  it("reactions from outside the web of trust don't count", async () => {
    const cafe = item([["d", "cafe"]]);
    hold({
      [DCOSL]: [react(LOW, cafe, "+"), react(STRANGER, cafe, "+"), react(STRANGER, cafe, "-"), react(ALICE, cafe, "+")],
    });

    expect((await loadReactions([cafe], ranks)).get(itemIdentity(cafe))).toEqual({ up: 1, down: 0, mine: null });
    expect((await loadReactions([cafe], new Map())).get(itemIdentity(cafe))).toEqual({ up: 0, down: 0, mine: null });
  });

  it("a reaction by a, after an edit changed the item's id, still counts", async () => {
    const before = item([["d", "cafe"], ["name", "Cafe"]], T);
    const after = item([["d", "cafe"], ["name", "Cafe Luna"]], T + 100);
    // Alice reacted to the version before the edit: her e names an id the list no longer holds.
    hold({ [DCOSL]: [react(ALICE, before, "+", T + 50)] });

    const counts = await loadReactions([after], ranks);

    expect(counts.get(itemIdentity(after))).toEqual({ up: 1, down: 0, mine: null });
  });

  it("reaches an item without an address by its id", async () => {
    const song = item([], T, 9999);
    hold({ [DCOSL]: [react(ALICE, song, "+"), react(BOB, song, "-")] });

    expect((await loadReactions([song], ranks)).get(itemIdentity(song))).toEqual({ up: 1, down: 1, mine: null });
  });

  it("counts a reaction to a curation copy for its original", async () => {
    const original = `39999:${OWNER}:cafe`;
    const copy = item([["d", "copy-cafe"], ["q", original]]);
    const byOriginal = finalizeEvent(
      { kind: 7, created_at: T + 1, content: "+", tags: [["a", original]] },
      ALICE.sk,
    ) as NostrEvent;
    hold({ [DCOSL]: [byOriginal, react(BOB, copy, "+")] });

    const counts = await loadReactions([copy], ranks);

    expect(itemIdentity(copy)).toBe(original);
    expect(counts.get(original)).toEqual({ up: 2, down: 0, mine: null });
  });

  it("an emoji is no vote, and doesn't take one back; an empty reaction is a like", async () => {
    const cafe = item([["d", "cafe"]]);
    hold({ [DCOSL]: [react(ALICE, cafe, "-", T + 1), react(ALICE, cafe, "🔥", T + 2), react(BOB, cafe, "", T + 1)] });

    expect((await loadReactions([cafe], ranks)).get(itemIdentity(cafe))).toEqual({ up: 1, down: 1, mine: null });
  });

  it("reads by #e and #a from the list relays, a hundred at a time, and has a count for every item", async () => {
    const many = Array.from({ length: 150 }, (_, i) => item([["d", `place-${i}`]]));
    const { calls } = hold({ [DCOSL]: [react(ALICE, many[120], "+")], [INDEX]: [] });

    const counts = await loadReactions(many, ranks);

    expect(counts.size).toBe(150);
    expect(counts.get(itemIdentity(many[0]))).toEqual({ up: 0, down: 0, mine: null });
    expect(counts.get(itemIdentity(many[120]))).toEqual({ up: 1, down: 0, mine: null });
    expect(calls.map((c) => c.relay)).toEqual([DCOSL]);
    const filters = calls[0].filters;
    expect(filters.every((f) => f.kinds?.length === 1 && f.kinds[0] === 7)).toBe(true);
    const ids = filters.flatMap((f) => f["#e"] ?? []);
    const addresses = filters.flatMap((f) => f["#a"] ?? []);
    expect(new Set(ids)).toEqual(new Set(many.map((e) => e.id)));
    expect(new Set(addresses)).toEqual(new Set(many.map(coordinate)));
    expect(filters.every((f) => (f["#e"] ?? f["#a"] ?? []).length <= 100)).toBe(true);
  });

  it("asks for the ranks of reactors it doesn't hold, once each, and counts those inside", async () => {
    const cafe = item([["d", "cafe"]]);
    hold({
      [DCOSL]: [
        react(ALICE, cafe, "+", T + 1),
        react(STRANGER, cafe, "+", T + 1),
        react(STRANGER, cafe, "-", T + 2),
        react(LOW, cafe, "-", T + 1),
        // Not a vote, so nobody needs ranking for it.
        react(BOB, cafe, "🔥", T + 1),
      ],
    });
    const asked: string[][] = [];
    const rankMore = async (pubkeys: string[]) => {
      asked.push([...pubkeys].sort());
      return new Map([[STRANGER.pk, VERIFIED_RANK + 1]]);
    };

    // Only Alice is known; the stranger is asked for, and turns out to be inside.
    const counts = await loadReactions([cafe], new Map([[ALICE.pk, 50]]), rankMore);

    expect(counts.get(itemIdentity(cafe))).toEqual({ up: 1, down: 1, mine: null });
    expect(asked).toEqual([[LOW.pk, STRANGER.pk].sort()]);
  });

  it("counts with the ranks it holds when asking for more fails", async () => {
    const cafe = item([["d", "cafe"]]);
    hold({ [DCOSL]: [react(ALICE, cafe, "+"), react(STRANGER, cafe, "+")] });

    const counts = await loadReactions([cafe], ranks, async () => {
      throw new Error("the scorer's relay is down");
    });

    expect(counts.get(itemIdentity(cafe))).toEqual({ up: 1, down: 0, mine: null });
  });

  it("asks nothing for no items", async () => {
    const { calls } = hold({ [DCOSL]: [] });
    expect((await loadReactions([], ranks)).size).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe("the reader's own vote", () => {
  it("comes back for a reader outside the web of trust, while the counts stay as they were", async () => {
    const cafe = item([["d", "cafe"]]);
    hold({ [DCOSL]: [react(ALICE, cafe, "+"), react(READER, cafe, "-", T + 2)] });

    const counts = await loadReactions([cafe], ranks, undefined, READER.pk);

    expect(counts.get(itemIdentity(cafe))).toEqual({ up: 1, down: 0, mine: "-" });
  });

  it("comes back when the scorer is asked for the reader and doesn't rank them", async () => {
    const cafe = item([["d", "cafe"]]);
    hold({ [DCOSL]: [react(READER, cafe, "+")] });
    const asked: string[][] = [];

    const counts = await loadReactions([cafe], ranks, async (pubkeys) => {
      asked.push(pubkeys);
      return new Map();
    }, READER.pk);

    expect(counts.get(itemIdentity(cafe))).toEqual({ up: 0, down: 0, mine: "+" });
    expect(asked).toEqual([[READER.pk]]);
  });

  it("is the newest of the reader's votes, whatever order the relay sends them", async () => {
    const cafe = item([["d", "cafe"]]);
    hold({ [DCOSL]: [react(ALICE, cafe, "-", T + 3), react(ALICE, cafe, "+", T + 1), react(ALICE, cafe, "+", T + 2)] });

    const counts = await loadReactions([cafe], ranks, undefined, ALICE.pk);

    expect(counts.get(itemIdentity(cafe))).toEqual({ up: 0, down: 1, mine: "-" });
  });

  it("is null for an item the reader hasn't voted on, and for no reader", async () => {
    const cafe = item([["d", "cafe"]]);
    const bar = item([["d", "bar"]]);
    hold({ [DCOSL]: [react(ALICE, cafe, "+"), react(BOB, bar, "+")] });

    const asReader = await loadReactions([cafe, bar], ranks, undefined, ALICE.pk);
    const signedOut = await loadReactions([cafe, bar], ranks, undefined, null);

    expect(asReader.get(itemIdentity(cafe))?.mine).toBe("+");
    expect(asReader.get(itemIdentity(bar))?.mine).toBeNull();
    expect(signedOut.get(itemIdentity(cafe))).toEqual({ up: 1, down: 0, mine: null });
  });

  it("an emoji from the reader is no vote, and doesn't take theirs back", async () => {
    const cafe = item([["d", "cafe"]]);
    hold({ [DCOSL]: [react(READER, cafe, "-", T + 1), react(READER, cafe, "🔥", T + 2)] });

    const counts = await loadReactions([cafe], ranks, undefined, READER.pk);

    expect(counts.get(itemIdentity(cafe))?.mine).toBe("-");
  });

  it("a vote on a curation copy counts for the original, and is the reader's on that row", async () => {
    const original = `39999:${OWNER}:cafe`;
    const copy = item([["d", "copy-cafe"], ["q", original]]);
    hold({ [DCOSL]: [react(ALICE, copy, "+", T + 1), react(BOB, copy, "-", T + 2)] });

    const counts = await loadReactions([copy], ranks, undefined, ALICE.pk);

    expect(itemIdentity(copy)).toBe(original);
    expect(counts.get(original)).toEqual({ up: 1, down: 1, mine: "+" });
    expect(counts.has(`39999:${OWNER}:copy-cafe`)).toBe(false);
  });

  it("a vote on the original is the reader's on its copy's row", async () => {
    const original = `39999:${OWNER}:cafe`;
    const copy = item([["d", "copy-cafe"], ["q", original]]);
    const onOriginal = finalizeEvent(
      { kind: 7, created_at: T + 1, content: "-", tags: [["a", original]] },
      ALICE.sk,
    ) as NostrEvent;
    hold({ [DCOSL]: [onOriginal] });

    const counts = await loadReactions([copy], ranks, undefined, ALICE.pk);

    expect(counts.get(original)).toEqual({ up: 0, down: 1, mine: "-" });
  });

  it("a vote applied once the list relay has it is what a read finds after", async () => {
    const cafe = item([["d", "cafe"]]);
    const held = [react(ALICE, cafe, "+", T + 1), react(BOB, cafe, "+", T + 1), react(READER, cafe, "+", T + 1)];

    for (const reader of [ALICE, READER]) {
      hold({ [DCOSL]: held });
      const before = (await loadReactions([cafe], ranks, undefined, reader.pk)).get(itemIdentity(cafe))!;
      const applied = applyVote(before, "-", inWebOfTrust(ranks, reader.pk));

      hold({ [DCOSL]: [...held, react(reader, cafe, "-", T + 2)] });
      const after = (await loadReactions([cafe], ranks, undefined, reader.pk)).get(itemIdentity(cafe));

      expect(after).toEqual(applied);
    }
  });
});
