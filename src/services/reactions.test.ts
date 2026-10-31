/**
 * Reactions to a list's items: read by `#e` and by `#a`, one per
 * person per item, their latest, counted only for people inside the
 * verified line. Ranks never leave this count.
 */
import type { NostrEvent } from "nostr-tools";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RELAYS } from "@/lib/nostr/relays";
import { itemIdentity, type ItemEvent } from "@/services/concepts";
import { clearSeenOn } from "@/services/nostr";
import { DCOSL, INDEX } from "@/services/relays";
import { setTransport } from "@/services/transport";
import { VERIFIED_RANK } from "@/services/trust";
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

/** A reaction as Curate writes it (lib/nostr/events `buildReactionEvent`): e, p, a, k, then the list's a. */
const react = (who: Actor, to: ItemEvent, content: string, created_at = T + 1, viaId = to.id): NostrEvent =>
  finalizeEvent(
    {
      kind: 7,
      created_at,
      content,
      tags: [
        ["e", viaId],
        ["p", to.pubkey],
        ...(to.tags.some((t) => t[0] === "d") ? [["a", coordinate(to)]] : []),
        ["k", String(to.kind)],
        ["a", LIST],
      ],
    },
    who.sk,
  ) as NostrEvent;

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

    expect(counts.get(itemIdentity(cafe))).toEqual({ up: 1, down: 1 });
  });

  it("reactions from outside the web of trust don't count", async () => {
    const cafe = item([["d", "cafe"]]);
    hold({
      [DCOSL]: [react(LOW, cafe, "+"), react(STRANGER, cafe, "+"), react(STRANGER, cafe, "-"), react(ALICE, cafe, "+")],
    });

    expect((await loadReactions([cafe], ranks)).get(itemIdentity(cafe))).toEqual({ up: 1, down: 0 });
    expect((await loadReactions([cafe], new Map())).get(itemIdentity(cafe))).toEqual({ up: 0, down: 0 });
  });

  it("a reaction by a, after an edit changed the item's id, still counts", async () => {
    const before = item([["d", "cafe"], ["name", "Cafe"]], T);
    const after = item([["d", "cafe"], ["name", "Cafe Luna"]], T + 100);
    // Alice reacted to the version before the edit: her e names an id the list no longer holds.
    hold({ [DCOSL]: [react(ALICE, before, "+", T + 50)] });

    const counts = await loadReactions([after], ranks);

    expect(counts.get(itemIdentity(after))).toEqual({ up: 1, down: 0 });
  });

  it("reaches an item without an address by its id", async () => {
    const song = item([], T, 9999);
    hold({ [DCOSL]: [react(ALICE, song, "+"), react(BOB, song, "-")] });

    expect((await loadReactions([song], ranks)).get(itemIdentity(song))).toEqual({ up: 1, down: 1 });
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
    expect(counts.get(original)).toEqual({ up: 2, down: 0 });
  });

  it("an emoji is no vote, and doesn't take one back; an empty reaction is a like", async () => {
    const cafe = item([["d", "cafe"]]);
    hold({ [DCOSL]: [react(ALICE, cafe, "-", T + 1), react(ALICE, cafe, "🔥", T + 2), react(BOB, cafe, "", T + 1)] });

    expect((await loadReactions([cafe], ranks)).get(itemIdentity(cafe))).toEqual({ up: 1, down: 1 });
  });

  it("reads by #e and #a from the list relays, a hundred at a time, and has a count for every item", async () => {
    const many = Array.from({ length: 150 }, (_, i) => item([["d", `place-${i}`]]));
    const { calls } = hold({ [DCOSL]: [react(ALICE, many[120], "+")], [INDEX]: [] });

    const counts = await loadReactions(many, ranks);

    expect(counts.size).toBe(150);
    expect(counts.get(itemIdentity(many[0]))).toEqual({ up: 0, down: 0 });
    expect(counts.get(itemIdentity(many[120]))).toEqual({ up: 1, down: 0 });
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

    expect(counts.get(itemIdentity(cafe))).toEqual({ up: 1, down: 1 });
    expect(asked).toEqual([[LOW.pk, STRANGER.pk].sort()]);
  });

  it("counts with the ranks it holds when asking for more fails", async () => {
    const cafe = item([["d", "cafe"]]);
    hold({ [DCOSL]: [react(ALICE, cafe, "+"), react(STRANGER, cafe, "+")] });

    const counts = await loadReactions([cafe], ranks, async () => {
      throw new Error("the scorer's relay is down");
    });

    expect(counts.get(itemIdentity(cafe))).toEqual({ up: 1, down: 0 });
  });

  it("asks nothing for no items", async () => {
    const { calls } = hold({ [DCOSL]: [] });
    expect((await loadReactions([], ranks)).size).toBe(0);
    expect(calls).toEqual([]);
  });
});
