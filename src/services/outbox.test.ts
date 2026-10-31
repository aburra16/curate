/**
 * The relays an author writes to, read from their kind 10002 on the profile
 * relays. A relay that is not theirs to add (the index, the tag hub, dcosl
 * itself) or not a secure address is never among them.
 */
import type { NostrEvent } from "nostr-tools";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeTransport, type FakeRelay } from "@/test/fakeTransport";
import { clearSeenOn } from "@/services/nostr";
import { clearOutboxCache, MAX_WRITE_RELAYS, writeRelaysOf } from "@/services/outbox";
import { DCOSL, INDEX, PROFILE_RELAYS, TAG_HUB } from "@/services/relays";
import { setTransport, type RelayTransport } from "@/services/transport";
import { useRelayStatus } from "@/stores/relay-status";

const T0 = 1_792_000_000;

const actor = () => {
  const sk = generateSecretKey();
  return { sk, pk: getPublicKey(sk) };
};

const CURATOR = actor();
const OTHER = actor();

/** A kind 10002 as a client publishes it: one `r` tag per relay, with an optional marker. */
const relayList = (who: ReturnType<typeof actor>, tags: string[][], created_at = T0): NostrEvent =>
  finalizeEvent({ kind: 10002, created_at, content: "", tags }, who.sk) as NostrEvent;

const answering = (events: NostrEvent[]): Record<string, FakeRelay> =>
  Object.fromEntries(PROFILE_RELAYS.map((relay) => [relay, { events, end: { state: "eose" } }]));

const failing = (): Record<string, FakeRelay> =>
  Object.fromEntries(
    PROFILE_RELAYS.map((relay) => [relay, { events: [], end: { state: "error", reason: "relays down" } }]),
  );

/** Counts the reads that reach the relays, answering from `script`. */
function counting(script: Record<string, FakeRelay>): { reads: () => number } {
  const inner = fakeTransport(script);
  let reads = 0;
  const t: RelayTransport = {
    ...inner,
    req(relay, filters, onEvent, timeoutMs) {
      reads += 1;
      return inner.req(relay, filters, onEvent, timeoutMs);
    },
  };
  setTransport(t);
  return { reads: () => reads };
}

beforeEach(() => {
  useRelayStatus.getState().reset();
  clearSeenOn();
  clearOutboxCache();
});

describe("writeRelaysOf", () => {
  it("takes write and unmarked r tags, never read ones", async () => {
    setTransport(
      fakeTransport(
        answering([
          relayList(CURATOR, [
            ["r", "wss://unmarked.example.test"],
            ["r", "wss://writes.example.test", "write"],
            ["r", "wss://reads.example.test", "read"],
          ]),
        ]),
      ),
    );
    expect(await writeRelaysOf(CURATOR.pk)).toEqual(["wss://unmarked.example.test", "wss://writes.example.test"]);
  });

  it("the newest 10002 wins", async () => {
    setTransport(
      fakeTransport({
        ...answering([relayList(CURATOR, [["r", "wss://old.example.test"]], T0)]),
        [PROFILE_RELAYS[1]]: {
          events: [relayList(CURATOR, [["r", "wss://new.example.test"]], T0 + 100)],
          end: { state: "eose" },
        },
      }),
    );
    expect(await writeRelaysOf(CURATOR.pk)).toEqual(["wss://new.example.test"]);
  });

  it("drops ws://, http, malformed, the index, the tag hub and dcosl", async () => {
    setTransport(
      fakeTransport(
        answering([
          relayList(CURATOR, [
            ["r", "ws://plain.example.test"],
            ["r", "https://web.example.test"],
            ["r", "wss://"],
            ["r", "wss:///"],
            ["r", "wss://SEARCH.brainstorm.world/"],
            ["r", "wss://tags.brainstorm.world/relay"],
            ["r", "wss://dcosl.brainstorm.world/"],
            ["r", "wss://mine.example.test"],
          ]),
        ]),
      ),
    );
    const relays = await writeRelaysOf(CURATOR.pk);
    expect(relays).toEqual(["wss://mine.example.test"]);
    // The constants the test spells out are the ones the app excludes.
    expect(relays).not.toContain(DCOSL);
    expect(relays).not.toContain(INDEX);
    expect(relays).not.toContain(TAG_HUB);
  });

  it("caps at MAX_WRITE_RELAYS in tag order, each once", async () => {
    setTransport(
      fakeTransport(
        answering([
          relayList(CURATOR, [
            ["r", "wss://one.example.test/"],
            ["r", "wss://two.example.test"],
            ["r", "wss://one.example.test"],
            ["r", "wss://three.example.test"],
            ["r", "wss://four.example.test"],
            ["r", "wss://five.example.test"],
            ["r", "wss://six.example.test"],
          ]),
        ]),
      ),
    );
    expect(MAX_WRITE_RELAYS).toBe(4);
    expect(await writeRelaysOf(CURATOR.pk)).toEqual([
      "wss://one.example.test",
      "wss://two.example.test",
      "wss://three.example.test",
      "wss://four.example.test",
    ]);
  });

  it("ignores a 10002 that a relay returns for someone else", async () => {
    setTransport(fakeTransport(answering([relayList(OTHER, [["r", "wss://theirs.example.test"]])])));
    expect(await writeRelaysOf(CURATOR.pk)).toEqual([]);
  });

  it("no answer is no relays, and is asked again next time", async () => {
    const down = counting(failing());
    expect(await writeRelaysOf(CURATOR.pk)).toEqual([]);
    expect(down.reads()).toBe(PROFILE_RELAYS.length);

    // The relays come back: the same author is read again, not taken for having none.
    setTransport(fakeTransport(answering([relayList(CURATOR, [["r", "wss://back.example.test"]])])));
    expect(await writeRelaysOf(CURATOR.pk)).toEqual(["wss://back.example.test"]);
  });

  it("a relay that answered with no 10002 means none, and is remembered", async () => {
    const asked = counting({
      ...failing(),
      [PROFILE_RELAYS[0]]: { events: [], end: { state: "eose" } },
    });
    expect(await writeRelaysOf(CURATOR.pk)).toEqual([]);
    const afterFirst = asked.reads();
    expect(await writeRelaysOf(CURATOR.pk)).toEqual([]);
    expect(asked.reads()).toBe(afterFirst);
  });

  it("remembers an author's relays for the session, and each author on their own", async () => {
    const asked = counting(
      answering([
        relayList(CURATOR, [["r", "wss://mine.example.test"]]),
        relayList(OTHER, [["r", "wss://theirs.example.test"]]),
      ]),
    );
    const first = await writeRelaysOf(CURATOR.pk);
    const afterFirst = asked.reads();
    expect(await writeRelaysOf(CURATOR.pk)).toEqual(first);
    expect(asked.reads()).toBe(afterFirst);

    expect(await writeRelaysOf(OTHER.pk)).toEqual(["wss://theirs.example.test"]);
    expect(asked.reads()).toBeGreaterThan(afterFirst);
  });

  it("shares one read between callers that ask while it is on its way", async () => {
    const asked = counting(answering([relayList(CURATOR, [["r", "wss://mine.example.test"]])]));
    const [a, b] = await Promise.all([writeRelaysOf(CURATOR.pk), writeRelaysOf(CURATOR.pk)]);
    expect(a).toEqual(["wss://mine.example.test"]);
    expect(b).toEqual(a);
    expect(asked.reads()).toBe(PROFILE_RELAYS.length);
  });

  it("hands each caller its own list, so one caller can't change what another is told", async () => {
    setTransport(fakeTransport(answering([relayList(CURATOR, [["r", "wss://mine.example.test"]])])));
    const first = await writeRelaysOf(CURATOR.pk);
    first.push("wss://added.example.test");
    expect(await writeRelaysOf(CURATOR.pk)).toEqual(["wss://mine.example.test"]);
  });

  it("clearOutboxCache makes the next call read again", async () => {
    setTransport(fakeTransport(answering([relayList(CURATOR, [["r", "wss://before.example.test"]])])));
    expect(await writeRelaysOf(CURATOR.pk)).toEqual(["wss://before.example.test"]);

    setTransport(fakeTransport(answering([relayList(CURATOR, [["r", "wss://after.example.test"]])])));
    expect(await writeRelaysOf(CURATOR.pk)).toEqual(["wss://before.example.test"]);
    clearOutboxCache();
    expect(await writeRelaysOf(CURATOR.pk)).toEqual(["wss://after.example.test"]);
  });
});
