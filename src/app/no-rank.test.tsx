// @vitest-environment jsdom
/**
 * No rank appears in page text (Global Constraints: never show a person's rank,
 * weight or score, in text, in attributes, or in accessible names).
 *
 * Discover and the list page are rendered over a pretend set of relays whose
 * scorer holds ranks of 37, 2 and 1 for the people involved. Rank 2 is the line
 * (VERIFIED_RANK); 37 is well inside; 1 is outside and folds. The ranks decide
 * what is shown and what is counted, and none of them may be shown.
 *
 * The data is chosen so that no honest count on the page is 37 or 2 (three
 * folded items, one vote each), so a 37 or a 2 standing alone in the text can
 * only be a rank.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { NostrEvent } from "nostr-tools";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCountCache } from "@/components/concept-card";
import { DEFAULT_RELAYS } from "@/lib/nostr/relays";
import { clearSeenOn } from "@/services/nostr";
import { DCOSL, INDEX, PROFILE_RELAYS, TAG_HUB } from "@/services/relays";
import { setTransport } from "@/services/transport";
import { clearTrustCaches, VERIFIED_RANK } from "@/services/trust";
import { useRelayStatus } from "@/stores/relay-status";
import { useSettings } from "@/stores/settings";
import { useSigner } from "@/stores/signer";
import { useView } from "@/stores/view";
import { relayCorpus } from "@/test/relayCorpus";
import dictionaryHeaders from "@/test/fixtures/dictionary.headers.json";
import dictionaryTaggings from "@/test/fixtures/dictionary.taggings.json";
import foodCopies from "@/test/fixtures/food.copies.json";
import foodItems from "@/test/fixtures/food.items.json";

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
  useRouter: () => nav.router,
}));
// Names come from the relays in the app; none are reachable here, so every identity falls back to its npub.
vi.mock("@/lib/nostr/profiles", () => ({
  fetchProfile: async () => null,
  getCachedProfile: () => undefined,
}));

import DiscoverPage from "./page";
import ListPage from "./list/page";

const REAL_HOUSE = "be7bf5de068c1d842ed34a7c270507ec940f5ea51671cfd062a95e9d09420d0a";
const SCORES = "wss://scores.example.test";

/** The ranks in play. */
const INSIDE = 37;
const AT_THE_LINE = VERIFIED_RANK; // 2
const OUTSIDE = 1;

// -- the check ---------------------------------------------------------------

/** 37 or 2 on its own: not inside a longer number, a word, or an npub's letters. */
const A_RANK = /(?<![A-Za-z0-9])(?:37|2)(?![A-Za-z0-9])/;
/**
 * A count that names what it counts is a count, not a rank: Discover's "2 versions" is the real Dictionary's
 * (Books and V4V Songs each have one copy). Only this one is let through; a bare 2 is not.
 */
const NAMED_COUNT = /(?<![A-Za-z0-9])\d[\d,]*\s+versions?(?![A-Za-z0-9])/g;
/** The attributes that give an element a name a screen reader or a hover can show. */
const NAMING = ["aria-label", "aria-description", "aria-valuetext", "title", "alt", "placeholder"];

/**
 * The text each element holds directly. React writes "{n} versions" as two text nodes, "2" and " versions";
 * read together, as a reader reads them.
 */
function textNodes(root: HTMLElement): string[] {
  const out: string[] = [];
  for (const el of [root, ...root.querySelectorAll("*")]) {
    // A <time> is a moment, written in the reader's clock ("8:37:06 AM"): its digits move with the day.
    if (["SCRIPT", "STYLE", "TIME"].includes(el.tagName)) continue;
    const own = [...el.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? "")
      .join("")
      .trim();
    if (own) out.push(own);
  }
  return out;
}

/** Everything a reader or a screen reader is given, as one list of strings. */
function whatIsShown(root: HTMLElement = document.body): { text: string[]; names: string[] } {
  const names: string[] = [];
  for (const el of root.querySelectorAll("*")) {
    for (const attr of NAMING) {
      const value = el.getAttribute(attr);
      if (value) names.push(value);
    }
  }
  return { text: textNodes(root), names };
}

/** What is wrong with the page, as a list that should be empty. */
function rankLeaks(root?: HTMLElement): string[] {
  const { text, names } = whatIsShown(root);
  return [
    ...text
      .filter((t) => {
        const rest = t.replace(NAMED_COUNT, "");
        return A_RANK.test(rest) || /\brank/i.test(rest);
      })
      .map((t) => `text: ${t}`),
    ...names.filter((n) => A_RANK.test(n) || /rank/i.test(n)).map((n) => `name: ${n}`),
  ];
}

// -- the world ---------------------------------------------------------------

const sign = (kind: number, tags: string[][], sk: Uint8Array, content = "", created_at = 1_792_800_000) =>
  finalizeEvent({ kind, created_at, content, tags }, sk) as NostrEvent;

const house = generateSecretKey();
const scorer = generateSecretKey();
const authors = { inside: generateSecretKey(), atTheLine: generateSecretKey(), outside: generateSecretKey() };
const voterInside = generateSecretKey();
const voterAtTheLine = generateSecretKey();

/** The house's Assistant, and the ranks it gives: 37 for one author and one voter, 2 for another of each, 1 for one author. */
const scoring = {
  profiles: [sign(10040, [["30382:rank", getPublicKey(scorer), SCORES]], house)],
  ranks: [
    [getPublicKey(authors.inside), INSIDE],
    [getPublicKey(authors.atTheLine), AT_THE_LINE],
    [getPublicKey(authors.outside), OUTSIDE],
    [getPublicKey(voterInside), INSIDE],
    [getPublicKey(voterAtTheLine), AT_THE_LINE],
  ].map(([pubkey, rank]) => sign(30382, [["d", String(pubkey)], ["rank", String(rank)]], scorer)),
};

const recently = Math.floor(Date.now() / 1000) - 5 * 3600;

/** A list of places by its own curator, with field counts that are not 37 or 2. */
const curator = generateSecretKey();
const LIST = `39998:${getPublicKey(curator)}:places`;
const header = sign(
  39998,
  [
    ["d", "places"],
    ["names", "place", "places"],
    ["required", "name"],
    ["required", "category"],
    ["required", "address"],
    ["recommended", "website"],
    ["optional", "phone"],
    ["optional", "price"],
    ["optional", "notes"],
    ["optional", "menu"],
  ],
  curator,
  "",
  recently - 1_000,
);

const place = (name: string, by: Uint8Array, age: number): NostrEvent =>
  sign(
    39999,
    [["d", name.toLowerCase()], ["z", LIST], ["name", name], ["category", "cafe"], ["address", `${name} Street`]],
    by,
    "",
    recently - age,
  );

const alpha = place("Alpha", authors.inside, 1);
const beta = place("Beta", authors.atTheLine, 2);
const outsiders = [place("Gamma", authors.outside, 3), place("Delta", authors.outside, 4), place("Epsilon", authors.outside, 5)];
const votes = [
  sign(7, [["e", alpha.id]], voterInside, "+", recently),
  sign(7, [["e", beta.id]], voterAtTheLine, "+", recently),
];
const listEvents = [header, alpha, beta, ...outsiders, ...votes];

function listPageOver(held: NostrEvent[]) {
  const { transport } = relayCorpus({
    [DCOSL]: held,
    [TAG_HUB]: [],
    [INDEX]: held,
    ...Object.fromEntries(PROFILE_RELAYS.map((r) => [r, scoring.profiles])),
    [SCORES]: scoring.ranks,
  });
  setTransport(transport);
}

beforeEach(() => {
  clearTrustCaches();
  clearSeenOn();
  clearCountCache();
  localStorage.clear();
  sessionStorage.clear();
  useRelayStatus.getState().reset();
  useSettings.setState({ relays: [...DEFAULT_RELAYS] });
  useView.setState({ on: false, loaded: true });
  useSigner.setState({ pubkey: null, status: "disconnected", error: null });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ names: { _: getPublicKey(house) } }) })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const rowTitles = () => screen.queryAllByRole("heading", { level: 3 }).map((h) => h.textContent);

describe("the check", () => {
  it("sees a rank in text and in a name, and passes a page without one", () => {
    const { unmount } = render(
      <p title="Trust rank 37" aria-label="Rank 2">
        Alpha, 37
      </p>,
    );
    expect(rankLeaks()).toHaveLength(3);
    expect(rankLeaks()).toEqual(
      expect.arrayContaining(["text: Alpha, 37", "name: Trust rank 37", "name: Rank 2"]),
    );
    unmount();

    render(
      <p title="Opens in a new tab">
        1,237 places, 5h ago, npub1abc…2xyz, 2026, 2 versions
      </p>,
    );
    expect(rankLeaks()).toEqual([]);
  });
});

describe("no rank appears in page text", () => {
  it("on Discover, with ranks of 37 and 2 on the scorer", async () => {
    const dictionary = [...dictionaryTaggings, ...dictionaryHeaders, ...foodCopies, ...foodItems] as NostrEvent[];
    const { transport } = relayCorpus({
      [DCOSL]: dictionary,
      [TAG_HUB]: dictionary,
      [INDEX]: dictionary,
      ...Object.fromEntries(PROFILE_RELAYS.map((r) => [r, scoring.profiles])),
      [SCORES]: scoring.ranks,
    });
    setTransport(transport);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ names: { _: REAL_HOUSE } }) })),
    );
    render(<DiscoverPage />);

    await screen.findByRole("heading", { level: 2, name: "Dictionary" });
    // The cards and their counts are in.
    await screen.findAllByText(/^\d[\d,]* Food and Drink Places$/);
    expect(rankLeaks()).toEqual([]);

    // Show everything: the copies and withdrawn headers come back, labelled.
    act(() => useView.setState({ on: true }));
    await screen.findAllByText("withdrawn");
    expect(rankLeaks()).toEqual([]);
  });

  it("on a list page: rows, a fold, and votes counted by rank", async () => {
    listPageOver(listEvents);
    nav.params = new URLSearchParams({ c: LIST });
    render(<ListPage />);

    // 37 and 2 are in the web of trust, 1 is not: the ranks were used.
    expect(await screen.findByRole("button", { name: "3 more from accounts outside your web of trust" })).toBeTruthy();
    expect(rowTitles()).toEqual(["Alpha", "Beta"]);
    // Each vote came from someone inside the line, and counts as 1.
    await vi.waitFor(() => expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(2));
    expect(rankLeaks()).toEqual([]);
  });

  it("on a list page with Show everything on, where the folded rows come back labelled", async () => {
    useView.setState({ on: true, loaded: true });
    listPageOver(listEvents);
    nav.params = new URLSearchParams({ c: LIST });
    render(<ListPage />);

    await vi.waitFor(() => expect(rowTitles()).toHaveLength(5));
    expect(screen.getAllByText("outside your web of trust")).toHaveLength(3);
    expect(rankLeaks()).toEqual([]);
  });

  it.each([
    ["the rank-37 author's item", alpha],
    ["the rank-2 author's item", beta],
    ["an item from outside the web of trust", outsiders[0]],
  ])("in the event panel for %s", async (_name, item) => {
    useView.setState({ on: true, loaded: true });
    listPageOver(listEvents);
    const d = item.tags.find((t) => t[0] === "d")?.[1];
    nav.params = new URLSearchParams({ c: LIST, item: `39999:${item.pubkey}:${d}` });
    render(<ListPage />);

    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("tab", { name: "Item" });
    for (const tab of ["Item", "Pretty", "Raw"]) {
      fireEvent.click(within(dialog).getByRole("tab", { name: tab }));
      expect(rankLeaks()).toEqual([]);
    }
  });
});
