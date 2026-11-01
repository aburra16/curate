// @vitest-environment jsdom
/** The state of a write: one at a time, what the relays said, and Retry. */
import { act, renderHook } from "@testing-library/react";
import type { EventTemplate, NostrEvent } from "nostr-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DCOSL } from "@/services/relays";
import { SignerError } from "@/services/signer";
import type { PublishResult } from "@/services/publish";

vi.mock("@/services/publish", () => ({ signAndPublish: vi.fn(), retryPublish: vi.fn() }));

import { useWrite } from "@/hooks/use-write";
import { retryPublish, signAndPublish } from "@/services/publish";

const OWN = "wss://own.example.test";

const TEMPLATE: EventTemplate = { kind: 1, content: "hello", tags: [], created_at: 0 };

const EVENT: NostrEvent = {
  id: "e".repeat(64),
  pubkey: "c".repeat(64),
  created_at: 1_792_000_000,
  kind: 1,
  tags: [],
  content: "hello",
  sig: "5".repeat(128),
};

const saved: PublishResult = { event: EVENT, onHub: true, hubMessage: null, accepted: [DCOSL], failed: [] };

const refusedBy = (message: string): PublishResult => ({
  event: EVENT,
  onHub: false,
  hubMessage: message,
  accepted: [OWN],
  failed: [{ ok: false, from: DCOSL, message }],
});

/** A publish that stays in flight until the test finishes it. */
function inFlight(): { finish: (result: PublishResult) => void } {
  let finish: (result: PublishResult) => void = () => {};
  vi.mocked(signAndPublish).mockReturnValueOnce(
    new Promise<PublishResult>((resolve) => {
      finish = resolve;
    }),
  );
  return { finish: (result) => finish(result) };
}

beforeEach(() => {
  vi.mocked(signAndPublish).mockReset();
  vi.mocked(retryPublish).mockReset();
});

describe("useWrite", () => {
  it("starts idle", () => {
    const { result } = renderHook(() => useWrite());

    expect(result.current.state).toEqual({ phase: "idle" });
    expect(result.current.busy).toBe(false);
  });

  it("is working while the write is in flight, then done with what the relays said", async () => {
    const write = inFlight();
    const { result } = renderHook(() => useWrite());

    let pending: Promise<PublishResult | null> = Promise.resolve(null);
    act(() => {
      pending = result.current.write(TEMPLATE);
    });
    expect(result.current.state).toEqual({ phase: "working" });
    expect(result.current.busy).toBe(true);
    expect(signAndPublish).toHaveBeenCalledWith(TEMPLATE);

    await act(async () => write.finish(saved));

    expect(await pending).toBe(saved);
    expect(result.current.state).toEqual({ phase: "done", result: saved });
    expect(result.current.busy).toBe(false);
  });

  it("a second write while one is in flight signs nothing", async () => {
    const write = inFlight();
    const { result } = renderHook(() => useWrite());

    // Both calls come from the same render, before React has shown `busy`.
    let first: Promise<PublishResult | null> = Promise.resolve(null);
    let second: Promise<PublishResult | null> = Promise.resolve(saved);
    act(() => {
      first = result.current.write(TEMPLATE);
      second = result.current.write(TEMPLATE);
    });

    expect(signAndPublish).toHaveBeenCalledTimes(1);
    await act(async () => write.finish(saved));
    expect(await second).toBeNull();
    expect(await first).toBe(saved);
    expect(signAndPublish).toHaveBeenCalledTimes(1);
  });

  it("a signer error shows its message, and the next write goes ahead", async () => {
    vi.mocked(signAndPublish).mockRejectedValueOnce(
      new SignerError("refused", "The signer didn't sign: User rejected the request"),
    );
    vi.mocked(signAndPublish).mockResolvedValueOnce(saved);
    const { result } = renderHook(() => useWrite());

    let first: PublishResult | null = saved;
    await act(async () => {
      first = await result.current.write(TEMPLATE);
    });

    expect(first).toBeNull();
    expect(result.current.state).toEqual({
      phase: "error",
      message: "The signer didn't sign: User rejected the request",
      reason: "refused",
    });
    expect(result.current.busy).toBe(false);

    await act(async () => {
      await result.current.write(TEMPLATE);
    });
    expect(result.current.state).toEqual({ phase: "done", result: saved });
  });

  it("an error that isn't the signer's reads as plain words, not the error's own", async () => {
    vi.mocked(signAndPublish).mockRejectedValueOnce(new TypeError("Cannot read properties of undefined"));
    const { result } = renderHook(() => useWrite());

    await act(async () => {
      await result.current.write(TEMPLATE);
    });

    expect(result.current.state).toStrictEqual({
      phase: "error",
      message: "Something went wrong, and the write may not have been saved.",
    });
    expect(result.current.busy).toBe(false);
  });

  it("Retry resends the same event", async () => {
    const first = refusedBy("blocked: not allowed");
    vi.mocked(signAndPublish).mockResolvedValueOnce(first);
    vi.mocked(retryPublish).mockResolvedValueOnce(saved);
    const { result } = renderHook(() => useWrite());
    await act(async () => {
      await result.current.write(TEMPLATE);
    });

    let again: PublishResult | null = null;
    await act(async () => {
      again = await result.current.retry();
    });

    expect(retryPublish).toHaveBeenCalledTimes(1);
    expect(retryPublish).toHaveBeenCalledWith(first);
    expect(signAndPublish).toHaveBeenCalledTimes(1);
    expect(again).toBe(saved);
    expect(result.current.state).toEqual({ phase: "done", result: saved });
  });

  it("keeps the last answer on show, and busy, while Retry is in flight", async () => {
    const first = refusedBy("blocked: not allowed");
    vi.mocked(signAndPublish).mockResolvedValueOnce(first);
    let finish: (result: PublishResult) => void = () => {};
    vi.mocked(retryPublish).mockReturnValueOnce(
      new Promise<PublishResult>((resolve) => {
        finish = resolve;
      }),
    );
    const { result } = renderHook(() => useWrite());
    await act(async () => {
      await result.current.write(TEMPLATE);
    });

    let pending: Promise<PublishResult | null> = Promise.resolve(null);
    act(() => {
      pending = result.current.retry();
    });
    expect(result.current.busy).toBe(true);
    expect(result.current.state).toEqual({ phase: "done", result: first });

    await act(async () => finish(saved));
    await pending;
    expect(result.current.busy).toBe(false);
    expect(result.current.state).toEqual({ phase: "done", result: saved });
  });

  it("a second Retry in the same tick sends once", async () => {
    vi.mocked(signAndPublish).mockResolvedValueOnce(refusedBy("blocked: not allowed"));
    vi.mocked(retryPublish).mockResolvedValueOnce(saved);
    const { result } = renderHook(() => useWrite());
    await act(async () => {
      await result.current.write(TEMPLATE);
    });

    let second: Promise<PublishResult | null> = Promise.resolve(saved);
    await act(async () => {
      const first = result.current.retry();
      second = result.current.retry();
      await first;
    });

    expect(retryPublish).toHaveBeenCalledTimes(1);
    expect(await second).toBeNull();
  });

  it("Retry after another refusal resends the newest answer", async () => {
    const first = refusedBy("blocked: not allowed");
    const second = refusedBy("rate-limited: slow down");
    vi.mocked(signAndPublish).mockResolvedValueOnce(first);
    vi.mocked(retryPublish).mockResolvedValueOnce(second).mockResolvedValueOnce(saved);
    const { result } = renderHook(() => useWrite());
    await act(async () => {
      await result.current.write(TEMPLATE);
    });

    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.state).toEqual({ phase: "done", result: second });
    await act(async () => {
      await result.current.retry();
    });

    expect(vi.mocked(retryPublish).mock.calls).toEqual([[first], [second]]);
    expect(result.current.state).toEqual({ phase: "done", result: saved });
  });

  it("has nothing to retry before a write, after a save, or after reset", async () => {
    const { result } = renderHook(() => useWrite());
    let outcome: PublishResult | null = saved;

    await act(async () => {
      outcome = await result.current.retry();
    });
    expect(outcome).toBeNull();

    vi.mocked(signAndPublish).mockResolvedValueOnce(saved);
    await act(async () => {
      await result.current.write(TEMPLATE);
      outcome = await result.current.retry();
    });
    expect(outcome).toBeNull();

    vi.mocked(signAndPublish).mockResolvedValueOnce(refusedBy("blocked: not allowed"));
    await act(async () => {
      await result.current.write(TEMPLATE);
    });
    act(() => result.current.reset());
    expect(result.current.state).toEqual({ phase: "idle" });
    await act(async () => {
      outcome = await result.current.retry();
    });

    expect(outcome).toBeNull();
    expect(retryPublish).not.toHaveBeenCalled();
  });
});
