/**
 * Whose scores decide who counts, and where those scores live.
 *
 * An observer names its own scorer in its kind-10040 (`["30382:rank", <TA>,
 * <relay>]`); an observer with none is ranked by the house, whose pubkey is
 * discovered at run time. The ports below follow Brainstorm-UI's
 * `trustSource.test.ts` and `wotRanks.test.ts` at the pinned commit, with the
 * relays standing behind Curate's own transport.
 */
import type { Filter, NostrEvent } from "nostr-tools";
import { matchFilter } from "nostr-tools/filter";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeTransport, type FakeRelay } from "@/test/fakeTransport";
import { clearSeenOn } from "@/services/nostr";
import { PROFILE_RELAYS } from "@/services/relays";
import { setTransport, type RelayTransport } from "@/services/transport";
import { useRelayStatus } from "@/stores/relay-status";
import {
  clearTrustCaches,
  fetchAuthorRanks,
  inWebOfTrust,
  readerAssistant,
  resolveHouseObserver,
  resolveTrustSource,
  VERIFIED_RANK,
} from "@/services/trust";

const HOUSE_URL = "https://brainstorm.world/.well-known/nostr.json?name=_";
const SCORES = "wss://scores.brainstorm.world";
const HOUSE_SCORES = "wss://house-scores.example.test";
const READER_SCORES = "wss://reader-scores.example.test";
const T0 = 1_792_000_000;

const actor = () => {
  const sk = generateSecretKey();
  return { sk, pk: getPublicKey(sk) };
};
type Actor = ReturnType<typeof actor>;

const HOUSE = actor();
const HOUSE_TA = actor();
const READER = actor();
const READER_TA = actor();
const OTHER_TA = actor();
const AUTHOR = actor().pk;
const BOT = actor().pk;

/** A kind 10040 as the client itself publishes it (`signNip85`). */
const declaration = (who: Actor, rows: string[][], created_at = T0): NostrEvent =>
  finalizeEvent({ kind: 10040, created_at, content: "", tags: rows }, who.sk) as NostrEvent;

const scorer = (ta: Actor, relay: string): string[][] => [
  ["30382:rank", ta.pk, relay],
  ["30382:followers", ta.pk, relay],
];

/** A kind 30382 as a Trusted Assistant publishes it. */
const assertion = (ta: Actor, subject: string, rank: string | number, created_at = T0): NostrEvent =>
  finalizeEvent(
    { kind: 30382, created_at, content: "", tags: [["d", subject], ["rank", String(rank)]] },
    ta.sk,
  ) as NostrEvent;

type Held = Record<string, NostrEvent[] | "fails">;
interface Call {
  relay: string;
  filters: Filter[];
}

/**
 * Relays that hold events and answer only the ones a filter matches, so a
 * wrong kind, author or `#d` shows up as a missing answer. A relay marked
 * "fails" ends its read with an error; a relay missing from `held` does too.
 * A relay listed in `ignoringFilters` sends everything it holds whatever it
 * was asked, as a buggy or hostile relay would.
 */
function relays(
  held: Held,
  ignoringFilters: string[] = [],
  /** A read this says fails times out, whatever the relay holds. */
  timesOut: (relay: string, filters: Filter[]) => boolean = () => false,
): { calls: Call[]; reads: (kind: number) => Call[] } {
  const calls: Call[] = [];
  const t: RelayTransport = {
    req(relay, filters, onEvent, timeoutMs) {
      calls.push({ relay, filters });
      const have = held[relay];
      const script: Record<string, FakeRelay> = {};
      if (timesOut(relay, filters)) {
        script[relay] = { events: [], end: { state: "timeout" } };
      } else if (have === "fails") {
        script[relay] = { events: [], end: { state: "error", reason: "relays down" } };
      } else if (have) {
        const answer = ignoringFilters.includes(relay) ? have : have.filter((ev) => filters.some((f) => matchFilter(f, ev)));
        script[relay] = { events: answer, end: { state: "eose" } };
      }
      return fakeTransport(script).req(relay, filters, onEvent, timeoutMs);
    },
    count: async () => null,
    live: () => () => {},
  };
  setTransport(t);
  return { calls, reads: (kind) => calls.filter((c) => c.filters.some((f) => f.kinds?.includes(kind))) };
}

/** Every profile relay holds these events. */
const onProfileRelays = (events: NostrEvent[] | "fails"): Held =>
  Object.fromEntries(PROFILE_RELAYS.map((r) => [r, events]));

/** A Storage that keeps its values in a Map. */
function session(values: Record<string, string> = {}) {
  const map = new Map(Object.entries(values));
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  return map;
}

const okJson = (body: unknown) => ({ ok: true, json: async () => body });

beforeEach(() => {
  clearTrustCaches();
  clearSeenOn();
  useRelayStatus.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("resolveTrustSource", () => {
  it("honors the TA and relay the observer's own 10040 names", async () => {
    relays(onProfileRelays([declaration(READER, scorer(READER_TA, SCORES))]));
    expect(await resolveTrustSource(READER.pk)).toEqual({ taPubkey: READER_TA.pk, relay: SCORES });
  });

  it("reads the 10040 from the profile relays, by its author", async () => {
    const { calls } = relays(onProfileRelays([declaration(READER, scorer(READER_TA, SCORES))]));
    await resolveTrustSource(READER.pk);
    expect(calls.map((c) => c.relay).sort()).toEqual([...PROFILE_RELAYS].sort());
    for (const c of calls) {
      expect(c.filters).toEqual([{ kinds: [10040], authors: [READER.pk], limit: 5 }]);
    }
  });

  it("gives different observers different sources", async () => {
    // The point of a per-observer trust graph: the same author can be rank 100
    // to one assistant and unknown to another.
    relays(
      onProfileRelays([
        declaration(HOUSE, scorer(HOUSE_TA, SCORES)),
        declaration(READER, scorer(READER_TA, SCORES)),
      ]),
    );
    const house = await resolveTrustSource(HOUSE.pk);
    const reader = await resolveTrustSource(READER.pk);
    expect(house?.taPubkey).toBe(HOUSE_TA.pk);
    expect(reader?.taPubkey).toBe(READER_TA.pk);
  });

  it("returns null when the observer never published a declaration", async () => {
    // A real state, not an error: a new account has no assistant yet.
    relays(onProfileRelays([]));
    expect(await resolveTrustSource(READER.pk)).toBeNull();
  });

  it("returns null rather than throwing when every relay fails", async () => {
    relays(onProfileRelays("fails"));
    expect(await resolveTrustSource(READER.pk)).toBeNull();
  });

  it("ignores a declaration with no rank pointer", async () => {
    // A deactivation publishes an empty-tag 10040. That reads as "no scorer".
    relays(onProfileRelays([declaration(READER, [])]));
    expect(await resolveTrustSource(READER.pk)).toBeNull();
  });

  it("reads the rank pointer specifically, not merely the first row", async () => {
    relays(
      onProfileRelays([
        declaration(READER, [
          ["30382:followers", OTHER_TA.pk, "wss://wrong.example"],
          ["30382:rank", READER_TA.pk, SCORES],
        ]),
      ]),
    );
    expect(await resolveTrustSource(READER.pk)).toEqual({ taPubkey: READER_TA.pk, relay: SCORES });
  });

  it("follows the newest 10040, so a later deactivation wins over an older scorer", async () => {
    relays(
      onProfileRelays([
        declaration(READER, scorer(READER_TA, SCORES), T0),
        declaration(READER, [], T0 + 100),
      ]),
    );
    expect(await resolveTrustSource(READER.pk)).toBeNull();
  });

  it("follows the newest 10040 when relays disagree about which is current", async () => {
    const [first, second, third] = PROFILE_RELAYS;
    relays({
      [first]: [declaration(READER, scorer(OTHER_TA, SCORES), T0)],
      [second]: [declaration(READER, scorer(READER_TA, SCORES), T0 + 50)],
      [third]: [],
    });
    expect(await resolveTrustSource(READER.pk)).toEqual({ taPubkey: READER_TA.pk, relay: SCORES });
  });

  it("ignores a 10040 that a relay returns for someone else", async () => {
    // Signed and valid, but not the observer's: it names nobody's scorer here.
    relays(onProfileRelays([declaration(OTHER_TA, scorer(OTHER_TA, SCORES))]), [...PROFILE_RELAYS]);
    expect(await resolveTrustSource(READER.pk)).toBeNull();
  });

  it("will not read ranks from a relay that isn't a wss:// address", async () => {
    relays(onProfileRelays([declaration(READER, [["30382:rank", READER_TA.pk, "javascript:alert(1)"]])]));
    expect(await resolveTrustSource(READER.pk)).toBeNull();
  });

  it("skips a rank row with no relay or a bad pubkey and takes the next good one", async () => {
    relays(
      onProfileRelays([
        declaration(READER, [
          ["30382:rank", READER_TA.pk],
          ["30382:rank", "not-a-pubkey", SCORES],
          ["30382:rank", OTHER_TA.pk, SCORES],
        ]),
      ]),
    );
    expect(await resolveTrustSource(READER.pk)).toEqual({ taPubkey: OTHER_TA.pk, relay: SCORES });
  });

  it("answers null for a pubkey that isn't 64 hex, without asking a relay", async () => {
    const { calls } = relays(onProfileRelays([]));
    expect(await resolveTrustSource("")).toBeNull();
    expect(await resolveTrustSource("nope")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("asks the relays once per observer", async () => {
    const { reads } = relays(onProfileRelays([declaration(READER, scorer(READER_TA, SCORES))]));
    await resolveTrustSource(READER.pk);
    await resolveTrustSource(READER.pk);
    await resolveTrustSource(READER.pk);
    expect(reads(10040)).toHaveLength(PROFILE_RELAYS.length);
  });

  it("asks again after a miss once a minute has passed, so a relay that was down isn't taken for 'never published'", async () => {
    vi.useFakeTimers();
    const held = onProfileRelays([]);
    const { reads } = relays(held);
    expect(await resolveTrustSource(READER.pk)).toBeNull();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(await resolveTrustSource(READER.pk)).toBeNull();
    expect(reads(10040)).toHaveLength(PROFILE_RELAYS.length); // still the first ask

    for (const r of PROFILE_RELAYS) held[r] = [declaration(READER, scorer(READER_TA, SCORES))];
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await resolveTrustSource(READER.pk)).toEqual({ taPubkey: READER_TA.pk, relay: SCORES });
  });
});

describe("readerAssistant", () => {
  const DLIST_ASSISTANT = actor().pk;
  const BARE_ASSISTANT = actor().pk;

  it("takes the 39998:dlist-header row first", async () => {
    relays(
      onProfileRelays([
        declaration(READER, [
          ["30382:rank", READER_TA.pk, SCORES],
          ["39998", BARE_ASSISTANT, SCORES],
          ["39998:dlist-header", DLIST_ASSISTANT, SCORES],
        ]),
      ]),
    );
    expect(await readerAssistant(READER.pk)).toBe(DLIST_ASSISTANT);
  });

  it("takes a bare 39998 row when there is no dlist-header row", async () => {
    relays(
      onProfileRelays([
        declaration(READER, [
          ["30382:rank", READER_TA.pk, SCORES],
          ["39998", BARE_ASSISTANT, SCORES],
        ]),
      ]),
    );
    expect(await readerAssistant(READER.pk)).toBe(BARE_ASSISTANT);
  });

  it("falls back to the 30382:rank provider", async () => {
    relays(onProfileRelays([declaration(READER, scorer(READER_TA, SCORES))]));
    expect(await readerAssistant(READER.pk)).toBe(READER_TA.pk);
  });

  it("is null when the reader published no 10040, or one that names nobody", async () => {
    relays(onProfileRelays([]));
    expect(await readerAssistant(READER.pk)).toBeNull();
    clearTrustCaches();
    relays(onProfileRelays([declaration(READER, [["client", "Brainstorm"]])]));
    expect(await readerAssistant(READER.pk)).toBeNull();
  });

  it("skips a row whose pubkey isn't 64 hex and takes the next kind of row", async () => {
    relays(
      onProfileRelays([
        declaration(READER, [
          ["39998:dlist-header", "npub1notahexkey", SCORES],
          ["39998", BARE_ASSISTANT, SCORES],
        ]),
      ]),
    );
    expect(await readerAssistant(READER.pk)).toBe(BARE_ASSISTANT);
  });

  it("follows the newest 10040", async () => {
    relays(
      onProfileRelays([
        declaration(READER, [["39998:dlist-header", DLIST_ASSISTANT, SCORES]], T0),
        declaration(READER, [["39998:dlist-header", BARE_ASSISTANT, SCORES]], T0 + 1),
      ]),
    );
    expect(await readerAssistant(READER.pk)).toBe(BARE_ASSISTANT);
  });

  it("shares one read of the 10040 with resolveTrustSource", async () => {
    const { reads } = relays(onProfileRelays([declaration(READER, scorer(READER_TA, SCORES))]));
    await resolveTrustSource(READER.pk);
    await readerAssistant(READER.pk);
    expect(reads(10040)).toHaveLength(PROFILE_RELAYS.length);
  });

  it("answers null for a pubkey that isn't 64 hex, without asking a relay", async () => {
    const { calls } = relays(onProfileRelays([]));
    expect(await readerAssistant("nope")).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("resolveHouseObserver", () => {
  it("discovers the house from brainstorm.world's NIP-05 rather than from a constant", async () => {
    session();
    const fetchMock = vi.fn().mockResolvedValue(okJson({ names: { _: HOUSE.pk } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await resolveHouseObserver()).toBe(HOUSE.pk);
    expect(fetchMock.mock.calls[0][0]).toBe(HOUSE_URL);
  });

  it("keeps the answer in sessionStorage under curate.house", async () => {
    const stored = session();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ names: { _: HOUSE.pk } })));
    await resolveHouseObserver();
    expect(stored.get("curate.house")).toBe(HOUSE.pk);
  });

  it("reads what the tab already discovered, instead of asking again", async () => {
    session({ "curate.house": HOUSE.pk });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await resolveHouseObserver()).toBe(HOUSE.pk);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks once for any number of callers", async () => {
    session();
    const fetchMock = vi.fn().mockResolvedValue(okJson({ names: { _: HOUSE.pk } }));
    vi.stubGlobal("fetch", fetchMock);
    const answers = await Promise.all([resolveHouseObserver(), resolveHouseObserver(), resolveHouseObserver()]);
    expect(answers).toEqual([HOUSE.pk, HOUSE.pk, HOUSE.pk]);
    await resolveHouseObserver();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores a stored value that isn't a pubkey and asks again", async () => {
    session({ "curate.house": "garbage" });
    const fetchMock = vi.fn().mockResolvedValue(okJson({ names: { _: HOUSE.pk } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await resolveHouseObserver()).toBe(HOUSE.pk);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("works with no sessionStorage at all", async () => {
    // Node has none: every read and write raises ReferenceError, and the page still resolves.
    expect(typeof sessionStorage).toBe("undefined");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ names: { _: HOUSE.pk } })));
    expect(await resolveHouseObserver()).toBe(HOUSE.pk);
  });

  it("works when sessionStorage throws on every call", async () => {
    const boom = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    vi.stubGlobal("sessionStorage", { getItem: boom, setItem: boom, removeItem: boom });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ names: { _: HOUSE.pk } })));
    expect(await resolveHouseObserver()).toBe(HOUSE.pk);
  });

  it("returns null instead of guessing when discovery fails", async () => {
    session();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await resolveHouseObserver()).toBeNull();
  });

  it("returns null when brainstorm.world answers with an error", async () => {
    session();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    expect(await resolveHouseObserver()).toBeNull();
  });

  it("rejects a malformed pubkey rather than passing it to a relay filter, and stores nothing", async () => {
    const stored = session();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ names: { _: "nope" } })));
    expect(await resolveHouseObserver()).toBeNull();
    expect(stored.has("curate.house")).toBe(false);
  });

  it("returns null for a body that isn't the NIP-05 shape", async () => {
    session();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson(null)));
    expect(await resolveHouseObserver()).toBeNull();
  });

  it("asks again after a failure once a minute has passed", async () => {
    vi.useFakeTimers();
    session();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(okJson({ names: { _: HOUSE.pk } }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await resolveHouseObserver()).toBeNull();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await resolveHouseObserver()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(31_000);
    expect(await resolveHouseObserver()).toBe(HOUSE.pk);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("fetchAuthorRanks", () => {
  /** The house is found by NIP-05, then scored by its own 10040; the reader may have a scorer too. */
  function world(extra: Held = {}, ignoringFilters: string[] = [], readerDeclares = false) {
    session();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ names: { _: HOUSE.pk } })));
    const declarations = [declaration(HOUSE, scorer(HOUSE_TA, HOUSE_SCORES))];
    if (readerDeclares) declarations.push(declaration(READER, scorer(READER_TA, READER_SCORES)));
    return relays({ ...onProfileRelays(declarations), ...extra }, ignoringFilters);
  }

  it("reads the house scorer for the Brainstorm Perspective", async () => {
    const { reads } = world({ [HOUSE_SCORES]: [assertion(HOUSE_TA, AUTHOR, 57)] });
    const r = await fetchAuthorRanks([AUTHOR, BOT], "house");
    expect(r.source).toBe("house");
    expect(r.ranks.get(AUTHOR)).toBe(57);
    expect(r.ranks.has(BOT)).toBe(false);
    // The scorer answered for both: BOT is unranked, not unknown.
    expect(r.answered).toEqual(new Set([AUTHOR, BOT]));
    expect(reads(30382)).toEqual([
      { relay: HOUSE_SCORES, filters: [{ kinds: [30382], authors: [HOUSE_TA.pk], "#d": [AUTHOR, BOT] }] },
    ]);
  });

  it("says which authors it has an answer for: those whose read ended, chunk by chunk", async () => {
    session();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ names: { _: HOUSE.pk } })));
    const authors = Array.from({ length: 250 }, () => actor().pk);
    relays(
      {
        ...onProfileRelays([declaration(HOUSE, scorer(HOUSE_TA, HOUSE_SCORES))]),
        [HOUSE_SCORES]: authors.map((pk) => assertion(HOUSE_TA, pk, 5)),
      },
      [],
      // The second chunk of 100 times out.
      (relay, filters) => relay === HOUSE_SCORES && (filters[0]["#d"] ?? []).includes(authors[100]),
    );

    const r = await fetchAuthorRanks(authors, "house");

    expect(r.answered).toEqual(new Set([...authors.slice(0, 100), ...authors.slice(200)]));
    expect(r.ranks.get(authors[0])).toBe(5);
    expect(r.ranks.has(authors[150])).toBe(false);
    expect(r.ranks.get(authors[249])).toBe(5);
  });

  it("says which relay the ranks were read from, so a page can tell when it didn't answer", async () => {
    world({ [HOUSE_SCORES]: [assertion(HOUSE_TA, AUTHOR, 57)] }, [], true);
    expect((await fetchAuthorRanks([AUTHOR], "house")).relay).toBe(HOUSE_SCORES);
    expect((await fetchAuthorRanks([AUTHOR], READER.pk)).relay).toBe(READER_SCORES);
  });

  it("reads the reader's own scorer, on the relay their 10040 names", async () => {
    const { reads } = world({ [READER_SCORES]: [assertion(READER_TA, AUTHOR, 9)] }, [], true);
    const r = await fetchAuthorRanks([AUTHOR], READER.pk);
    expect(r.source).toBe("observer");
    expect(r.ranks.get(AUTHOR)).toBe(9);
    expect(reads(30382).map((c) => c.relay)).toEqual([READER_SCORES]);
    expect(reads(30382)[0].filters[0]).toMatchObject({ authors: [READER_TA.pk] });
  });

  it("observer without a 10040 falls back to the house, and says so", async () => {
    const { reads } = world({ [HOUSE_SCORES]: [assertion(HOUSE_TA, AUTHOR, 3)] });
    const r = await fetchAuthorRanks([AUTHOR], READER.pk);
    expect(r.source).toBe("house");
    expect(r.ranks.get(AUTHOR)).toBe(3);
    expect(reads(30382).map((c) => c.relay)).toEqual([HOUSE_SCORES]);
  });

  it("an observer whose 10040 names no scorer falls back to the house", async () => {
    session();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ names: { _: HOUSE.pk } })));
    relays({
      ...onProfileRelays([declaration(HOUSE, scorer(HOUSE_TA, HOUSE_SCORES)), declaration(READER, [])]),
      [HOUSE_SCORES]: [assertion(HOUSE_TA, AUTHOR, 5)],
    });
    const r = await fetchAuthorRanks([AUTHOR], READER.pk);
    expect(r.source).toBe("house");
    expect(r.ranks.get(AUTHOR)).toBe(5);
  });

  it("the newest assertion about an author wins", async () => {
    world({ [HOUSE_SCORES]: [assertion(HOUSE_TA, AUTHOR, 90, T0), assertion(HOUSE_TA, AUTHOR, 1, T0 + 1)] });
    expect((await fetchAuthorRanks([AUTHOR], "house")).ranks.get(AUTHOR)).toBe(1);
  });

  it("a newest assertion with no usable rank leaves the author unranked rather than reviving an older one", async () => {
    const revoked = finalizeEvent(
      { kind: 30382, created_at: T0 + 1, content: "", tags: [["d", AUTHOR]] },
      HOUSE_TA.sk,
    ) as NostrEvent;
    world({ [HOUSE_SCORES]: [assertion(HOUSE_TA, AUTHOR, 90, T0), revoked] });
    expect((await fetchAuthorRanks([AUTHOR], "house")).ranks.has(AUTHOR)).toBe(false);
  });

  it("an empty rank value is not rank 0", async () => {
    world({ [HOUSE_SCORES]: [assertion(HOUSE_TA, AUTHOR, ""), assertion(HOUSE_TA, BOT, "forty")] });
    const r = await fetchAuthorRanks([AUTHOR, BOT], "house");
    expect(r.ranks.size).toBe(0);
  });

  it("counts an assertion only when the scorer itself signed it", async () => {
    // A scores relay can return a signed 30382 from anyone. Only the TA's counts.
    world({ [HOUSE_SCORES]: [assertion(OTHER_TA, AUTHOR, 100), assertion(HOUSE_TA, BOT, 4)] }, [HOUSE_SCORES]);
    const r = await fetchAuthorRanks([AUTHOR, BOT], "house");
    expect(r.ranks.has(AUTHOR)).toBe(false);
    expect(r.ranks.get(BOT)).toBe(4);
  });

  it("keeps only authors that were asked about", async () => {
    // A relay that answers more than it was asked.
    world({ [HOUSE_SCORES]: [assertion(HOUSE_TA, AUTHOR, 7)] }, [HOUSE_SCORES]);
    const r = await fetchAuthorRanks([BOT], "house");
    expect(r.ranks.size).toBe(0);
  });

  it("asks 100 authors at a time, on the source's relay, and merges the answers", async () => {
    const authors = Array.from({ length: 250 }, () => actor().pk);
    const assertions = authors.map((pk, i) => assertion(HOUSE_TA, pk, i % 5));
    const { reads } = world({ [HOUSE_SCORES]: assertions });
    const r = await fetchAuthorRanks([...authors, ...authors.slice(0, 10)], "house");

    const asked = reads(30382);
    expect(asked.map((c) => (c.filters[0]["#d"] ?? []).length)).toEqual([100, 100, 50]);
    expect(new Set(asked.map((c) => c.relay))).toEqual(new Set([HOUSE_SCORES]));
    expect(asked.flatMap((c) => c.filters[0]["#d"] ?? [])).toEqual(authors);
    expect(r.ranks.size).toBe(250);
    expect(r.ranks.get(authors[7])).toBe(2);
    expect(r.ranks.get(authors[249])).toBe(4);
  });

  it("leaves authors that aren't 64 hex out of the filter", async () => {
    const { reads } = world({ [HOUSE_SCORES]: [assertion(HOUSE_TA, AUTHOR, 7)] });
    await fetchAuthorRanks([AUTHOR, "", "nope"], "house");
    expect(reads(30382)[0].filters[0]["#d"]).toEqual([AUTHOR]);
  });

  it("no scorer at all ranks nobody and reads no scores", async () => {
    session();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { reads } = relays(onProfileRelays([]));
    const r = await fetchAuthorRanks([AUTHOR], "house");
    expect(r).toEqual({ ranks: new Map(), source: null });
    expect(reads(30382)).toHaveLength(0);
  });

  it("a house whose 10040 names no scorer ranks nobody", async () => {
    session();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({ names: { _: HOUSE.pk } })));
    relays(onProfileRelays([]));
    expect(await fetchAuthorRanks([AUTHOR], READER.pk)).toEqual({ ranks: new Map(), source: null });
  });

  it("a scores relay that fails ranks nobody rather than throwing", async () => {
    const { reads } = world({ [HOUSE_SCORES]: "fails" });
    const r = await fetchAuthorRanks([AUTHOR], "house");
    expect(r.ranks.size).toBe(0);
    expect(r.answered).toEqual(new Set());
    expect(r.source).toBe("house");
    expect(reads(30382)).toHaveLength(1);
  });
});

describe("inWebOfTrust", () => {
  it("rank 2 is inside, rank 1 outside", () => {
    expect(VERIFIED_RANK).toBe(2);
    const ranks = new Map([
      [AUTHOR, 2],
      [BOT, 1],
    ]);
    expect(inWebOfTrust(ranks, AUTHOR)).toBe(true);
    expect(inWebOfTrust(ranks, BOT)).toBe(false);
  });

  it("rank 0 is outside, and an author nobody ranked is outside", () => {
    const ranks = new Map([[AUTHOR, 0]]);
    expect(inWebOfTrust(ranks, AUTHOR)).toBe(false);
    expect(inWebOfTrust(ranks, BOT)).toBe(false);
  });

  it("anything above the line is inside", () => {
    expect(inWebOfTrust(new Map([[AUTHOR, 100]]), AUTHOR)).toBe(true);
  });
});
