/**
 * A list is read from the index and from the hub (dcosl, plus any relay the
 * reader added) at once, and the answers merged: the index can lag and the hub
 * can be slow. Whichever side answers first is handed over at once (`onFirst`),
 * so a list of heavy records shows from the faster relay instead of waiting for
 * the slower one, and the merged answer still follows.
 */
import type { Filter, NostrEvent } from "nostr-tools";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import foodHeader from "@/test/fixtures/food.header.json";
import foodItems from "@/test/fixtures/food.items.json";
import { fakeTransport } from "@/test/fakeTransport";
import { DEFAULT_RELAYS } from "@/lib/curate/relayUrls";
import { clearSeenOn, seenOn } from "@/services/nostr";
import { DCOSL, INDEX } from "@/services/relays";
import { setTransport, type RelayTransport } from "@/services/transport";
import { useRelayStatus } from "@/stores/relay-status";
import { useSettings } from "@/stores/settings";
import { readListEvents } from "@/services/listReads";

const EXTRA = "wss://extra.example.test";

const [header] = foodHeader as NostrEvent[];
const [itemA, itemB, itemC] = foodItems as NostrEvent[];

const VESPA_REFUSAL =
  "error: vespa searched only 67% of the corpus over 413412306 document(s) (full: false, coverage 0.67); " +
  "the response is a PARTIAL answer, not a small one, so it is refused rather than returned.";

const ids = (events: NostrEvent[]) => events.map((e) => e.id).sort();

/** A deleted item as an app overwrites it: signed, but with nothing in it (lib/blankEvent). */
const blank = finalizeEvent(
  { kind: 39999, created_at: 1_792_000_000, content: "", tags: [["d", "gone"], ["deleted", "true"]] },
  generateSecretKey(),
) as NostrEvent;

const ALL_KINDS: Filter[] = [{ kinds: [39998, 39999] }];

beforeEach(() => {
  useRelayStatus.getState().reset();
  useSettings.setState({ relays: [...DEFAULT_RELAYS] });
  clearSeenOn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("readListEvents", () => {
  it("hands over the first side's answer at once, then the two merged", async () => {
    vi.useFakeTimers();
    setTransport(
      fakeTransport({
        [DCOSL]: { events: [itemA, itemB], end: { state: "eose" }, delayMs: 100 },
        [INDEX]: { events: [itemB, itemC], end: { state: "eose" }, delayMs: 1000 },
      }),
    );
    const first = vi.fn();
    let settled = false;
    const all = readListEvents(ALL_KINDS, { onFirst: first }).then((events) => {
      settled = true;
      return events;
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(first).toHaveBeenCalledTimes(1);
    expect(ids(first.mock.calls[0][0])).toEqual(ids([itemA, itemB]));
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(900);
    expect(ids(await all)).toEqual(ids([itemA, itemB, itemC]));
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("hands the index's answer over first when the index is the faster side", async () => {
    vi.useFakeTimers();
    setTransport(
      fakeTransport({
        [INDEX]: { events: [itemC], end: { state: "eose" }, delayMs: 50 },
        [DCOSL]: { events: [itemA], end: { state: "eose" }, delayMs: 500 },
      }),
    );
    const first = vi.fn();
    const all = readListEvents(ALL_KINDS, { onFirst: first });

    await vi.advanceTimersByTimeAsync(50);
    expect(ids(first.mock.calls[0][0])).toEqual([itemC.id]);

    await vi.advanceTimersByTimeAsync(450);
    expect(ids(await all)).toEqual(ids([itemA, itemC]));
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("hands nothing over early from a side that answers with nothing", async () => {
    vi.useFakeTimers();
    setTransport(
      fakeTransport({
        [INDEX]: { events: [], end: { state: "eose" }, delayMs: 50 },
        [DCOSL]: { events: [itemA], end: { state: "eose" }, delayMs: 500 },
      }),
    );
    const first = vi.fn();
    const all = readListEvents(ALL_KINDS, { onFirst: first });

    await vi.advanceTimersByTimeAsync(50);
    expect(first).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(450);
    await all;
    expect(first.mock.calls.map((c) => c[0].length)).toEqual([1]);
  });

  it("merges the two sides by id and keeps each event once", async () => {
    setTransport(
      fakeTransport({
        [DCOSL]: { events: [header, itemA, itemB], end: { state: "eose" } },
        [INDEX]: { events: [itemB, itemC, header], end: { state: "eose" } },
      }),
    );

    const events = await readListEvents(ALL_KINDS);

    expect(events).toHaveLength(4);
    expect(ids(events)).toEqual(ids([header, itemA, itemB, itemC]));
    // Both relays returned itemB, and the read remembers it.
    expect(seenOn(itemB.id).sort()).toEqual([DCOSL, INDEX].sort());
    expect(seenOn(itemA.id)).toEqual([DCOSL]);
    expect(seenOn(itemC.id)).toEqual([INDEX]);
  });

  it("lists still load when the index refuses", async () => {
    setTransport(
      fakeTransport({
        [INDEX]: { events: [], end: { state: "closed", reason: VESPA_REFUSAL } },
        [DCOSL]: { events: [header], end: { state: "eose" } },
      }),
    );

    const events = await readListEvents([{ kinds: [39998], "#d": ["food-and-drink-places"] }]);

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(header.id);
    const { statuses, reasons } = useRelayStatus.getState();
    expect(statuses[INDEX]).toBe("closed");
    expect(reasons[INDEX]).toBe(VESPA_REFUSAL);
    expect(statuses[DCOSL]).toBe("ok");
  });

  it("blank events are dropped", async () => {
    setTransport(
      fakeTransport({
        [INDEX]: { events: [blank, itemA], end: { state: "eose" } },
        [DCOSL]: { events: [blank, itemB], end: { state: "eose" } },
      }),
    );

    const events = await readListEvents(ALL_KINDS);

    expect(ids(events)).toEqual(ids([itemA, itemB]));
    expect(events.map((e) => e.id)).not.toContain(blank.id);
  });

  it("does not hand a blank event over early", async () => {
    vi.useFakeTimers();
    setTransport(
      fakeTransport({
        [INDEX]: { events: [blank], end: { state: "eose" }, delayMs: 50 },
        [DCOSL]: { events: [blank, itemA], end: { state: "eose" }, delayMs: 500 },
      }),
    );
    const first = vi.fn();
    const all = readListEvents(ALL_KINDS, { onFirst: first });

    // The index answered, but with a husk only: nothing to show yet.
    await vi.advanceTimersByTimeAsync(50);
    expect(first).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(450);
    await all;
    expect(first).toHaveBeenCalledTimes(1);
    expect(ids(first.mock.calls[0][0])).toEqual([itemA.id]);
  });

  it("keeps the hub's events when the index fails", async () => {
    for (const end of [
      { state: "error", reason: "the connection failed" },
      { state: "timeout" },
    ] as const) {
      useRelayStatus.getState().reset();
      setTransport(
        fakeTransport({
          [INDEX]: { events: [], end },
          [DCOSL]: { events: [itemA], end: { state: "eose" } },
        }),
      );

      expect(ids(await readListEvents(ALL_KINDS))).toEqual([itemA.id]);
      expect(useRelayStatus.getState().statuses[INDEX]).toBe(end.state);
    }
  });

  it("keeps the index's events when the hub fails", async () => {
    setTransport(
      fakeTransport({
        [INDEX]: { events: [itemC], end: { state: "eose" } },
        [DCOSL]: { events: [], end: { state: "error", reason: "the connection failed" } },
      }),
    );

    expect(ids(await readListEvents(ALL_KINDS))).toEqual([itemC.id]);
    expect(useRelayStatus.getState().statuses[DCOSL]).toBe("error");
  });

  it("keeps the other side when one side's read throws", async () => {
    setTransport(
      fakeTransport({
        [INDEX]: { events: [itemC], end: { state: "eose" } },
        [DCOSL]: { events: [itemA], end: { state: "eose" } },
      }),
    );
    // Reporting the index's outcome blows up, which would reject the index's read.
    const { report } = useRelayStatus.getState();
    vi.spyOn(useRelayStatus.getState(), "report").mockImplementation((relay, end) => {
      if (relay === INDEX) throw new Error("status store failed");
      report(relay, end);
    });

    expect(ids(await readListEvents(ALL_KINDS))).toEqual([itemA.id]);
  });

  it("keeps what each side returned when the first to end carries events and the other times out", async () => {
    vi.useFakeTimers();
    setTransport(
      fakeTransport({
        [DCOSL]: { events: [itemA], end: { state: "eose" } },
        [INDEX]: { events: [itemB], end: { state: "eose" }, delayMs: 20_000 },
      }),
    );
    const first = vi.fn();
    const all = readListEvents(ALL_KINDS, { timeoutMs: 2000, onFirst: first });

    await vi.advanceTimersByTimeAsync(2000);

    expect(ids(await all)).toEqual([itemA.id]);
    expect(first).toHaveBeenCalledTimes(1);
    expect(useRelayStatus.getState().statuses[INDEX]).toBe("timeout");
  });

  it("asks the index with include:spam and the hub with the filters as given", async () => {
    const asked: Record<string, Filter[]> = {};
    const base = fakeTransport({
      [INDEX]: { events: [], end: { state: "eose" } },
      [DCOSL]: { events: [], end: { state: "eose" } },
    });
    const recording: RelayTransport = {
      ...base,
      req(relay, filters, onEvent, timeoutMs) {
        asked[relay] = filters;
        return base.req(relay, filters, onEvent, timeoutMs);
      },
    };
    setTransport(recording);
    const filters: Filter[] = [{ kinds: [39999], "#z": ["39998:b83a:food"], limit: 500 }];

    await readListEvents(filters);

    expect(asked[INDEX]).toEqual([{ ...filters[0], search: "include:spam" }]);
    expect(asked[DCOSL]).toEqual(filters);
  });

  it("reads the relays the reader added as well as dcosl", async () => {
    useSettings.setState({ relays: [...DEFAULT_RELAYS, EXTRA] });
    setTransport(
      fakeTransport({
        [INDEX]: { events: [], end: { state: "eose" } },
        [DCOSL]: { events: [itemA], end: { state: "eose" } },
        [EXTRA]: { events: [itemB], end: { state: "eose" } },
      }),
    );

    expect(ids(await readListEvents(ALL_KINDS))).toEqual(ids([itemA, itemB]));
    expect(seenOn(itemB.id)).toEqual([EXTRA]);
  });

  it("passes the timeout to both sides", async () => {
    vi.useFakeTimers();
    setTransport(
      fakeTransport({
        [INDEX]: { events: [itemA], end: { state: "eose" }, delayMs: 3000 },
        [DCOSL]: { events: [itemB], end: { state: "eose" }, delayMs: 3000 },
      }),
    );

    const all = readListEvents(ALL_KINDS, { timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);

    expect(await all).toEqual([]);
    const { statuses } = useRelayStatus.getState();
    expect(statuses[INDEX]).toBe("timeout");
    expect(statuses[DCOSL]).toBe("timeout");
  });

  it("asks nothing when there are no filters", async () => {
    const req = vi.fn();
    setTransport({ req, count: vi.fn(), live: vi.fn(), publish: vi.fn() });

    expect(await readListEvents([])).toEqual([]);
    expect(req).not.toHaveBeenCalled();
  });
});
