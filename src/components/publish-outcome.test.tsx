// @vitest-environment jsdom
/** What a write says when it lands: saved, not saved with Retry, or the signer's words. */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { NostrEvent } from "nostr-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WriteState } from "@/hooks/use-write";
import type { PublishResult } from "@/services/publish";
import { DCOSL } from "@/services/relays";

vi.mock("@/services/remoteSigner", () => ({ forgetRemote: vi.fn(), REQUEST_TIMEOUT_MS: 30_000 }));
vi.mock("@/services/signer", async () => ({
  ...(await vi.importActual<typeof import("@/services/signer")>("@/services/signer")),
  disconnect: vi.fn(),
}));

import { disconnect, type SignerFailure } from "@/services/signer";
import { useConnectDialog } from "@/stores/connect-dialog";
import { useSigner } from "@/stores/signer";
import { PublishOutcome } from "./publish-outcome";

const CURATOR = "c".repeat(64);

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

  describe("when a remote signer has stopped answering", () => {
    const failed = (reason?: SignerFailure): WriteState => ({
      phase: "error",
      message: "The signer didn't answer in time.",
      reason,
    });
    const connectAgain = () => screen.queryByRole("button", { name: "Connect again" });

    beforeEach(() => {
      vi.mocked(disconnect).mockReset();
      vi.mocked(disconnect).mockResolvedValue();
      useConnectDialog.getState().hide();
      useSigner.getState().setConnected(CURATOR, "remote");
    });

    it.each<SignerFailure>(["timeout", "refused"])("offers Connect again after %s, beside the signer's words", (reason) => {
      render(<PublishOutcome state={failed(reason)} busy={false} onRetry={() => {}} />);

      expect(screen.getByRole("alert").textContent).toContain("The signer didn't answer in time.");
      expect(connectAgain()).toBeTruthy();
    });

    it("lets go of the signer, then opens the chooser", async () => {
      let letGo: () => void = () => {};
      vi.mocked(disconnect).mockReturnValue(new Promise<void>((resolve) => (letGo = resolve)));
      render(<PublishOutcome state={failed("timeout")} busy={false} onRetry={() => {}} />);

      fireEvent.click(screen.getByRole("button", { name: "Connect again" }));

      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(useConnectDialog.getState().open).toBe(false);
      await act(async () => letGo());
      await waitFor(() => expect(useConnectDialog.getState().open).toBe(true));
      expect(useSigner.getState()).toMatchObject({ status: "disconnected", pubkey: null, method: null });
    });

    it.each<SignerFailure | undefined>(["not-connected", "account-changed", "no-extension", undefined])(
      "does not offer it after %s",
      (reason) => {
        render(<PublishOutcome state={failed(reason)} busy={false} onRetry={() => {}} />);

        expect(connectAgain()).toBeNull();
      },
    );

    it("does not offer it when the signer is the browser extension", () => {
      useSigner.getState().setConnected(CURATOR, "extension");
      render(<PublishOutcome state={failed("timeout")} busy={false} onRetry={() => {}} />);

      expect(connectAgain()).toBeNull();
    });

    it("does not offer it when no signer is connected", () => {
      useSigner.getState().setDisconnected();
      render(<PublishOutcome state={failed("timeout")} busy={false} onRetry={() => {}} />);

      expect(connectAgain()).toBeNull();
    });
  });
});
