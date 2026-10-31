/**
 * The Dictionary and every list's header, read from the relays; whose copy
 * of a concept governs for a reader. The Dictionary cases read the real
 * taggings and headers of 31 October (src/test/fixtures/dictionary.*); the
 * house and copy cases follow Brainstorm-UI's services/dictionary.test.ts
 * ("the house") at the pinned commit, with the relays behind Curate's own
 * transport.
 */
import { nip19, type NostrEvent } from "nostr-tools";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HeaderEvent } from "@/lib/conceptResolution";
import { coordinateOf } from "@/lib/dlistFields";
import { DEFAULT_RELAYS } from "@/lib/nostr/relays";
import { groupConcepts } from "@/services/concepts";
import { clearSeenOn } from "@/services/nostr";
import { DCOSL, INDEX, PROFILE_RELAYS, TAG_HUB } from "@/services/relays";
import { setTransport } from "@/services/transport";
import { clearTrustCaches } from "@/services/trust";
import { useRelayStatus } from "@/stores/relay-status";
import { useSettings } from "@/stores/settings";
import { fakeTransport } from "@/test/fakeTransport";
import { relayCorpus, type HeldRelay, type RelayCall } from "@/test/relayCorpus";
import dictionaryHeaders from "@/test/fixtures/dictionary.headers.json";
import dictionaryTaggings from "@/test/fixtures/dictionary.taggings.json";
import foodCopies from "@/test/fixtures/food.copies.json";
import foodHeader from "@/test/fixtures/food.header.json";
import {
  copyBy,
  CURATOR_TAG,
  houseCopyAuthors,
  loadAllHeaders,
  loadConceptHeaders,
  loadDictionaryConcepts,
  loadOwnHeaders,
  resolveForReader,
  URL_TEMPLATES_CONCEPT,
} from "./dictionary";

/** brainstorm.world's NIP-05 `_` on 31 October: the house that signed dictionary.taggings. */
const REAL_HOUSE = "be7bf5de068c1d842ed34a7c270507ec940f5ea51671cfd062a95e9d09420d0a";
const HOUSE_URL = "https://brainstorm.world/.well-known/nostr.json?name=_";
const CURATOR = "b83a28b7e4e5d20bd960c5faeb6625f95529166b8bdb045d42634a2f35919450";
const FOOD = `39998:${CURATOR}:food-and-drink-places`;
const T0 = 1_792_000_000;

const taggings = dictionaryTaggings as NostrEvent[];
const curatorHeaders = dictionaryHeaders as NostrEvent[];
const food = [...(foodHeader as NostrEvent[]), ...(foodCopies as NostrEvent[])];

const actor = () => {
  const sk = generateSecretKey();
  return { sk, pk: getPublicKey(sk) };
};
type Actor = ReturnType<typeof actor>;

const sign = (who: Actor, kind: number, tags: string[][], created_at = T0, content = ""): NostrEvent =>
  finalizeEvent({ kind, created_at, content, tags }, who.sk) as NostrEvent;

/** A 39998 header named `plural`, pointing at itself unless `b` says otherwise. */
const header = (who: Actor, d: string, plural: string, b: string | null = `39998:${who.pk}:${d}`, created_at = T0) =>
  sign(who, 39998, [["d", d], ["names", plural, plural], ...(b ? [["b", b, "pointer"]] : [])], created_at);

/** The house tagging someone a curator, as Brainstorm publishes it. */
const tagging = (by: Actor, person: string, created_at = T0) =>
  sign(
    by,
    39999,
    [
      ["d", `profile-tag-dictionary-concept-curator-${person.slice(0, 8)}`],
      ["p", person],
      ["a", CURATOR_TAG],
      ["polarity", "1"],
    ],
    created_at,
  );

/** brainstorm.world names `house` as its NIP-05 `_`; with null, the house can't be found. */
function houseIs(house: string | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url !== HOUSE_URL || !house) return { ok: false, json: async () => null };
      return { ok: true, json: async () => ({ names: { _: house } }) };
    }),
  );
}

/** Every list relay, the tag hub and the index hold these events; the profile relays hold `profiles`. */
function everywhere(events: NostrEvent[], profiles: NostrEvent[] = []) {
  const held: Record<string, HeldRelay> = {
    [DCOSL]: events,
    [TAG_HUB]: events,
    [INDEX]: events,
    ...Object.fromEntries(PROFILE_RELAYS.map((r) => [r, profiles])),
  };
  const corpus = relayCorpus(held);
  setTransport(corpus.transport);
  return corpus;
}

beforeEach(() => {
  clearTrustCaches();
  clearSeenOn();
  useRelayStatus.getState().reset();
  useSettings.setState({ relays: [...DEFAULT_RELAYS] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loadDictionaryConcepts", () => {
  /** The Dictionary on 31 October, in name order: Brainstorm's nine, without URL Templates. */
  const NINE = [
    `39998:6aca05b812da97601151776d13de04ae71afc9d86da1408f0e72cffef72ece4b:books`,
    `39998:2efaa715bbb46dd5be6b7da8d7700266d11674b913b8178addb5c2e63d987331:demo-dictionary-concepts`,
    `39998:${CURATOR}:divine-videos`,
    `39998:${CURATOR}:event-calendars`,
    `39998:${CURATOR}:events`,
    `39998:${CURATOR}:food-and-drink-places`,
    `39998:${CURATOR}:github-accounts`,
    `39998:77599c5c4a7ba08456679d812a414037f4b01c975fb4f577187df11d189f80d3:c7e2e5f1-2258-4d9d-92ed-d29b9837a82a`,
    `39998:77599c5c4a7ba08456679d812a414037f4b01c975fb4f577187df11d189f80d3:b504f5a8-949f-4d31-ad14-8afcebde2b34`,
  ];

  it("returns the curators' self-pointing headers in name order", async () => {
    houseIs(REAL_HOUSE);
    everywhere([...taggings, ...curatorHeaders]);

    const concepts = await loadDictionaryConcepts();

    expect(concepts).toEqual(NINE);
    // URL Templates is a curator's self-pointing header too, but it plays a role: links, not a list.
    expect(curatorHeaders.some((h) => coordinateOf(h) === URL_TEMPLATES_CONCEPT)).toBe(true);
    expect(concepts).not.toContain(URL_TEMPLATES_CONCEPT);
  });

  it("asks for the house's curator taggings, then the curators' headers", async () => {
    houseIs(REAL_HOUSE);
    const { calls } = everywhere([...taggings, ...curatorHeaders]);

    await loadDictionaryConcepts();

    const asked = calls.filter((c) => c.relay === DCOSL).map((c) => c.filters);
    expect(asked[0]).toEqual([{ kinds: [39999], authors: [REAL_HOUSE], "#a": [CURATOR_TAG] }]);
    expect(asked[1]).toHaveLength(1);
    expect(asked[1][0].kinds).toEqual([39998]);
    expect([...(asked[1][0].authors ?? [])].sort()).toEqual(
      [
        "2efaa715bbb46dd5be6b7da8d7700266d11674b913b8178addb5c2e63d987331",
        "6aca05b812da97601151776d13de04ae71afc9d86da1408f0e72cffef72ece4b",
        "77599c5c4a7ba08456679d812a414037f4b01c975fb4f577187df11d189f80d3",
        CURATOR,
      ].sort(),
    );
    // dcosl, the tag hub and the index are each asked both times.
    for (const relay of [DCOSL, TAG_HUB, INDEX]) {
      expect(calls.filter((c) => c.relay === relay)).toHaveLength(2);
    }
  });

  it("finds what lives only on the tag hub", async () => {
    houseIs(REAL_HOUSE);
    setTransport(
      relayCorpus({
        [DCOSL]: curatorHeaders,
        [TAG_HUB]: taggings,
        [INDEX]: { refuses: "error: vespa searched only 67% of the corpus" },
      }).transport,
    );

    expect(await loadDictionaryConcepts()).toHaveLength(9);
  });

  it("someone other than the house tagging a person makes no curator", async () => {
    houseIs(REAL_HOUSE);
    const stranger = actor();
    const hopeful = actor();
    everywhere([...taggings, ...curatorHeaders, tagging(stranger, hopeful.pk), header(hopeful, "cats", "Cats")]);

    const concepts = await loadDictionaryConcepts();

    expect(concepts).toHaveLength(9);
    expect(concepts).not.toContain(`39998:${hopeful.pk}:cats`);
  });

  it("is empty when the house can't be found, and asks no relay", async () => {
    houseIs(null);
    const { calls } = everywhere([...taggings, ...curatorHeaders]);

    expect(await loadDictionaryConcepts()).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("loadAllHeaders", () => {
  const alice = actor();
  const bob = actor();

  it("reads every 39998 and 9998, and the 39999s that declare themselves headers", async () => {
    const own = header(alice, "cats", "Cats");
    const old = sign(bob, 9998, [["names", "Dog", "Dogs"]]);
    const declared = sign(bob, 39999, [["d", "songs"], ["z", "list"], ["names", "Song", "Songs"]]);
    const item = sign(bob, 39999, [["d", "felix"], ["z", coordinateOf(own)!]]);
    const { calls } = everywhere([own, old, declared, item]);

    const headers = await loadAllHeaders();

    expect(headers.map((h) => h.id).sort()).toEqual([own.id, old.id, declared.id].sort());
    expect(calls.find((c) => c.relay === DCOSL)?.filters).toEqual([
      { kinds: [39998, 9998] },
      { kinds: [39999, 9999], "#z": ["list"] },
    ]);
    // No concept-header was found, so there is no second round.
    expect(calls.filter((c) => c.relay === DCOSL)).toHaveLength(1);
  });

  it("gathers, in a second round, the 39999s that name a concept-header", async () => {
    const conceptHeader = sign(alice, 39998, [["d", "concept-header"], ["names", "Concept header", "Concept headers"]]);
    const named = sign(bob, 39999, [["d", "word"], ["z", coordinateOf(conceptHeader)!], ["names", "Word", "Words"]]);
    const { calls } = everywhere([conceptHeader, named]);

    const headers = await loadAllHeaders();

    expect(headers.map((h) => h.id).sort()).toEqual([conceptHeader.id, named.id].sort());
    const rounds = calls.filter((c) => c.relay === DCOSL).map((c) => c.filters);
    expect(rounds).toHaveLength(2);
    expect(rounds[1]).toEqual([{ kinds: [39999, 9999], "#z": [coordinateOf(conceptHeader)] }]);
  });

  it("keeps only headers, whatever a relay sends", async () => {
    const own = header(alice, "cats", "Cats");
    const stray = sign(bob, 39999, [["d", "felix"], ["z", coordinateOf(own)!]]);
    const note = sign(bob, 1, [], T0, "hello");
    setTransport(
      fakeTransport({
        [DCOSL]: { events: [own, stray, note], end: { state: "eose" } },
        [INDEX]: { events: [stray], end: { state: "eose" } },
      }),
    );

    expect((await loadAllHeaders()).map((h) => h.id)).toEqual([own.id]);
  });

  it("keeps a blank header, so it can be set apart rather than come back as its older self", async () => {
    const before = header(alice, "cats", "Cats");
    const blanked = sign(alice, 39998, [["d", "cats"], ["deleted", "true"]], T0 + 10);
    everywhere([before, blanked]);

    const headers = await loadAllHeaders();

    expect(headers.map((h) => h.id).sort()).toEqual([before.id, blanked.id].sort());
    expect(groupConcepts(headers).blank.map((h) => h.id)).toEqual([blanked.id]);
  });

  it("loads from dcosl when the index refuses, and merges the index's when it answers", async () => {
    const onHub = header(alice, "cats", "Cats");
    const onIndex = header(bob, "dogs", "Dogs");
    setTransport(
      relayCorpus({ [DCOSL]: [onHub], [INDEX]: { refuses: "error: vespa searched only 67% of the corpus" } }).transport,
    );
    expect((await loadAllHeaders()).map((h) => h.id)).toEqual([onHub.id]);

    setTransport(relayCorpus({ [DCOSL]: [onHub], [INDEX]: [onHub, onIndex] }).transport);
    expect((await loadAllHeaders()).map((h) => h.id).sort()).toEqual([onHub.id, onIndex.id].sort());
  });
});

describe("loadOwnHeaders", () => {
  const alice = actor();
  const bob = actor();

  it("reads the headers one person published, from the list relays and only there", async () => {
    const mine = header(alice, "cats", "Cats");
    const hers = header(alice, "dogs", "Dogs", null);
    const his = header(bob, "cats", "Cats");
    const note = sign(alice, 1, [], T0, "hello");
    const { calls } = everywhere([mine, hers, his, note]);

    const headers = await loadOwnHeaders(alice.pk);

    expect(headers.map((h) => h.id).sort()).toEqual([mine.id, hers.id].sort());
    expect(calls.filter((c) => c.relay === DCOSL).map((c) => c.filters)).toEqual([[{ kinds: [39998], authors: [alice.pk] }]]);
    expect(calls.filter((c) => c.relay === INDEX || c.relay === TAG_HUB)).toEqual([]);
  });

  it("keeps a blank header, so a short name given up since is not counted twice", async () => {
    const before = header(alice, "cats", "Cats");
    const blanked = sign(alice, 39998, [["d", "cats"], ["deleted", "true"]], T0 + 10);
    everywhere([before, blanked]);

    expect((await loadOwnHeaders(alice.pk)).map((h) => h.id).sort()).toEqual([before.id, blanked.id].sort());
  });

  it("answers with nothing, and does not reject, when the relays fail", async () => {
    setTransport(fakeTransport({ [DCOSL]: { events: [], end: { state: "error", reason: "connection refused" } } }));

    await expect(loadOwnHeaders(alice.pk)).resolves.toEqual([]);
  });
});

describe("loadConceptHeaders", () => {
  const alice = actor();
  const bob = actor();
  const carol = actor();

  const root = header(alice, "cats", "Cats");
  const rootCoordinate = coordinateOf(root)!;
  const copy = header(bob, "cats", "Cats", rootCoordinate);
  const elsewhere = header(carol, "dogs", "Dogs");

  const dcosl = (calls: RelayCall[]) => calls.filter((c) => c.relay === DCOSL);

  it("reads a list's header by its address, and the headers that point at it, in one round", async () => {
    const { calls } = everywhere([root, copy, elsewhere]);

    const headers = await loadConceptHeaders(rootCoordinate);

    expect(headers.map((h) => h.id).sort()).toEqual([root.id, copy.id].sort());
    expect(dcosl(calls)).toHaveLength(1);
    expect(dcosl(calls)[0].filters).toEqual([
      { kinds: [39998], authors: [alice.pk], "#d": ["cats"] },
      { kinds: [39998, 9998, 39999, 9999], "#b": [rootCoordinate] },
    ]);
  });

  it("reads a copy by its address too: the page then sends the reader to the concept", async () => {
    everywhere([root, copy, elsewhere]);

    const headers = await loadConceptHeaders(coordinateOf(copy)!);

    // The copy names its concept itself, so the concept's own header is not needed to say where to go.
    expect(headers.map((h) => h.id)).toEqual([copy.id]);
  });

  it("reads a 39999 that declares itself a header by its address", async () => {
    const declared = sign(bob, 39999, [["d", "songs"], ["z", "list"], ["names", "Song", "Songs"]]);
    const { calls } = everywhere([declared, root]);

    const headers = await loadConceptHeaders(`39999:${bob.pk}:songs`);

    expect(headers.map((h) => h.id)).toEqual([declared.id]);
    expect(dcosl(calls)[0].filters[0]).toEqual({ kinds: [39999], authors: [bob.pk], "#d": ["songs"] });
  });

  it("reads a list named by naddr as it reads its address", async () => {
    everywhere([root, copy]);
    const naddr = nip19.naddrEncode({ kind: 39998, pubkey: alice.pk, identifier: "cats" });

    expect((await loadConceptHeaders(naddr)).map((h) => h.id).sort()).toEqual([root.id, copy.id].sort());
  });

  it("reads a header named by id, then the address it is a version of, with its copies", async () => {
    const { calls } = everywhere([root, copy, elsewhere]);

    const headers = await loadConceptHeaders(root.id);

    expect(headers.map((h) => h.id).sort()).toEqual([root.id, copy.id].sort());
    expect(dcosl(calls).map((c) => c.filters)).toEqual([
      [{ ids: [root.id] }, { kinds: [39998, 9998, 39999, 9999], "#b": [root.id] }],
      [
        { kinds: [39998], authors: [alice.pk], "#d": ["cats"] },
        { kinds: [39998, 9998, 39999, 9999], "#b": [rootCoordinate] },
      ],
    ]);
  });

  it("an id that names an older version still reads the current one", async () => {
    const newer = header(alice, "cats", "Cats and kittens", rootCoordinate, T0 + 100);
    everywhere([root, newer, copy]);

    const headers = await loadConceptHeaders(root.id);

    expect(headers.map((h) => h.id).sort()).toEqual([root.id, newer.id, copy.id].sort());
  });

  it("an id that names a copy needs no second round", async () => {
    const { calls } = everywhere([root, copy]);

    const headers = await loadConceptHeaders(copy.id);

    expect(headers.map((h) => h.id)).toEqual([copy.id]);
    expect(dcosl(calls)).toHaveLength(1);
  });

  it("an unreplaceable header is its own id, and its copies point at that", async () => {
    const old = sign(alice, 9998, [["names", "Bird", "Birds"]]);
    const version = sign(bob, 39998, [["d", "birds"], ["names", "Bird", "Birds"], ["b", old.id, "pointer"]]);
    const { calls } = everywhere([old, version, elsewhere]);

    const headers = await loadConceptHeaders(old.id);

    expect(headers.map((h) => h.id).sort()).toEqual([old.id, version.id].sort());
    expect(dcosl(calls)).toHaveLength(1);
  });

  it("an id nobody holds reads what points at it", async () => {
    const missing = "f".repeat(64);
    const version = sign(bob, 39998, [["d", "birds"], ["names", "Bird", "Birds"], ["b", missing, "pointer"]]);
    everywhere([version]);

    expect((await loadConceptHeaders(missing)).map((h) => h.id)).toEqual([version.id]);
  });

  it("keeps only headers, whatever a relay sends", async () => {
    const stray = sign(bob, 39999, [["d", "felix"], ["z", rootCoordinate], ["b", rootCoordinate, "pointer"]]);
    const note = sign(bob, 1, [], T0, "hello");
    setTransport(fakeTransport({ [DCOSL]: { events: [root, stray, note], end: { state: "eose" } } }));

    expect((await loadConceptHeaders(rootCoordinate)).map((h) => h.id)).toEqual([root.id]);
  });

  it("keeps a blank header, so it can be set apart rather than come back as its older self", async () => {
    const blanked = sign(alice, 39998, [["d", "cats"], ["deleted", "true"]], T0 + 10);
    everywhere([root, blanked]);

    const headers = await loadConceptHeaders(rootCoordinate);

    expect(headers.map((h) => h.id).sort()).toEqual([root.id, blanked.id].sort());
  });

  it("asks nobody about what is not a list", async () => {
    const { calls } = everywhere([root]);

    expect(await loadConceptHeaders("food")).toEqual([]);
    expect(await loadConceptHeaders("")).toEqual([]);
    expect(await loadConceptHeaders(`30023:${alice.pk}:essay`)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("loads from dcosl when the index refuses", async () => {
    setTransport(
      relayCorpus({
        [DCOSL]: [root, copy],
        [INDEX]: { refuses: "error: vespa searched only 67% of the corpus" },
      }).transport,
    );

    expect((await loadConceptHeaders(rootCoordinate)).map((h) => h.id).sort()).toEqual([root.id, copy.id].sort());
  });
});

describe("houseCopyAuthors", () => {
  const house = actor();
  const houseTa = actor();
  const declaration = (ta: string) =>
    sign(house, 10040, [["30382:rank", ta, "wss://scores.example.test"]]);

  it("is the house, then the Assistant its 10040 names", async () => {
    houseIs(house.pk);
    everywhere([], [declaration(houseTa.pk)]);
    expect(await houseCopyAuthors()).toEqual([house.pk, houseTa.pk]);
  });

  it("is the house alone when it names itself, or no one", async () => {
    houseIs(house.pk);
    everywhere([], [declaration(house.pk)]);
    expect(await houseCopyAuthors()).toEqual([house.pk]);

    clearTrustCaches();
    everywhere([], []);
    expect(await houseCopyAuthors()).toEqual([house.pk]);
  });

  it("is no one when the house can't be found", async () => {
    houseIs(null);
    everywhere([], [declaration(houseTa.pk)]);
    expect(await houseCopyAuthors()).toEqual([]);
  });
});

describe("copyBy", () => {
  const alice = actor();
  const COMMUNITY = `39998:${CURATOR}:github-accounts`;

  it("is the author's header pointing at the concept, the one sharing its d first", () => {
    const sameD = header(alice, "github-accounts", "GitHub Accounts", COMMUNITY);
    const newer = header(alice, "my-github", "My GitHub", COMMUNITY, T0 + 100);
    expect(copyBy(alice.pk, COMMUNITY, [newer, sameD])?.id).toBe(sameD.id);
  });

  it("else the newest of the author's", () => {
    const older = header(alice, "gh-1", "GitHub 1", COMMUNITY);
    const newer = header(alice, "gh-2", "GitHub 2", COMMUNITY, T0 + 100);
    expect(copyBy(alice.pk, COMMUNITY, [older, newer])?.id).toBe(newer.id);
  });

  it("is null for no author, someone else's copy, or a header pointing elsewhere", () => {
    const bob = actor();
    const elsewhere = header(alice, "github-accounts", "GitHub Accounts", `39998:${bob.pk}:github-accounts`);
    const bobs = header(bob, "github-accounts", "GitHub Accounts", COMMUNITY);
    expect(copyBy(null, COMMUNITY, [bobs])).toBeNull();
    expect(copyBy(alice.pk, COMMUNITY, [bobs, elsewhere])).toBeNull();
  });
});

describe("resolveForReader", () => {
  const foodGroup = () => {
    const group = groupConcepts(food as HeaderEvent[]).groups.find((g) => g.root === FOOD);
    if (!group) throw new Error("Food is not a concept in the fixtures");
    return group;
  };
  const anonymous = { pubkey: null, taPubkey: null };

  it("reader null resolves to the house copy", () => {
    const resolved = resolveForReader(foodGroup(), anonymous, [REAL_HOUSE]);
    expect(resolved?.source).toBe("house");
    expect(resolved?.governing.event.pubkey).toBe(REAL_HOUSE);
    expect(resolved?.community?.coordinate).toBe(FOOD);
  });

  it("reader with own copy resolves personal", () => {
    const reader = "e5272de914bd301755c439b88e6959a43c9d2664831f093c51e9c799a16a102f";
    const resolved = resolveForReader(foodGroup(), { pubkey: reader, taPubkey: null }, [REAL_HOUSE]);
    expect(resolved?.source).toBe("personal");
    expect(resolved?.governing.event.pubkey).toBe(reader);
  });

  it("the reader's Assistant's copy comes before the house's", () => {
    const ta = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
    const reader = actor().pk; // no copy of their own
    const resolved = resolveForReader(foodGroup(), { pubkey: reader, taPubkey: ta }, [REAL_HOUSE]);
    expect(resolved?.source).toBe("assistant");
    expect(resolved?.governing.event.pubkey).toBe(ta);
  });

  it("with no copy that applies, the community header governs; a withdrawn header is no copy", () => {
    // 2efaa715… withdrew its Food header with ["b","b-tag-deferred"]: it is not a version of Food.
    const withdrawnBy = "2efaa715bbb46dd5be6b7da8d7700266d11674b913b8178addb5c2e63d987331";
    const resolved = resolveForReader(foodGroup(), { pubkey: withdrawnBy, taPubkey: null }, []);
    expect(resolved?.source).toBe("community");
    expect(resolved?.governing.coordinate).toBe(FOOD);
  });
});
