// @vitest-environment jsdom
/** What happens once a write has been answered: handed on, kept waiting for the person, or nothing. */
import { act, renderHook } from "@testing-library/react";
import type { NostrEvent } from "nostr-tools";
import { describe, expect, it, vi } from "vitest";
import { useSettled } from "@/hooks/use-settled";
import type { PublishResult } from "@/services/publish";
import { DCOSL } from "@/services/relays";

const EVENT: NostrEvent = {
  id: "e".repeat(64),
  pubkey: "c".repeat(64),
  created_at: 1_792_000_000,
  kind: 1,
  tags: [],
  content: "hello",
  sig: "5".repeat(128),
};

const result = (over: Partial<PublishResult>): PublishResult => ({
  event: EVENT,
  onHub: true,
  hubMessage: null,
  accepted: [DCOSL],
  failed: [],
  ...over,
});

describe("useSettled", () => {
  it("hands on a write that every relay took, and waits for nothing", () => {
    const onSaved = vi.fn();
    const { result: hook } = renderHook(() => useSettled(onSaved));

    act(() => hook.current.settled(result({})));

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith(EVENT);
    expect(hook.current.waiting).toBeNull();
  });

  it("holds a write the list relay took and one of the author's own relays missed, until the person is done", () => {
    const onSaved = vi.fn();
    const { result: hook } = renderHook(() => useSettled(onSaved));

    act(() => hook.current.settled(result({ failed: [{ ok: false, from: "wss://own.example.test", message: "timed out" }] })));

    expect(onSaved).not.toHaveBeenCalled();
    expect(hook.current.waiting).toBe(EVENT);
  });

  it("does nothing for a write the list relay refused, or one that never went out", () => {
    const onSaved = vi.fn();
    const { result: hook } = renderHook(() => useSettled(onSaved));

    act(() => hook.current.settled(result({ onHub: false, hubMessage: "blocked", accepted: [] })));
    act(() => hook.current.settled(null));

    expect(onSaved).not.toHaveBeenCalled();
    expect(hook.current.waiting).toBeNull();
  });
});
