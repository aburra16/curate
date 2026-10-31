// @vitest-environment jsdom
/**
 * Discover, end to end over a pretend set of relays holding the real
 * Dictionary of 31 October (src/test/fixtures): the Dictionary first, one card
 * per concept, "Show everything", the reader's own copy, and the index refusing.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { NostrEvent } from "nostr-tools";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RELAYS } from "@/lib/nostr/relays";
import { clearCountCache } from "@/components/concept-card";
import { clearSeenOn } from "@/services/nostr";
import { DCOSL, INDEX, PROFILE_RELAYS, TAG_HUB } from "@/services/relays";
import { setTransport } from "@/services/transport";
import { clearTrustCaches } from "@/services/trust";
import { useRelayStatus } from "@/stores/relay-status";
import { useSettings } from "@/stores/settings";
import { useSigner } from "@/stores/signer";
import { useView } from "@/stores/view";
import { relayCorpus, type HeldRelay } from "@/test/relayCorpus";
import dictionaryHeaders from "@/test/fixtures/dictionary.headers.json";
import dictionaryTaggings from "@/test/fixtures/dictionary.taggings.json";
import foodCopies from "@/test/fixtures/food.copies.json";
import foodItems from "@/test/fixtures/food.items.json";

vi.mock("@/components/user-identity", () => ({
  UserIdentity: ({ pubkey }: { pubkey: string }) => <span data-testid="author">{pubkey.slice(0, 4)}</span>,
}));

import DiscoverPage from "./page";

/** brainstorm.world's NIP-05 `_` on 31 October: the house that signed dictionary.taggings. */
const REAL_HOUSE = "be7bf5de068c1d842ed34a7c270507ec940f5ea51671cfd062a95e9d09420d0a";
const CURATOR = "b83a28b7e4e5d20bd960c5faeb6625f95529166b8bdb045d42634a2f35919450";
const FOOD = `39998:${CURATOR}:food-and-drink-places`;

const library = [...dictionaryTaggings, ...dictionaryHeaders, ...foodCopies] as NostrEvent[];

function houseIs(house: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ names: { _: house } }) })),
  );
}

/** Every relay holds `events`; the index may refuse instead. */
function relays(events: NostrEvent[], index: HeldRelay = events) {
  const corpus = relayCorpus({
    [DCOSL]: events,
    [TAG_HUB]: events,
    [INDEX]: index,
    ...Object.fromEntries(PROFILE_RELAYS.map((r) => [r, [] as NostrEvent[]])),
  });
  setTransport(corpus.transport);
  return corpus;
}

const sectionOf = (name: string) => {
  const heading = screen.getByRole("heading", { level: 2, name });
  return heading.closest("section") as HTMLElement;
};
const cardNames = (section: HTMLElement) =>
  within(section)
    .getAllByRole("heading", { level: 3 })
    .map((h) => h.textContent);

beforeEach(() => {
  clearTrustCaches();
  clearSeenOn();
  clearCountCache();
  localStorage.clear();
  useRelayStatus.getState().reset();
  useSettings.setState({ relays: [...DEFAULT_RELAYS] });
  useView.setState({ on: false, loaded: true });
  useSigner.setState({ pubkey: null, status: "disconnected", error: null });
  houseIs(REAL_HOUSE);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Discover", () => {
  it("puts the Dictionary first, then every other list, each concept once", async () => {
    relays(library);
    render(<DiscoverPage />);

    await screen.findByRole("heading", { level: 2, name: "Dictionary" });
    const dictionary = cardNames(sectionOf("Dictionary"));
    expect(dictionary).toEqual([
      "Books",
      "Demo Dictionary Concepts",
      "Divine Videos",
      "Event Calendars",
      "Events",
      "Food and Drink Places",
      "GitHub Accounts",
      "V4V Musicians",
      "V4V Songs",
    ]);
    const all = cardNames(sectionOf("All lists"));
    expect(all).toContain("Book submissions"); // named only in its json tag
    // Two different concepts are both called "Events" (Brainstorm's, and a test one of 2efaa715's), so
    // concepts are told apart by where they open, not by name.
    const roots = (section: HTMLElement) =>
      within(section)
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.closest("a")?.getAttribute("href"));
    const inDictionary = roots(sectionOf("Dictionary"));
    const inAll = roots(sectionOf("All lists"));
    expect(inDictionary).toHaveLength(9);
    for (const href of inDictionary) expect(inAll).not.toContain(href);
    expect(new Set([...inDictionary, ...inAll]).size).toBe(inDictionary.length + inAll.length);

    // the Dictionary section comes before All lists
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf("Dictionary")).toBeLessThan(headings.indexOf("All lists"));
    // no topic chips, no untitled toggle
    expect(screen.queryByText("Show untitled")).toBeNull();
  });

  it("links each card to /list?c=<coordinate>", async () => {
    relays(library);
    render(<DiscoverPage />);
    const food = await screen.findByRole("link", { name: /Food and Drink Places/ });
    expect(food.getAttribute("href")).toBe(`/list?c=${encodeURIComponent(FOOD)}`);
  });

  it("shows each concept's count, from the index, with its plural", async () => {
    relays([...library, ...(foodItems as NostrEvent[])]);
    render(<DiscoverPage />);
    const counts = await screen.findAllByText(/^\d[\d,]* Food and Drink Places$/);
    expect(counts).toHaveLength(1);
    expect(counts[0].getAttribute("title")).toBe("Everything filed, before the web-of-trust filter");
  });

  it("with the index refusing, the lists still show, there are no counts, and the index is named", async () => {
    relays([...library, ...(foodItems as NostrEvent[])], { refuses: "error: vespa searched only 67% of the corpus" });
    render(<DiscoverPage />);

    await screen.findByRole("heading", { level: 2, name: "All lists" });
    expect(cardNames(sectionOf("Dictionary"))).toContain("Food and Drink Places");
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("the index (search.brainstorm.world)");
    expect(status.textContent).toContain("counts are missing");
    await act(async () => {});
    expect(screen.queryByTitle("Everything filed, before the web-of-trust filter")).toBeNull();
  });

  it("hides copies, withdrawn and blank until Show everything is on", async () => {
    relays(library);
    const view = render(<DiscoverPage />);
    await screen.findByRole("heading", { level: 2, name: "Dictionary" });
    expect(screen.queryByText("withdrawn")).toBeNull();
    expect(screen.queryByText("copy")).toBeNull();

    act(() => useView.setState({ on: true }));
    const card = within(sectionOf("Dictionary"))
      .getByRole("heading", { level: 3, name: "Food and Drink Places" })
      .closest("article") as HTMLElement;
    expect(within(card).getAllByText("copy")).toHaveLength(3);
    expect(within(card).getAllByText("withdrawn")).toHaveLength(1);
    // Food is still one card
    expect(cardNames(sectionOf("Dictionary")).filter((n) => n === "Food and Drink Places")).toHaveLength(1);
    view.unmount();
  });

  it("search narrows both sections", async () => {
    relays(library);
    render(<DiscoverPage />);
    await screen.findByRole("heading", { level: 2, name: "Dictionary" });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "github" } });
    expect(cardNames(sectionOf("Dictionary"))).toEqual(["GitHub Accounts"]);
    expect(screen.queryByRole("heading", { level: 2, name: "All lists" })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzzz" } });
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
  });

  it("signing in later shows the reader's own copy of a concept", async () => {
    const reader = generateSecretKey();
    const mine = finalizeEvent(
      {
        kind: 39998,
        created_at: 1_792_000_000,
        content: "",
        tags: [["d", "food-and-drink-places"], ["names", "Eat", "Eats"], ["b", FOOD, "pointer"]],
      },
      reader,
    ) as NostrEvent;
    relays([...library, mine]);
    render(<DiscoverPage />);

    await screen.findByRole("heading", { level: 3, name: "Food and Drink Places" });
    act(() => useSigner.setState({ pubkey: getPublicKey(reader), status: "connected" }));
    const eats = await screen.findByRole("heading", { level: 3, name: "Eats" });
    expect(eats.closest("a")?.getAttribute("href")).toBe(`/list?c=${encodeURIComponent(FOOD)}`);
    expect(screen.queryByRole("heading", { level: 3, name: "Food and Drink Places" })).toBeNull();

    act(() => useSigner.setState({ pubkey: null, status: "disconnected" }));
    await screen.findByRole("heading", { level: 3, name: "Food and Drink Places" });
  });

  it("says so when no list could be found", async () => {
    relays([]);
    render(<DiscoverPage />);
    await screen.findByText("No lists found yet.");
  });
});
