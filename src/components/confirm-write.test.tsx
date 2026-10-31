// @vitest-environment jsdom
/** A question that is answered with one write: Cancel, the confirm button, what the relays said, and Done. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { EventTemplate, NostrEvent } from "nostr-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublishResult } from "@/services/publish";
import { DCOSL } from "@/services/relays";

vi.mock("@/services/publish", () => ({ signAndPublish: vi.fn(), retryPublish: vi.fn() }));

import { retryPublish, signAndPublish } from "@/services/publish";
import { ConfirmWrite } from "./confirm-write";

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

function ask(over: { onDone?: (event: NostrEvent) => void; onCancel?: () => void } = {}) {
  const props = { onDone: vi.fn(), onCancel: vi.fn(), ...over };
  const template = vi.fn(() => TEMPLATE);
  render(
    <ConfirmWrite
      question="Remove this? It can't be undone."
      confirmLabel="Remove"
      busyLabel="Removing…"
      template={template}
      {...props}
    />,
  );
  return { ...props, template };
}

beforeEach(() => {
  vi.mocked(signAndPublish).mockReset();
  vi.mocked(retryPublish).mockReset();
});

describe("ConfirmWrite", () => {
  it("asks, and publishes nothing until the person confirms", () => {
    const { onCancel, onDone, template } = ask();

    expect(screen.getByText("Remove this? It can't be undone.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onDone).not.toHaveBeenCalled();
    expect(template).not.toHaveBeenCalled();
    expect(signAndPublish).not.toHaveBeenCalled();
  });

  it("signs what the write says when confirmed, and hands on the saved event", async () => {
    vi.mocked(signAndPublish).mockResolvedValue(saved);
    const { onDone } = ask();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(EVENT));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(signAndPublish).toHaveBeenCalledTimes(1);
    expect(signAndPublish).toHaveBeenCalledWith(TEMPLATE);
  });

  it("says Removing… and can't be cancelled while the write is in flight", async () => {
    vi.mocked(signAndPublish).mockReturnValue(new Promise(() => {}));
    ask();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    const busy = await screen.findByRole("button", { name: "Removing…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps asking, with the list relay's words and Retry, when the list relay refuses; Retry hands on once it lands", async () => {
    const refused: PublishResult = { ...saved, onHub: false, hubMessage: "blocked: not today", accepted: [] };
    vi.mocked(signAndPublish).mockResolvedValue(refused);
    vi.mocked(retryPublish).mockResolvedValue(saved);
    const { onDone } = ask();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText(/Not saved to the list relay: blocked: not today/)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(EVENT));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(signAndPublish).toHaveBeenCalledOnce();
  });

  it("holds on the note when an own relay missed it, with Done in place of Cancel and the confirm button", async () => {
    vi.mocked(signAndPublish).mockResolvedValue({
      ...saved,
      failed: [{ ok: false, from: "wss://own.example.test", message: "timed out" }],
    });
    const { onDone } = ask();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByText(/Not saved to 1 of your own relays: own\.example\.test/)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(EVENT);
  });
});
