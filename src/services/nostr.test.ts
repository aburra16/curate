import type { Filter, NostrEvent } from "nostr-tools";
import { getEventHash } from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import foodHeader from "@/test/fixtures/food.header.json";
import foodItems from "@/test/fixtures/food.items.json";
import tagsHeaders from "@/test/fixtures/tags.headers.json";
import { fakeTransport } from "@/test/fakeTransport";
import { useRelayStatus } from "@/stores/relay-status";
import { INDEX } from "@/services/relays";
import { setTransport } from "@/services/transport";
import {
  clearSeenOn,
  countIndex,
  readIndex,
  readIndexReporting,
  readRelays,
  readRelaysReporting,
  seenOn,
  subscribeLive,
} from "@/services/nostr";

const DCOSL = "wss://dcosl.brainstorm.world";
const SLOW = "wss://slow.example.test";
const EXTRA = "wss://extra.example.test";

const [header] = foodHeader as NostrEvent[];
const [itemA, itemB, itemC] = foodItems as NostrEvent[];
const [tagA, tagB] = tagsHeaders as NostrEvent[];

const VESPA_REFUSAL =
  "error: vespa searched only 67% of the corpus over 413412306 document(s) (full: false, coverage 0.67); " +
  "the response is a PARTIAL answer, not a small one, so it is refused rather than returned.";

const ids = (events: NostrEvent[]) => events.map((e) => e.id).sort();

/** A copy as it would arrive off the wire. A spread would also copy nostr-tools' "already verified" mark. */
const tampered = (ev: NostrEvent): NostrEvent =>
  JSON.parse(JSON.stringify({ ...ev, content: ev.content + " (edited after signing)" }));

/** An event with a correct id and a signature that doesn't verify, whose id nobody has sent before. */
const generateUnsigned = (): NostrEvent => {
  const unsigned = {
    kind: 39999,
    pubkey: itemA.pubkey,
    created_at: 1_792_000_000,
    content: `never signed ${Math.random()}`,
    tags: [["d", "x"]],
  };
  return { ...unsigned, id: getEventHash(unsigned), sig: "0".repeat(128) };
};

beforeEach(() => {
  useRelayStatus.getState().reset();
  clearSeenOn();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("readRelays", () => {
  it("waits for the slow relay", async () => {
    vi.useFakeTimers();
    setTransport(
      fakeTransport({
        [DCOSL]: { events: [header, itemA], end: { state: "eose" } },
        [SLOW]: { events: [itemB], end: { state: "eose" }, delayMs: 3000 },
      }),
    );

    let settled = false;
    const read = readRelays([DCOSL, SLOW], [{ kinds: [39998, 39999] }], 8000).then((events) => {
      settled = true;
      return events;
    });

    // The fast relay has ended; the read still holds for the slow one.
    await vi.advanceTimersByTimeAsync(2900);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    const events = await read;
    expect(settled).toBe(true);
    expect(ids(events)).toEqual(ids([header, itemA, itemB]));
  });

  it("gives up on a relay at its timeout and keeps what the others returned", async () => {
    vi.useFakeTimers();
    setTransport(
      fakeTransport({
        [DCOSL]: { events: [header], end: { state: "eose" } },
        [SLOW]: { events: [itemB], end: { state: "eose" }, delayMs: 20_000 },
      }),
    );

    const read = readRelays([DCOSL, SLOW], [{ kinds: [39998] }], 8000);
    await vi.advanceTimersByTimeAsync(8000);

    expect(ids(await read)).toEqual([header.id]);
    const { statuses } = useRelayStatus.getState();
    expect(statuses[DCOSL]).toBe("ok");
    expect(statuses[SLOW]).toBe("timeout");
  });

  it("returns an event once when two relays send it, and names both relays", async () => {
    setTransport(
      fakeTransport({
        [DCOSL]: { events: [header, itemA], end: { state: "eose" } },
        [EXTRA]: { events: [itemA, itemB], end: { state: "eose" } },
      }),
    );

    const events = await readRelays([DCOSL, EXTRA], [{ kinds: [39998, 39999] }]);

    expect(ids(events)).toEqual(ids([header, itemA, itemB]));
    expect(seenOn(itemA.id).sort()).toEqual([DCOSL, EXTRA].sort());
  });

  it("drops events that fail signature verification", async () => {
    const forged = tampered(itemA);
    setTransport(
      fakeTransport({
        [DCOSL]: { events: [forged, itemB], end: { state: "eose" } },
      }),
    );

    const events = await readRelays([DCOSL], [{ kinds: [39999] }]);

    expect(ids(events)).toEqual([itemB.id]);
    expect(seenOn(forged.id)).toEqual([]);
  });

  it("records each relay's outcome, and the reason a relay refused", async () => {
    setTransport(
      fakeTransport({
        [DCOSL]: { events: [header], end: { state: "eose" } },
        [EXTRA]: { events: [], end: { state: "error", reason: "connection refused" } },
      }),
    );

    await readRelays([DCOSL, EXTRA], [{ kinds: [39998] }]);

    const { statuses, reasons } = useRelayStatus.getState();
    expect(statuses[DCOSL]).toBe("ok");
    expect(statuses[EXTRA]).toBe("error");
    expect(reasons[EXTRA]).toBe("connection refused");
    expect(reasons[DCOSL]).toBeUndefined();
  });

  it("treats a transport that throws as that relay erroring, not as a failed read", async () => {
    const good = fakeTransport({ [DCOSL]: { events: [header], end: { state: "eose" } } });
    setTransport({
      ...good,
      req(relay, filters, onEvent, timeoutMs) {
        if (relay === EXTRA) return Promise.reject(new Error("socket exploded"));
        return good.req(relay, filters, onEvent, timeoutMs);
      },
    });

    const events = await readRelays([DCOSL, EXTRA], [{ kinds: [39998] }]);

    expect(ids(events)).toEqual([header.id]);
    expect(useRelayStatus.getState().statuses[EXTRA]).toBe("error");
    expect(useRelayStatus.getState().reasons[EXTRA]).toBe("socket exploded");
  });

  it("asks a relay listed twice once", async () => {
    const transport = fakeTransport({ [DCOSL]: { events: [header], end: { state: "eose" } } });
    const req = vi.spyOn(transport, "req");
    setTransport(transport);

    await readRelays([DCOSL, DCOSL], [{ kinds: [39998] }]);

    expect(req).toHaveBeenCalledTimes(1);
  });
});

describe("readRelaysReporting", () => {
  it("says how each relay ended, how many events it sent and how many passed, and the oldest", async () => {
    vi.useFakeTimers();
    setTransport(
      fakeTransport({
        [DCOSL]: { events: [itemA, itemB], end: { state: "eose" } },
        [EXTRA]: { events: [itemB], end: { state: "error", reason: "the connection dropped" } },
        [SLOW]: { events: [itemC], end: { state: "eose" }, delayMs: 20_000 },
      }),
    );

    const reading = readRelaysReporting([DCOSL, EXTRA, SLOW], [{ kinds: [39999] }], 1000);
    await vi.advanceTimersByTimeAsync(1000);
    const { events, outcomes } = await reading;

    expect(ids(events)).toEqual(ids([itemA, itemB]));
    expect(outcomes).toEqual({
      [DCOSL]: { end: { state: "eose" }, sent: 2, received: 2, oldest: Math.min(itemA.created_at, itemB.created_at) },
      [EXTRA]: { end: { state: "error", reason: "the connection dropped" }, sent: 1, received: 1, oldest: itemB.created_at },
      [SLOW]: { end: { state: "timeout" }, sent: 0, received: 0, oldest: null },
    });
  });

  it("receives only events that pass the signature check, and counts every one sent, as a relay's cap does", async () => {
    setTransport(fakeTransport({ [DCOSL]: { events: [tampered(itemA), itemB], end: { state: "eose" } } }));

    const { outcomes } = await readRelaysReporting([DCOSL], [{ kinds: [39999] }]);

    expect(outcomes[DCOSL]).toEqual({ end: { state: "eose" }, sent: 2, received: 1, oldest: itemB.created_at });
  });

  it("the index's part carries include:spam, and says how the index ended", async () => {
    const asked: Filter[][] = [];
    const base = fakeTransport({ [INDEX]: { events: [], end: { state: "closed", reason: VESPA_REFUSAL } } });
    setTransport({
      ...base,
      req(relay, filters, onEvent, timeoutMs) {
        asked.push(filters);
        return base.req(relay, filters, onEvent, timeoutMs);
      },
    });

    const { events, outcomes } = await readIndexReporting([{ kinds: [39999] }]);

    expect(events).toEqual([]);
    expect(outcomes[INDEX].end).toEqual({ state: "closed", reason: VESPA_REFUSAL });
    expect(asked).toEqual([[{ kinds: [39999], search: "include:spam" }]]);
  });
});

describe("the signature check", () => {
  it("checks an event's signature once: a later copy is taken by its id, an altered one is not", async () => {
    setTransport(fakeTransport({ [DCOSL]: { events: [header], end: { state: "eose" } } }));
    await readRelays([DCOSL], [{ kinds: [39998] }]);

    // Off the wire again, with its signature spoiled: the id still proves the content the checked signature covers.
    const copy: NostrEvent = JSON.parse(JSON.stringify({ ...header, sig: "0".repeat(128) }));
    const altered = tampered(header);
    setTransport(fakeTransport({ [EXTRA]: { events: [altered, copy], end: { state: "eose" } } }));

    const events = await readRelays([EXTRA], [{ kinds: [39998] }]);

    expect(events).toHaveLength(1);
    expect(events[0].content).toBe(header.content);
  });

  it("a later copy with a spoiled signature is handed over carrying the checked one, read or live", async () => {
    setTransport(fakeTransport({ [DCOSL]: { events: [itemC], end: { state: "eose" } } }));
    await readRelays([DCOSL], [{ kinds: [39999] }]);

    const spoiled: NostrEvent = JSON.parse(JSON.stringify({ ...itemC, sig: "0".repeat(128) }));
    setTransport(fakeTransport({ [EXTRA]: { events: [spoiled], end: { state: "eose" } } }));

    const [read] = await readRelays([EXTRA], [{ kinds: [39999] }]);
    expect(read.sig).toBe(itemC.sig);
    expect(JSON.stringify(read)).toBe(JSON.stringify(itemC));

    const live: NostrEvent[] = [];
    const stop = subscribeLive([EXTRA], [{ kinds: [39999] }], (ev) => live.push(ev));
    await Promise.resolve();
    stop();
    expect(live.map((ev) => ev.sig)).toEqual([itemC.sig]);
  });

  it("an event never seen before still needs a good signature", async () => {
    const unsigned = generateUnsigned();
    setTransport(fakeTransport({ [DCOSL]: { events: [unsigned], end: { state: "eose" } } }));
    expect(await readRelays([DCOSL], [{ kinds: [39999] }])).toEqual([]);
  });
});

describe("readIndex", () => {
  it("index CLOSED is reported and returns no events", async () => {
    setTransport(
      fakeTransport({
        [INDEX]: { events: [], end: { state: "closed", reason: VESPA_REFUSAL } },
      }),
    );

    const events = await readIndex([{ kinds: [39998] }]);

    expect(events).toEqual([]);
    const { statuses, reasons } = useRelayStatus.getState();
    expect(statuses[INDEX]).toBe("closed");
    expect(reasons[INDEX]).toContain("vespa searched only 67%");
  });

  it("readIndex adds include:spam", async () => {
    const transport = fakeTransport({
      [INDEX]: { events: [header], end: { state: "eose" } },
    });
    const req = vi.spyOn(transport, "req");
    setTransport(transport);

    const bare: Filter = { kinds: [39998], limit: 5 };
    const searching: Filter = { kinds: [39998], search: "pizza" };
    const events = await readIndex([bare, searching]);

    expect(ids(events)).toEqual([header.id]);
    const sent = req.mock.calls[0];
    expect(sent[0]).toBe(INDEX);
    expect(sent[1]).toEqual([
      { kinds: [39998], limit: 5, search: "include:spam" },
      { kinds: [39998], search: "pizza include:spam" },
    ]);
    // The caller's filters are not rewritten.
    expect(bare).toEqual({ kinds: [39998], limit: 5 });
    expect(searching).toEqual({ kinds: [39998], search: "pizza" });
  });

  it("does not add the token twice", async () => {
    const transport = fakeTransport({ [INDEX]: { events: [], end: { state: "eose" } } });
    const req = vi.spyOn(transport, "req");
    setTransport(transport);

    await readIndex([{ kinds: [39998], search: "pizza include:spam" }]);

    expect(req.mock.calls[0][1]).toEqual([{ kinds: [39998], search: "pizza include:spam" }]);
  });
});

describe("countIndex", () => {
  it("countIndex returns null when refused", async () => {
    setTransport(
      fakeTransport({
        [INDEX]: { events: [], end: { state: "closed", reason: VESPA_REFUSAL }, count: 7984 },
      }),
    );

    expect(await countIndex([{ kinds: [39999], "#z": ["39998:abc:food"] }])).toBeNull();
  });

  it("returns the count, asking with the search token", async () => {
    const transport = fakeTransport({
      [INDEX]: { events: [], end: { state: "eose" }, count: 7984 },
    });
    const count = vi.spyOn(transport, "count");
    setTransport(transport);

    expect(await countIndex([{ kinds: [39999], "#z": ["39998:abc:food"] }])).toBe(7984);
    expect(count.mock.calls[0][0]).toBe(INDEX);
    expect(count.mock.calls[0][1]).toEqual([
      { kinds: [39999], "#z": ["39998:abc:food"], search: "include:spam" },
    ]);
  });

  it("returns null when the transport throws", async () => {
    setTransport({
      ...fakeTransport({}),
      count: () => Promise.reject(new Error("socket exploded")),
    });

    expect(await countIndex([{ kinds: [39999] }])).toBeNull();
  });
});

describe("seenOn", () => {
  it("seenOn names each relay that returned the event", async () => {
    setTransport(
      fakeTransport({
        [DCOSL]: { events: [itemA, itemB], end: { state: "eose" } },
        [INDEX]: { events: [itemB, itemC], end: { state: "eose" } },
        [EXTRA]: { events: [itemB], end: { state: "eose" } },
      }),
    );

    await readRelays([DCOSL, EXTRA], [{ kinds: [39999] }]);
    await readIndex([{ kinds: [39999] }]);

    expect(seenOn(itemA.id)).toEqual([DCOSL]);
    expect(seenOn(itemB.id).sort()).toEqual([DCOSL, EXTRA, INDEX].sort());
    expect(seenOn(itemC.id)).toEqual([INDEX]);
  });

  it("is empty for an event no relay returned", () => {
    expect(seenOn("f".repeat(64))).toEqual([]);
  });
});

describe("subscribeLive", () => {
  it("delivers each verified event once, and stops when unsubscribed", async () => {
    const forged = tampered(tagB);
    setTransport(
      fakeTransport({
        [DCOSL]: { events: [tagA, forged], end: { state: "eose" } },
        [EXTRA]: { events: [tagA], end: { state: "eose" } },
      }),
    );

    const got: string[] = [];
    const stop = subscribeLive([DCOSL, EXTRA], [{ kinds: [39998] }], (ev) => got.push(ev.id));
    await Promise.resolve();

    expect(got).toEqual([tagA.id]);
    expect(seenOn(tagA.id).sort()).toEqual([DCOSL, EXTRA].sort());
    stop();
  });

  it("delivers nothing after the caller unsubscribes", async () => {
    setTransport(fakeTransport({ [DCOSL]: { events: [tagA], end: { state: "eose" } } }));

    const got: string[] = [];
    const stop = subscribeLive([DCOSL], [{ kinds: [39998] }], (ev) => got.push(ev.id));
    stop();
    await Promise.resolve();

    expect(got).toEqual([]);
  });
});
