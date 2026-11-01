// @vitest-environment jsdom
/** What happens once a write has been answered: handed on at once, with a toast for own relays that missed it, or nothing. */
import { act, renderHook, screen } from "@testing-library/react";
import type { NostrEvent } from "nostr-tools";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast";
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

const withToasts = ({ children }: { children: ReactNode }) => <ToastProvider>{children}</ToastProvider>;

describe("useSettled", () => {
  it("hands on a write that every relay took, and says nothing", () => {
    const onSaved = vi.fn();
    const { result: hook } = renderHook(() => useSettled(onSaved), { wrapper: withToasts });

    act(() => hook.current(result({})));

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith(EVENT);
    expect(screen.queryByText(/Saved to the list relay/)).toBeNull();
  });

  it("hands on a write the list relay took at once, and a toast names the author's own relays that missed it", () => {
    const onSaved = vi.fn();
    const { result: hook } = renderHook(() => useSettled(onSaved), { wrapper: withToasts });

    act(() =>
      hook.current(
        result({
          failed: [
            { ok: false, from: "wss://own-a.example.test", message: "timed out" },
            { ok: false, from: "wss://own-b.example.test/", message: "rate-limited: slow down" },
          ],
        }),
      ),
    );

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith(EVENT);
    expect(
      screen.getByText("Saved to the list relay. Not saved to 2 of your own relays: own-a.example.test, own-b.example.test."),
    ).toBeTruthy();
  });

  it("does nothing for a write the list relay refused, or one that never went out", () => {
    const onSaved = vi.fn();
    const { result: hook } = renderHook(() => useSettled(onSaved), { wrapper: withToasts });

    act(() =>
      hook.current(
        result({
          onHub: false,
          hubMessage: "blocked",
          accepted: [],
          failed: [
            { ok: false, from: DCOSL, message: "blocked" },
            { ok: false, from: "wss://own.example.test", message: "timed out" },
          ],
        }),
      ),
    );
    act(() => hook.current(null));

    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.queryByText(/Saved to the list relay/)).toBeNull();
  });
});
