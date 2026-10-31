// @vitest-environment jsdom
/** Up and down votes on an item: the reader's own shown, nothing sent for the vote already held, and what the relays said. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { NostrEvent } from "nostr-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyVote, voteTemplate, type ReactionCount } from "@/lib/curate/writeTemplates";
import type { ItemEvent } from "@/services/concepts";
import type { PublishResult } from "@/services/publish";
import { DCOSL } from "@/services/relays";
import { SignerError } from "@/services/signer";
import { useSigner } from "@/stores/signer";

vi.mock("@/services/publish", () => ({ signAndPublish: vi.fn(), retryPublish: vi.fn() }));

import { retryPublish, signAndPublish } from "@/services/publish";
import { VoteButtons } from "./vote-buttons";

const CURATOR = "b".repeat(64);
const READER = "5".repeat(64);
const OWN = "wss://own.example.test";
const LIST = `39998:${CURATOR}:food-and-drink-places`;

const CAFE: ItemEvent = {
  id: "1".repeat(64),
  pubkey: CURATOR,
  kind: 39999,
  created_at: 1_792_000_000,
  content: "",
  tags: [["d", "cafe"], ["z", LIST], ["name", "Cafe"]],
};

const EVENT: NostrEvent = {
  id: "e".repeat(64),
  pubkey: READER,
  created_at: 1_792_000_100,
  kind: 7,
  tags: [],
  content: "+",
  sig: "5".repeat(128),
};

const saved: PublishResult = { event: EVENT, onHub: true, hubMessage: null, accepted: [DCOSL], failed: [] };
const savedButOwn: PublishResult = {
  ...saved,
  failed: [{ ok: false, from: OWN, message: "rate-limited: slow down" }],
};
const refused: PublishResult = {
  event: EVENT,
  onHub: false,
  hubMessage: "blocked: not allowed",
  accepted: [OWN],
  failed: [{ ok: false, from: DCOSL, message: "blocked: not allowed" }],
};

const signIn = () => useSigner.setState({ pubkey: READER, method: "extension", status: "connected", error: null });

const FRESH: ReactionCount = { up: 4, down: 2, mine: null };

function show(over: { item?: ItemEvent; count?: ReactionCount; readerCounts?: boolean } = {}) {
  const onVoted = vi.fn();
  const props = { item: CAFE, count: FRESH, readerCounts: true, onVoted, ...over };
  const view = render(<VoteButtons {...props} />);
  return { onVoted, props, view };
}

const up = () => screen.getByRole("button", { name: /Upvote/ }) as HTMLButtonElement;
const down = () => screen.getByRole("button", { name: /Downvote/ }) as HTMLButtonElement;

beforeEach(() => {
  vi.mocked(signAndPublish).mockReset();
  vi.mocked(retryPublish).mockReset();
  signIn();
});

describe("VoteButtons", () => {
  it("shows each side's count, and nothing for a side nobody voted", () => {
    show({ count: { up: 4, down: 0, mine: null } });

    expect(up().textContent).toContain("4");
    expect(down().textContent).not.toMatch(/\d/);
  });

  it("marks the reader's own vote pressed, and neither when they haven't voted", () => {
    const first = show({ count: { up: 4, down: 2, mine: "-" } });
    expect(up().getAttribute("aria-pressed")).toBe("false");
    expect(down().getAttribute("aria-pressed")).toBe("true");
    first.view.unmount();

    show();
    expect(up().getAttribute("aria-pressed")).toBe("false");
    expect(down().getAttribute("aria-pressed")).toBe("false");
  });

  it("is disabled when signed out, and says to connect", () => {
    useSigner.setState({ pubkey: null, status: "disconnected", error: null });
    show();

    for (const button of [up(), down()]) {
      expect(button.disabled).toBe(true);
      expect(button.title).toBe("Connect to vote");
    }
    fireEvent.click(up());
    expect(signAndPublish).not.toHaveBeenCalled();
  });

  it("signs the endorsement with the vote as its content, naming the item and not the list", async () => {
    vi.mocked(signAndPublish).mockResolvedValue(saved);
    show();

    fireEvent.click(down());

    await waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(1));
    const template = vi.mocked(signAndPublish).mock.calls[0][0];
    expect(template).toEqual(voteTemplate(CAFE, "-"));
    expect(template.kind).toBe(7);
    expect(template.content).toBe("-");
    expect(template.tags).toContainEqual(["e", CAFE.id, DCOSL]);
    expect(template.tags).toContainEqual(["a", `39999:${CURATOR}:cafe`, DCOSL]);
    expect(template.tags.some((t) => t[1] === LIST || t[1]?.startsWith("39998:"))).toBe(false);
  });

  it("on a curation copy, votes on the row's own event", async () => {
    vi.mocked(signAndPublish).mockResolvedValue(saved);
    const copy: ItemEvent = {
      ...CAFE,
      id: "2".repeat(64),
      pubkey: READER,
      tags: [["d", "copy-cafe"], ["q", `39999:${CURATOR}:cafe`], ["z", LIST]],
    };
    show({ item: copy });

    fireEvent.click(up());

    await waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(1));
    expect(vi.mocked(signAndPublish).mock.calls[0][0]).toEqual(voteTemplate(copy, "+"));
    expect(vi.mocked(signAndPublish).mock.calls[0][0].tags).toContainEqual(["e", copy.id, DCOSL]);
  });

  it("a first vote adds to its side, once the list relay has it", async () => {
    vi.mocked(signAndPublish).mockResolvedValue(saved);
    const { onVoted } = show();

    fireEvent.click(up());

    await waitFor(() => expect(onVoted).toHaveBeenCalledTimes(1));
    expect(onVoted).toHaveBeenCalledWith({ up: 5, down: 2, mine: "+" });
  });

  it("switching moves the vote across when the reader counts", async () => {
    vi.mocked(signAndPublish).mockResolvedValue(saved);
    const { onVoted } = show({ count: { up: 4, down: 2, mine: "+" } });

    fireEvent.click(down());

    await waitFor(() => expect(onVoted).toHaveBeenCalledWith({ up: 3, down: 3, mine: "-" }));
  });

  it("changes only the reader's own mark when the reader isn't one of the people counted", async () => {
    vi.mocked(signAndPublish).mockResolvedValue(saved);
    const { onVoted } = show({ count: { up: 4, down: 2, mine: "+" }, readerCounts: false });

    fireEvent.click(down());

    await waitFor(() => expect(onVoted).toHaveBeenCalledWith({ up: 4, down: 2, mine: "-" }));
  });

  it("sends nothing for the vote already held", () => {
    const { onVoted } = show({ count: { up: 4, down: 2, mine: "+" } });

    fireEvent.click(up());

    expect(signAndPublish).not.toHaveBeenCalled();
    expect(onVoted).not.toHaveBeenCalled();
  });

  it("disables both buttons while a vote is in flight", async () => {
    vi.mocked(signAndPublish).mockReturnValue(new Promise(() => {}));
    show();

    fireEvent.click(up());

    await waitFor(() => expect(up().disabled).toBe(true));
    expect(down().disabled).toBe(true);
    fireEvent.click(down());
    expect(signAndPublish).toHaveBeenCalledTimes(1);
  });

  it("says nothing of a vote every relay took", async () => {
    vi.mocked(signAndPublish).mockResolvedValue(saved);
    const { onVoted, view } = show();

    fireEvent.click(up());

    await waitFor(() => expect(onVoted).toHaveBeenCalled());
    expect(up().disabled).toBe(false);
    expect(view.container.querySelector("[role=status], [role=alert]")).toBeNull();
  });

  it("a vote the list relay refused changes nothing, says so, and Retry sends the same event again", async () => {
    vi.mocked(signAndPublish).mockResolvedValue(refused);
    vi.mocked(retryPublish).mockResolvedValue(saved);
    const { onVoted } = show();

    fireEvent.click(down());

    expect((await screen.findByRole("alert")).textContent).toContain("Not saved to the list relay: blocked: not allowed");
    expect(onVoted).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(onVoted).toHaveBeenCalledWith({ up: 4, down: 3, mine: "-" }));
    expect(retryPublish).toHaveBeenCalledWith(refused);
    expect(signAndPublish).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a vote the list relay took but one of the reader's own relays missed counts, with a note", async () => {
    vi.mocked(signAndPublish).mockResolvedValue(savedButOwn);
    const { onVoted } = show();

    fireEvent.click(up());

    await waitFor(() => expect(onVoted).toHaveBeenCalledWith({ up: 5, down: 2, mine: "+" }));
    expect((await screen.findByRole("status")).textContent).toContain("Not saved to 1 of your own relays: own.example.test");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("clears the note on the next vote", async () => {
    vi.mocked(signAndPublish).mockResolvedValueOnce(savedButOwn).mockReturnValueOnce(new Promise(() => {}));
    const view = show();

    fireEvent.click(up());
    await screen.findByRole("status");
    // The page hands back the new count, and the reader votes again.
    view.view.rerender(
      <VoteButtons {...view.props} count={applyVote(FRESH, "+", true)} />,
    );
    fireEvent.click(down());

    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(signAndPublish).toHaveBeenCalledTimes(2);
  });

  it("says why when the signer didn't sign, and counts nothing", async () => {
    vi.mocked(signAndPublish).mockRejectedValue(
      new SignerError("refused", "The signer didn't sign: User rejected the request"),
    );
    const { onVoted } = show();

    fireEvent.click(up());

    expect((await screen.findByRole("alert")).textContent).toBe("The signer didn't sign: User rejected the request");
    expect(onVoted).not.toHaveBeenCalled();
    expect(up().disabled).toBe(false);
  });
});
