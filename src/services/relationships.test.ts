/**
 * What an item or a list is connected to: the lists it's on, curation copies
 * of it, tags applied to it, other list items that mention it, and what it
 * names itself, each read through the reader's web of trust.
 *
 * The relays hold almost no item taggings or copies yet, so the events in
 * src/test/fixtures/relationships.json are built by hand in the shapes
 * Brainstorm-UI's event-tagging builders write (tag elements, per-tag
 * tagging headers, taggings) and signed under fixed test keys, one per role,
 * by scripts/sign-relationships-fixture.mjs: each role's secret key is one
 * byte repeated 32 times (OWNER 0x11, CURATOR 0x22, TAG_AUTHOR 0x33, TAGGER
 * 0x44, DISPUTER 0x55, MENTIONER 0x66, STRANGER 0x77, ROGUE 0x88,
 * PROPRIETOR 0x99). They verify, as everything read from a relay must.
 *
 * The fake relays answer every request with everything they hold
 * (src/test/fakeTransport), as a careless relay may, so each case also shows
 * that only what names the item is kept. What is asked of which relay is
 * pinned on relays that match filters as a relay does (src/test/relayCorpus).
 */
import type { Filter, NostrEvent } from "nostr-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RELAYS } from "@/lib/curate/relayUrls";
import { coordinateOf } from "@/lib/dlistFields";
import { clearSeenOn } from "@/services/nostr";
import { DCOSL, INDEX, listRelays, TAG_HUB } from "@/services/relays";
import { setTransport } from "@/services/transport";
import { VERIFIED_RANK } from "@/services/trust";
import { useRelayStatus } from "@/stores/relay-status";
import { useSettings } from "@/stores/settings";
import { fakeTransport, type FakeRelay } from "@/test/fakeTransport";
import { relayCorpus, type RelayCall } from "@/test/relayCorpus";
import fixture from "@/test/fixtures/relationships.json";
import { clearRelationshipsCache, loadRelationships, type Related } from "./relationships";

const fx: Record<keyof typeof fixture, NostrEvent> = fixture;

const OWNER = fx.item.pubkey;
const CURATOR = fx.copy.pubkey;
const TAG_AUTHOR = fx.cosyElement.pubkey;
const TAGGER = fx.cosyByTagger.pubkey;
const DISPUTER = fx.cosyByDisputer.pubkey;
const MENTIONER = fx.mention.pubkey;
const STRANGER = fx.strangerMention.pubkey;
const ROGUE = fx.overpricedElement.pubkey;
const PROPRIETOR = fx.item.tags.find((t) => t[0] === "p")![1];

const ITEM = coordinateOf(fx.item)!;
const COSY = `39999:${TAG_AUTHOR}:cosy`;
const QUIET = `39999:${TAG_AUTHOR}:quiet`;
const GOOD_WIFI = `39999:${TAG_AUTHOR}:good-wifi`;
const OVERPRICED = `39999:${ROGUE}:overpriced`;

/**
 * The hub: lists, items, a reaction, and two taggings it also holds. Among
 * them, a copy of another item and an item that quotes this one without
 * being a copy of it.
 */
const HUB_EVENTS = [
  fx.ownerList,
  fx.otherItem,
  fx.item,
  fx.curatorList,
  fx.copy,
  fx.otherCopy,
  fx.mentionList,
  fx.mention,
  fx.quoting,
  fx.strangerMention,
  fx.reaction,
  fx.smallList,
  fx.cornerItem,
  fx.listOfLists,
  fx.cosyByTagger,
  fx.overpricedByTagger,
];

/** The tag hub: tag elements, their tagging headers, and the taggings, one of them of another item. */
const TAG_EVENTS = [
  fx.cosyElement,
  fx.quietElement,
  fx.overpricedElement,
  fx.cosyHeader,
  fx.quietHeader,
  fx.goodWifiHeader,
  fx.overpricedHeader,
  fx.cosyByTagger,
  fx.cosyByDisputer,
  fx.cosyByStranger,
  fx.quietByMentioner,
  fx.goodWifiByTagger,
  fx.cosyOnOtherItem,
  fx.overpricedByTagger,
];

const EOSE = { state: "eose" } as const;
const HUB: FakeRelay = { events: HUB_EVENTS, end: EOSE };
const TAGS: FakeRelay = { events: TAG_EVENTS, end: EOSE };

function relays(script: Record<string, FakeRelay> = { [DCOSL]: HUB, [TAG_HUB]: TAGS }) {
  const t = fakeTransport(script);
  setTransport(t);
  return t;
}

/** Everyone the scorer answered for, inside the line but for those `below` it: by default the stranger. */
const rankAll = (below: string[] = [STRANGER]) =>
  new Map(
    [OWNER, CURATOR, TAGGER, DISPUTER, MENTIONER, STRANGER].map((pk) => [
      pk,
      below.includes(pk) ? VERIFIED_RANK - 1 : VERIFIED_RANK,
    ]),
  );
const ranks = rankAll();
const answered = new Set(ranks.keys());

const ids = (related: Related[]) => related.map((r) => r.event.id);

/** The page's ranks when only the list's own author is ranked. */
const pageRanks = new Map([[OWNER, VERIFIED_RANK]]);
const pageAnswered = new Set([OWNER]);

/** The scorer's answer for whoever it is asked about: as `rankAll` ranks them, each answered for. */
const scorer = async (pubkeys: string[]) => {
  const all = rankAll();
  return { ranks: new Map(pubkeys.map((pk) => [pk, all.get(pk) ?? 0])), answered: new Set(pubkeys) };
};

/** Each distinct read, by its filters, with the relays it went to. `readWhere` finds the one read a filter of it fits. */
function readsIn(calls: RelayCall[]) {
  const reads = new Map<string, { filters: Filter[]; relays: Set<string> }>();
  for (const c of calls.filter((call) => call.op === "req")) {
    const key = JSON.stringify(c.filters);
    const read = reads.get(key) ?? { filters: c.filters, relays: new Set<string>() };
    read.relays.add(c.relay);
    reads.set(key, read);
  }
  return (fits: (f: Filter) => boolean) => {
    const found = [...reads.values()].filter((r) => r.filters.some(fits));
    expect(found).toHaveLength(1);
    return found[0];
  };
}

beforeEach(() => {
  clearRelationshipsCache();
  clearSeenOn();
  useRelayStatus.getState().reset();
  useSettings.setState({ relays: [...DEFAULT_RELAYS] });
});

describe("loadRelationships, for an item", () => {
  it("finds the lists the item names, by name, keeping one it couldn't read by its reference", async () => {
    relays();
    const r = await loadRelationships(fx.item, ranks, answered, null);
    expect(r.lists).toEqual([
      { ref: coordinateOf(fx.ownerList), name: "Coffee places" },
      { ref: `39998:${OWNER}:closed-places`, name: null },
    ]);
  });

  it("finds curation copies by their q, with the list each is on", async () => {
    relays();
    const r = await loadRelationships(fx.item, ranks, answered, null);
    // Not the copy of another item, nor an item that quotes this one under a `d` of its own.
    expect(r.copies).toEqual([{ event: fx.copy, listRef: coordinateOf(fx.curatorList), listName: "Favourite cafes" }]);
  });

  it("counts each tag by the people inside the line who applied or disputed it", async () => {
    relays();
    const r = await loadRelationships(fx.item, ranks, answered, null);
    // The stranger applied Cosy too, from outside the line, and the mentioner applied it to another item: neither counts.
    expect(r.tags).toEqual([
      { name: "Cosy", address: COSY, applied: 1, disputed: 1, mine: null },
      { name: "good-wifi", address: GOOD_WIFI, applied: 1, disputed: 0, mine: null },
      { name: "Quiet corner", address: QUIET, applied: 1, disputed: 0, mine: null },
    ]);
  });

  it("doesn't count a tagging whose header joins a namespace nobody honours", async () => {
    relays();
    const r = await loadRelationships(fx.item, ranks, answered, null);
    expect(r.tags.map((t) => t.address)).not.toContain(OVERPRICED);
  });

  it("names a tag by its element's name tag, then the name in its content, then its slug", async () => {
    relays();
    const r = await loadRelationships(fx.item, ranks, answered, null);
    const names = Object.fromEntries(r.tags.map((t) => [t.address, t.name]));
    expect(names[QUIET]).toBe("Quiet corner"); // its name tag, over the "Quiet" in its content
    expect(names[COSY]).toBe("Cosy"); // its content, as Brainstorm writes a tag element
    expect(names[GOOD_WIFI]).toBe("good-wifi"); // no element found
  });

  it("finds the list items that mention the item, with the list each is on", async () => {
    relays();
    const r = await loadRelationships(fx.item, ranks, answered, null);
    expect(r.mentions).toEqual([
      { event: fx.mention, listRef: coordinateOf(fx.mentionList), listName: "Cafes worth the walk" },
    ]);
  });

  it("doesn't count a copy, a tagging, a reaction or the item itself as a mention", async () => {
    relays();
    const r = await loadRelationships(fx.item, ranks, answered, null);
    const mentioned = [...ids(r.mentions), ...ids(r.folded.mentions)];
    // The copy names the item by `a` as well as by `q`.
    expect(mentioned).not.toContain(fx.copy.id);
    expect(mentioned).not.toContain(fx.cosyByTagger.id);
    expect(mentioned).not.toContain(fx.overpricedByTagger.id);
    expect(mentioned).not.toContain(fx.reaction.id);
    expect(mentioned).not.toContain(fx.item.id);
    expect(mentioned).toEqual([fx.mention.id, fx.strangerMention.id]);
  });

  it("lists what the item names itself, each once, in its own order", async () => {
    relays();
    const r = await loadRelationships(fx.item, ranks, answered, null);
    expect(r.names).toEqual([
      { tag: "p", value: PROPRIETOR },
      { tag: "t", value: "coffee" },
      { tag: "e", value: fx.otherItem.id },
      { tag: "a", value: coordinateOf(fx.otherItem) },
    ]);
  });
});

describe("loadRelationships, for a curation copy", () => {
  it("reads what names its original, by id or by address, and never counts the copy itself", async () => {
    relays();
    const r = await loadRelationships(fx.copy, ranks, answered, null);
    expect(r.lists).toEqual([{ ref: coordinateOf(fx.curatorList), name: "Favourite cafes" }]);
    expect(r.copies).toEqual([]);
    expect(ids(r.mentions)).toEqual([fx.mention.id]);
    expect(ids(r.folded.mentions)).toEqual([fx.strangerMention.id]);
    expect(r.tags.map((t) => [t.address, t.applied, t.disputed])).toEqual([
      [COSY, 1, 1],
      [GOOD_WIFI, 1, 0],
      [QUIET, 1, 0],
    ]);
  });
});

describe("loadRelationships, through the web of trust", () => {
  it("folds a mention by someone outside the line, only once the scorer answered for them", async () => {
    relays();
    const r = await loadRelationships(fx.item, ranks, answered, null);
    expect(ids(r.mentions)).toEqual([fx.mention.id]);
    expect(r.folded.mentions).toEqual([
      { event: fx.strangerMention, listRef: coordinateOf(fx.mentionList), listName: "Cafes worth the walk" },
    ]);

    const unknown = new Set([...answered].filter((pk) => pk !== STRANGER));
    const shown = await loadRelationships(fx.item, ranks, unknown, null);
    expect(ids(shown.mentions)).toEqual([fx.strangerMention.id, fx.mention.id]);
    expect(shown.folded.mentions).toEqual([]);
  });

  it("folds a copy by someone outside the line", async () => {
    relays();
    const r = await loadRelationships(fx.item, rankAll([STRANGER, CURATOR]), answered, null);
    expect(r.copies).toEqual([]);
    expect(ids(r.folded.copies)).toEqual([fx.copy.id]);
  });

  it("returns the reader's own stance on a tag, whether or not it counts", async () => {
    relays();
    const asStranger = await loadRelationships(fx.item, ranks, answered, STRANGER);
    expect(asStranger.tags.find((t) => t.address === COSY)).toMatchObject({ applied: 1, disputed: 1, mine: "apply" });

    const asDisputer = await loadRelationships(fx.item, ranks, answered, DISPUTER);
    expect(asDisputer.tags.find((t) => t.address === COSY)?.mine).toBe("dispute");

    // A tag only the reader applied, from outside the line, stays in sight with nobody counted.
    const asTagger = await loadRelationships(fx.item, rankAll([STRANGER, TAGGER]), answered, TAGGER);
    expect(asTagger.tags.find((t) => t.address === GOOD_WIFI)).toEqual({
      name: "good-wifi",
      address: GOOD_WIFI,
      applied: 0,
      disputed: 0,
      mine: "apply",
    });
    expect(asTagger.tags.find((t) => t.address === COSY)).toMatchObject({ applied: 0, disputed: 1, mine: "apply" });
    expect(asTagger.tags.map((t) => t.address)).not.toContain(OVERPRICED);
  });
});

describe("loadRelationships, when relays fail", () => {
  it("names a list relay that didn't answer, and loads the rest from the others", async () => {
    useSettings.setState({ relays: [...DEFAULT_RELAYS, "wss://relay.example.com"] });
    const extra = listRelays().find((url) => url !== DCOSL)!;
    relays({ [DCOSL]: HUB, [TAG_HUB]: TAGS, [extra]: { events: [], end: { state: "closed", reason: "auth-required:" } } });
    const r = await loadRelationships(fx.item, ranks, answered, null);
    expect(r.unread).toEqual([extra]);
    expect(r.lists.map((l) => l.name)).toEqual(["Coffee places", null]);
    expect(ids(r.copies)).toEqual([fx.copy.id]);
    expect(r.tags.map((t) => t.address)).toEqual([COSY, GOOD_WIFI, QUIET]);
    expect(ids(r.mentions)).toEqual([fx.mention.id]);
  });

  it("keeps a copy out of the mentions when the read of copies wasn't answered", async () => {
    const t = relays();
    const answer = t.req;
    vi.spyOn(t, "req").mockImplementation((relay, filters, onEvent, timeoutMs) =>
      filters.some((f) => "#q" in f)
        ? Promise.resolve({ state: "error", reason: "refused" } as const)
        : answer(relay, filters, onEvent, timeoutMs),
    );
    const r = await loadRelationships(fx.item, ranks, answered, null);
    expect(r.copies).toEqual([]);
    expect(r.unread).toEqual([DCOSL]);
    // The copy names the item by `a`, so the read of mentions finds it.
    expect([...ids(r.mentions), ...ids(r.folded.mentions)]).toEqual([fx.mention.id, fx.strangerMention.id]);
  });

  it("names the tag hub once when it fails, with the tags it holds lost and the rest kept", async () => {
    relays({ [DCOSL]: HUB });
    const r = await loadRelationships(fx.item, ranks, answered, null);
    expect(r.unread).toEqual([TAG_HUB]);
    // The hub holds a tagging, but not the header it names: nothing can be counted.
    expect(r.tags).toEqual([]);
    expect(ids(r.copies)).toEqual([fx.copy.id]);
    expect(ids(r.mentions)).toEqual([fx.mention.id]);
  });
});

describe("loadRelationships, kept for the session", () => {
  it("reads nothing new on a second call for the same event, and applies that call's trust", async () => {
    const t = relays();
    const req = vi.spyOn(t, "req");
    await loadRelationships(fx.item, ranks, answered, null);
    const asked = req.mock.calls.length;
    expect(asked).toBeGreaterThan(0);

    const again = await loadRelationships(fx.item, rankAll([STRANGER, CURATOR]), answered, TAGGER);
    expect(req.mock.calls.length).toBe(asked);
    expect(ids(again.folded.copies)).toEqual([fx.copy.id]);
    expect(again.tags.find((t) => t.address === COSY)?.mine).toBe("apply");

    await loadRelationships(fx.copy, ranks, answered, null);
    expect(req.mock.calls.length).toBeGreaterThan(asked);
  });

  it("reads again after a relay didn't answer, and nothing more once every relay has", async () => {
    const failing = relays({ [DCOSL]: HUB });
    const failingReq = vi.spyOn(failing, "req");
    expect((await loadRelationships(fx.item, ranks, answered, null)).unread).toEqual([TAG_HUB]);
    const asked = failingReq.mock.calls.length;
    await loadRelationships(fx.item, ranks, answered, null);
    expect(failingReq.mock.calls.length).toBe(asked * 2);

    const healthy = relays();
    const healthyReq = vi.spyOn(healthy, "req");
    const answeredRead = await loadRelationships(fx.item, ranks, answered, null);
    expect(answeredRead.unread).toEqual([]);
    expect(answeredRead.tags).toHaveLength(3);
    const askedOnce = healthyReq.mock.calls.length;
    await loadRelationships(fx.item, ranks, answered, null);
    expect(healthyReq.mock.calls.length).toBe(askedOnce);
  });
});

describe("loadRelationships, ranking everyone involved", () => {
  it("asks rankMore once, for exactly the taggers, copiers and mentioners the page didn't rank", async () => {
    relays();
    // Without it, nobody the page didn't rank counts, and nobody folds.
    const unranked = await loadRelationships(fx.item, pageRanks, pageAnswered, null);
    expect(unranked.tags).toEqual([]);
    expect(unranked.folded).toEqual({ copies: [], mentions: [] });

    const rankMore = vi.fn(scorer);
    const r = await loadRelationships(fx.item, pageRanks, pageAnswered, null, rankMore);
    expect(rankMore).toHaveBeenCalledTimes(1);
    expect([...rankMore.mock.calls[0][0]].sort()).toEqual([CURATOR, DISPUTER, MENTIONER, STRANGER, TAGGER].sort());
    expect(r.tags.map((t) => [t.address, t.applied, t.disputed])).toEqual([
      [COSY, 1, 1],
      [GOOD_WIFI, 1, 0],
      [QUIET, 1, 0],
    ]);
    expect(ids(r.copies)).toEqual([fx.copy.id]);
    expect(ids(r.mentions)).toEqual([fx.mention.id]);
    expect(ids(r.folded.mentions)).toEqual([fx.strangerMention.id]);
  });

  it("doesn't ask rankMore when the page answered for everyone", async () => {
    relays();
    const rankMore = vi.fn(scorer);
    await loadRelationships(fx.item, ranks, answered, null, rankMore);
    expect(rankMore).not.toHaveBeenCalled();
  });

  it("leaves them unranked when rankMore fails, and still returns the reader's own stance", async () => {
    relays();
    const rankMore = vi.fn(async (): Promise<{ ranks: Map<string, number> }> => {
      throw new Error("the scorer's relay is down");
    });
    const r = await loadRelationships(fx.item, pageRanks, pageAnswered, TAGGER, rankMore);
    expect(rankMore).toHaveBeenCalledTimes(1);
    expect(r.tags).toEqual([
      { name: "Cosy", address: COSY, applied: 0, disputed: 0, mine: "apply" },
      { name: "good-wifi", address: GOOD_WIFI, applied: 0, disputed: 0, mine: "apply" },
    ]);
    expect(ids(r.mentions)).toEqual([fx.strangerMention.id, fx.mention.id]);
    expect(r.folded).toEqual({ copies: [], mentions: [] });
  });
});

describe("loadRelationships, what it asks and where", () => {
  const EXTRA = "wss://relay.example.com";

  /** Relays that match filters, with a second list relay the reader added; every request is recorded. */
  function corpus() {
    useSettings.setState({ relays: [...DEFAULT_RELAYS, EXTRA] });
    const lists = listRelays();
    const held = { [DCOSL]: HUB_EVENTS, [lists[1]]: [], [TAG_HUB]: TAG_EVENTS, [INDEX]: [] };
    const { transport, calls } = relayCorpus(held);
    setTransport(transport);
    return { lists, calls };
  }

  it("asks the list relays for copies, mentions and list names, the tag relays for tags, and never the index", async () => {
    const { lists, calls } = corpus();
    const r = await loadRelationships(fx.item, ranks, answered, null);
    // Matched as a relay matches, everything is found as before.
    expect(r.unread).toEqual([]);
    expect(ids(r.copies)).toEqual([fx.copy.id]);
    expect(r.tags.map((t) => t.address)).toEqual([COSY, GOOD_WIFI, QUIET]);
    expect(ids(r.mentions)).toEqual([fx.mention.id]);
    expect(r.lists.map((l) => l.name)).toEqual(["Coffee places", null]);

    expect(calls.some((c) => c.relay === INDEX)).toBe(false);
    const listSet = new Set(lists);
    const tagSet = new Set([...lists, TAG_HUB]);
    const readWhere = readsIn(calls);

    const copies = readWhere((f) => "#q" in f);
    expect(copies.filters).toEqual([{ kinds: [39999], "#q": [fx.item.id, ITEM] }]);
    expect(copies.relays).toEqual(listSet);

    const mentions = readWhere((f) => !!f.kinds?.includes(9999));
    expect(mentions.filters).toEqual([
      { kinds: [39999, 9999], "#e": [fx.item.id] },
      { kinds: [39999, 9999], "#a": [ITEM] },
    ]);
    expect(mentions.relays).toEqual(listSet);

    const listNames = readWhere((f) => f.kinds?.[0] === 39998);
    expect(listNames.relays).toEqual(listSet);

    const taggings = readWhere((f) => f.kinds?.length === 1 && f.kinds[0] === 39999 && ("#e" in f || "#a" in f));
    expect(taggings.filters).toEqual([
      { kinds: [39999], "#e": [fx.item.id] },
      { kinds: [39999], "#a": [ITEM] },
    ]);
    expect(taggings.relays).toEqual(tagSet);

    const headers = readWhere((f) => !!f["#d"]?.some((d) => d.startsWith("tagging:")));
    expect(headers.relays).toEqual(tagSet);

    const elements = readWhere((f) => !!f["#d"]?.includes("cosy"));
    expect(elements.relays).toEqual(tagSet);
  });

  it("asks for an event that isn't addressable by its id alone", async () => {
    const { calls } = corpus();
    await loadRelationships(fx.strangerMention, ranks, answered, null);
    const readWhere = readsIn(calls);
    expect(readWhere((f) => "#q" in f).filters).toEqual([{ kinds: [39999], "#q": [fx.strangerMention.id] }]);
    expect(calls.some((c) => c.filters.some((f) => "#a" in f))).toBe(false);
  });
});

describe("loadRelationships, for a list header", () => {
  it("reads no lists or copies, and counts lists that name it as mentions but not its own items", async () => {
    const t = relays();
    const req = vi.spyOn(t, "req");
    const r = await loadRelationships(fx.smallList, ranks, answered, null);
    expect(r.lists).toEqual([]);
    expect(r.copies).toEqual([]);
    expect(req.mock.calls.some(([, filters]) => filters.some((f) => "#q" in f))).toBe(false);
    // The corner shop is filed under the list by `e`: one of its items, not a mention.
    expect(r.mentions).toEqual([{ event: fx.listOfLists, listRef: `39998:${MENTIONER}:lists-i-follow`, listName: null }]);
  });
});
