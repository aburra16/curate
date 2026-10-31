// @vitest-environment jsdom
/** What a write says when it lands: saved, not saved with Retry, or the signer's words. */
import { fireEvent, render, screen } from "@testing-library/react";
import type { NostrEvent } from "nostr-tools";
import { describe, expect, it, vi } from "vitest";
import type { WriteState } from "@/hooks/use-write";
import type { PublishResult } from "@/services/publish";
import { DCOSL } from "@/services/relays";
import { PublishOutcome } from "./publish-outcome";

const OWN_A = "wss://own-a.example.test";
const OWN_B = "wss://own-b.example.test";

const EVENT: NostrEvent = {
  id: "e".repeat(64),
  pubkey: "c".repeat(64),
  created_at: 1_792_000_000,
  kind: 1,
  tags: [],
  content: "hello",
  sig: "5".repeat(128),
};

const done = (result: Partial<PublishResult>): WriteState => ({
  phase: "done",
  result: { event: EVENT, onHub: true, hubMessage: null, accepted: [DCOSL], failed: [], ...result },
});

const missed = (from: string, message: string) => ({ ok: false, from, message });

describe("PublishOutcome", () => {
  it("says nothing before a write, or while one is in flight", () => {
    const idle = render(<PublishOutcome state={{ phase: "idle" }} busy={false} onRetry={() => {}} />);
    expect(idle.container.textContent).toBe("");
    idle.unmount();

    const working = render(<PublishOutcome state={{ phase: "working" }} busy onRetry={() => {}} />);
    expect(working.container.textContent).toBe("");
  });

  it("says saved to the list relay, with no Retry", () => {
    render(<PublishOutcome state={done({})} busy={false} onRetry={() => {}} />);

    expect(screen.getByRole("status").textContent).toBe("Saved to the list relay.");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("notes the hosts of your own relays that didn't take it", () => {
    const failed = [missed(OWN_A, "rate-limited: slow down"), missed(OWN_B, "timed out")];
    render(<PublishOutcome state={done({ accepted: [DCOSL], failed })} busy={false} onRetry={() => {}} />);

    expect(screen.getByRole("status").textContent).toBe(
      "Saved to the list relay. Not saved to 2 of your own relays: own-a.example.test, own-b.example.test.",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a list relay refusal shows its words and Retry", () => {
    const onRetry = vi.fn();
    const state = done({
      onHub: false,
      hubMessage: "blocked: not allowed",
      accepted: [OWN_A],
      failed: [missed(DCOSL, "blocked: not allowed")],
    });
    render(<PublishOutcome state={state} busy={false} onRetry={onRetry} />);

    expect(screen.getByRole("alert").textContent).toContain("Not saved to the list relay: blocked: not allowed");
    const retry = screen.getByRole("button", { name: "Retry" });
    expect((retry as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("disables Retry while a write is in flight", () => {
    const onRetry = vi.fn();
    const state = done({ onHub: false, hubMessage: "timed out", accepted: [], failed: [missed(DCOSL, "timed out")] });
    render(<PublishOutcome state={state} busy onRetry={onRetry} />);

    const retry = screen.getByRole("button", { name: "Retry" });
    expect((retry as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("a signer error shows its message", () => {
    const state: WriteState = { phase: "error", message: "The signer didn't sign: User rejected the request" };
    render(<PublishOutcome state={state} busy={false} onRetry={() => {}} />);

    expect(screen.getByRole("alert").textContent).toBe("The signer didn't sign: User rejected the request");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
