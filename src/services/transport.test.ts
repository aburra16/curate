import type { Filter, NostrEvent } from "nostr-tools";
import { RelayClosedError } from "applesauce-relay";
import { Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import foodHeader from "@/test/fixtures/food.header.json";

// The default transport runs for real; only the relay pool underneath it is
// replaced, by relays whose messages the test pushes by hand.
const relayOf = vi.fn();
vi.mock("@/lib/nostr/ndk", () => ({ getPool: () => ({ relay: relayOf }) }));

import { transport } from "@/services/transport";

const [event] = foodHeader as NostrEvent[];
const URL = "wss://relay.test";
const filters: Filter[] = [{ kinds: [39998] }];

interface MockRelay {
  messages: Subject<unknown>;
  count$: Subject<{ count: number }>;
  live$: Subject<NostrEvent | "EOSE">;
  req: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  subscription: ReturnType<typeof vi.fn>;
}

let relay: MockRelay;

beforeEach(() => {
  const messages = new Subject<unknown>();
  const count$ = new Subject<{ count: number }>();
  const live$ = new Subject<NostrEvent | "EOSE">();
  relay = {
    messages,
    count$,
    live$,
    req: vi.fn(() => messages.asObservable()),
    count: vi.fn(() => count$.asObservable()),
    subscription: vi.fn(() => live$.asObservable()),
  };
  relayOf.mockReset();
  relayOf.mockReturnValue(relay);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("transport().req", () => {
  it("sends events to the caller and ends on EOSE, closing the subscription", async () => {
    const got: NostrEvent[] = [];
    const ended = transport().req(URL, filters, (ev) => got.push(ev), 8000);

    relay.messages.next({ type: "OPEN", from: URL, id: "x", filters });
    relay.messages.next({ type: "EVENT", from: URL, id: "x", event });
    relay.messages.next({ type: "EOSE", from: URL, id: "x" });

    expect(await ended).toEqual({ state: "eose" });
    expect(got).toEqual([event]);
    expect(relayOf).toHaveBeenCalledWith(URL);
    expect(relay.messages.observed).toBe(false);
  });

  it("never waits for a sign-in: auth-required surfaces instead of retrying", async () => {
    void transport().req(URL, filters, () => {}, 8000);
    relay.messages.next({ type: "EOSE", from: URL, id: "x" });

    expect(relay.req).toHaveBeenCalledWith(filters, { waitForAuth: false });
  });

  it("reports a CLOSED the relay raises as an error, with its reason", async () => {
    const reason =
      "error: vespa searched only 67% of the corpus over 413412306 document(s); the response is a PARTIAL answer";
    const ended = transport().req(URL, filters, () => {}, 8000);

    relay.messages.error(new RelayClosedError(reason));

    expect(await ended).toEqual({ state: "closed", reason });
  });

  it("reports a plain CLOSED message (no error prefix) as closed", async () => {
    const ended = transport().req(URL, filters, () => {}, 8000);

    relay.messages.next({ type: "CLOSED", from: URL, id: "x", reason: "done" });
    relay.messages.complete();

    expect(await ended).toEqual({ state: "closed", reason: "done" });
  });

  it("reports any other failure as an error", async () => {
    const ended = transport().req(URL, filters, () => {}, 8000);

    relay.messages.error(new Error("WebSocket connection failed"));

    expect(await ended).toEqual({ state: "error", reason: "WebSocket connection failed" });
  });

  it("reports a stream that ends with no EOSE as an error", async () => {
    const ended = transport().req(URL, filters, () => {}, 8000);

    relay.messages.complete();

    expect(await ended).toEqual({ state: "error", reason: "the relay ended the request without EOSE" });
  });

  it("times out, closing the subscription, and ignores what arrives later", async () => {
    vi.useFakeTimers();
    const got: NostrEvent[] = [];
    const ended = transport().req(URL, filters, (ev) => got.push(ev), 8000);

    await vi.advanceTimersByTimeAsync(7999);
    relay.messages.next({ type: "EVENT", from: URL, id: "x", event });
    await vi.advanceTimersByTimeAsync(1);

    expect(await ended).toEqual({ state: "timeout" });
    expect(relay.messages.observed).toBe(false);
    expect(got).toEqual([event]);
  });

  it("reports a pool that throws as an error", async () => {
    relayOf.mockImplementation(() => {
      throw new Error("getPool() can only be called in the browser");
    });

    expect(await transport().req(URL, filters, () => {}, 8000)).toEqual({
      state: "error",
      reason: "getPool() can only be called in the browser",
    });
  });
});

describe("transport().count", () => {
  it("returns the relay's count", async () => {
    const answered = transport().count(URL, filters, 8000);

    relay.count$.next({ count: 7984 });
    relay.count$.complete();

    expect(await answered).toBe(7984);
    expect(relay.count).toHaveBeenCalledWith(filters);
  });

  it("returns null when the relay refuses", async () => {
    const answered = transport().count(URL, filters, 8000);

    relay.count$.error(new RelayClosedError("error: vespa searched only 67% of the corpus"));

    expect(await answered).toBeNull();
  });

  it("returns null when the relay closes without a count", async () => {
    const answered = transport().count(URL, filters, 8000);

    relay.count$.complete();

    expect(await answered).toBeNull();
  });

  it("returns null at the timeout", async () => {
    vi.useFakeTimers();
    const answered = transport().count(URL, filters, 8000);

    await vi.advanceTimersByTimeAsync(8000);

    expect(await answered).toBeNull();
    expect(relay.count$.observed).toBe(false);
  });
});

describe("transport().live", () => {
  it("passes events through, skips EOSE, and unsubscribes when stopped", () => {
    const got: NostrEvent[] = [];
    const stop = transport().live(URL, filters, (ev) => got.push(ev));

    relay.live$.next("EOSE");
    relay.live$.next(event);
    expect(got).toEqual([event]);
    expect(relay.subscription).toHaveBeenCalledWith(filters, { waitForAuth: false });

    stop();
    expect(relay.live$.observed).toBe(false);
  });

  it("swallows a relay failure instead of throwing into the page", () => {
    const stop = transport().live(URL, filters, () => {});

    expect(() => relay.live$.error(new RelayClosedError("error: refused"))).not.toThrow();
    stop();
  });
});
