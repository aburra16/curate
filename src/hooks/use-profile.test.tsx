// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { Observable } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real profiles module (cache, TTL, batching) runs; only the relay pool
// is replaced by one that answers every request with a single kind 0 event.
const request = vi.fn();
vi.mock("@/lib/nostr/ndk", () => ({
  ensurePool: () => ({ pool: { request }, relays: ["wss://relay.test"] }),
}));

import { useProfile } from "@/hooks/use-profile";
import { fetchProfile, getCachedProfile } from "@/lib/nostr/profiles";

const MINUTE = 60 * 1000;
const TTL = 10 * MINUTE;

function answerWith(names: Record<string, string>) {
  request.mockImplementation(
    (_relays: string[], filter: { authors: string[] }) =>
      new Observable((sub) => {
        for (const pubkey of filter.authors) {
          if (!(pubkey in names)) continue;
          sub.next({
            kind: 0,
            pubkey,
            created_at: 1,
            content: JSON.stringify({ name: names[pubkey] }),
          });
        }
        sub.complete();
      }),
  );
}

/** Fetch through the real module so the real cache holds the profile. */
async function prime(pubkey: string) {
  const done = fetchProfile(pubkey);
  await vi.advanceTimersByTimeAsync(50);
  return done;
}

describe("useProfile", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
    request.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null without a pubkey and does not fetch", () => {
    const { result } = renderHook(() => useProfile(undefined));
    expect(result.current).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("paints a cached profile on the first render", async () => {
    answerWith({ aa: "Alice" });
    await prime("aa");
    expect(request).toHaveBeenCalledTimes(1);

    const { result } = renderHook(() => useProfile("aa"));
    expect(result.current?.name).toBe("Alice");
  });

  it("fetches an uncached profile, then returns it", async () => {
    answerWith({ bb: "Bob" });
    const { result } = renderHook(() => useProfile("bb"));
    expect(result.current).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(result.current?.name).toBe("Bob");
  });

  it("keeps showing a profile that was cached at mount after the cache TTL passes", async () => {
    answerWith({ cc: "Carol" });
    await prime("cc");

    const { result, rerender } = renderHook(() => useProfile("cc"));
    expect(result.current?.name).toBe("Carol");
    await act(() => vi.advanceTimersByTimeAsync(0));

    // Past the TTL the module cache drops the entry on the next lookup.
    await act(() => vi.advanceTimersByTimeAsync(TTL + MINUTE));
    expect(getCachedProfile("cc")).toBeUndefined();

    rerender();
    expect(result.current?.name).toBe("Carol");
    // It kept what it already had and made no further relay request.
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("never shows the previous pubkey's profile after the pubkey changes", async () => {
    answerWith({ dd: "Dana", ee: "Eli" });
    const { result, rerender } = renderHook(({ pk }) => useProfile(pk), {
      initialProps: { pk: "dd" as string | undefined },
    });
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(result.current?.name).toBe("Dana");

    rerender({ pk: "ee" });
    expect(result.current).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(result.current?.name).toBe("Eli");

    rerender({ pk: undefined });
    expect(result.current).toBeNull();
  });
});
