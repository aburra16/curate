// @vitest-environment jsdom
/**
 * A list's page, end to end over a pretend set of relays holding the real
 * Food and Drink Places header, copies and items of 31 October
 * (src/test/fixtures): the house's version governing for a signed-out
 * reader, the versions menu, the fields in order, a copy's link going to its
 * concept, the page reading again when the reader signs in, and the item
 * rows: read through the version shown, counted with the list's plural,
 * folded when their authors are outside the reader's web of trust, and
 * opened from their items when no header can be found; and the changes a
 * signed-in reader can make to the list: edit it, make or edit a version of
 * their own, or withdraw it.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { NostrEvent } from "nostr-tools";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exactCopyTemplate, withdrawnTemplate } from "@/lib/conceptCopy";
import { B_DEFERRED, definitionOf, type HeaderEvent } from "@/lib/conceptResolution";
import { DEFAULT_RELAYS } from "@/lib/nostr/relays";
import { clearSeenOn } from "@/services/nostr";
import type { PublishResult } from "@/services/publish";
import { DCOSL, INDEX, PROFILE_RELAYS, TAG_HUB } from "@/services/relays";
import { SignerError } from "@/services/signer";
import { setTransport } from "@/services/transport";
import { clearTrustCaches } from "@/services/trust";
import { useRelayStatus } from "@/stores/relay-status";
import { useSettings } from "@/stores/settings";
import { useSigner } from "@/stores/signer";
import { useView } from "@/stores/view";
import { relayCorpus, type HeldRelay } from "@/test/relayCorpus";
import foodCopies from "@/test/fixtures/food.copies.json";
import foodHeader from "@/test/fixtures/food.header.json";
import foodItems from "@/test/fixtures/food.items.json";
import tagsHeaders from "@/test/fixtures/tags.headers.json";
import tagsItems from "@/test/fixtures/tags.items.json";

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  router: { replace: vi.fn(), push: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
  useRouter: () => nav.router,
}));

vi.mock("@/components/user-identity", () => ({
  UserIdentity: ({ pubkey }: { pubkey: string }) => <span data-testid="author">{pubkey.slice(0, 4)}</span>,
}));

vi.mock("@/services/publish", () => ({ signAndPublish: vi.fn(), retryPublish: vi.fn() }));

import { retryPublish, signAndPublish } from "@/services/publish";
import ListPage from "./page";

const REAL_HOUSE = "be7bf5de068c1d842ed34a7c270507ec940f5ea51671cfd062a95e9d09420d0a";
const CURATOR = "b83a28b7e4e5d20bd960c5faeb6625f95529166b8bdb045d42634a2f35919450";
const FOOD = `39998:${CURATOR}:food-and-drink-places`;

const food = [...foodHeader, ...foodCopies] as NostrEvent[];
const foodRows = foodItems as NostrEvent[];
/** Who listed the Food items: BTC Map's importer. */
const IMPORTER = foodRows[0].pubkey;

function houseIs(house: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ names: { _: house } }) })),
  );
}

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

/** Open the page as `/list?c=…[&version=…][&edit=…]`. */
function open(c: string, version?: string, edit?: string) {
  nav.params = new URLSearchParams({ c, ...(version ? { version } : {}), ...(edit ? { edit } : {}) });
  return render(<ListPage />);
}

const title = () => screen.findByRole("heading", { level: 1 });

beforeEach(() => {
  clearTrustCaches();
  clearSeenOn();
  localStorage.clear();
  sessionStorage.clear();
  useRelayStatus.getState().reset();
  useSettings.setState({ relays: [...DEFAULT_RELAYS] });
  useView.setState({ on: false, loaded: true });
  useSigner.setState({ pubkey: null, status: "disconnected", error: null });
  nav.router.replace.mockClear();
  nav.router.push.mockClear();
  vi.mocked(signAndPublish).mockReset();
  vi.mocked(retryPublish).mockReset();
  houseIs(REAL_HOUSE);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a list's page", () => {
  it("opens at the house's version for a reader who is signed out", async () => {
    relays(food);
    open(FOOD);

    expect((await title()).textContent).toBe("Food and Drink Places");
    expect(screen.getByText("Brainstorm’s version")).toBeTruthy();
    expect(screen.getByText(/Differs from the community header in its fields/)).toBeTruthy();
    expect(nav.router.replace).not.toHaveBeenCalled();
  });

  it("lists its fields as the version declares them: required, then recommended, then optional", async () => {
    relays(food);
    open(FOOD, CURATOR);
    await title();

    const rows = screen.getAllByRole("row").slice(1);
    const requirement = (row: HTMLElement) => within(row).getAllByRole("cell")[0].textContent;
    const names = rows.map((row) => within(row).getByRole("rowheader").textContent);

    // The community header declares 2 required, 5 recommended, then the optional ones.
    expect(names.slice(0, 7)).toEqual(["name", "category", "address", "locality", "cuisine", "osm-id", "g"]);
    expect(rows.slice(0, 7).map(requirement)).toEqual([
      "required",
      "required",
      "recommended",
      "recommended",
      "recommended",
      "recommended",
      "recommended",
    ]);
    expect(requirement(rows[7])).toBe("optional");
    // Each with its type and the header's own words.
    const website = rows.find((row) => within(row).getByRole("rowheader").textContent === "website")!;
    expect(within(website).getAllByRole("cell").map((c) => c.textContent)).toEqual(["optional", "url", "Website"]);
    expect(within(rows[0]).getAllByRole("cell")[2].textContent).toBe("Name of the business");
  });

  it("offers the community header and every copy to read instead, and the choice sets ?version=", async () => {
    relays(food);
    open(FOOD);
    await title();

    fireEvent.click(screen.getByRole("button", { name: /4 versions/ }));
    const menu = screen.getByRole("menu", { name: "Versions of this list" });
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent?.replace(/^\W*[\da-f]{4}/, "").trim())).toEqual([
      "community",
      "house",
      "copy",
      "copy",
    ]);
    // The house's version is the one being read.
    expect(items.map((i) => i.getAttribute("aria-checked"))).toEqual(["false", "true", "false", "false"]);

    fireEvent.click(items[0]);
    expect(nav.router.push).toHaveBeenCalledWith(`/list?c=${encodeURIComponent(FOOD)}&version=${CURATOR}`);
  });

  it("reads the version a link names, and says how to go back", async () => {
    relays(food);
    open(FOOD, CURATOR);

    await title();
    expect(screen.getByText("The community header")).toBeTruthy();
    expect(screen.getByText("This is the community’s own header.")).toBeTruthy();
    const back = screen.getByRole("link", { name: "Show the version that applies to me" });
    expect(back.getAttribute("href")).toBe(`/list?c=${encodeURIComponent(FOOD)}`);
  });

  it("sends a copy's link to its concept, with the copy chosen, by replacing the page", async () => {
    relays(food);
    open(`39998:${REAL_HOUSE}:food-and-drink-places`);

    await vi.waitFor(() =>
      expect(nav.router.replace).toHaveBeenCalledWith(`/list?c=${encodeURIComponent(FOOD)}&version=${REAL_HOUSE}`),
    );
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    expect(nav.router.push).not.toHaveBeenCalled();
    // Nothing of the copy is drawn as a list of its own while it goes.
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("reads again when the reader signs in: their own copy governs", async () => {
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
    relays([...food, mine]);
    open(FOOD);

    expect((await title()).textContent).toBe("Food and Drink Places");
    act(() => useSigner.setState({ pubkey: getPublicKey(reader), status: "connected" }));
    await vi.waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Eats"));
    expect(screen.getByText("Your version")).toBeTruthy();
    // The community header, theirs, the house's and two others': five versions.
    expect(screen.getByRole("button", { name: /5 versions/ })).toBeTruthy();

    act(() => useSigner.setState({ pubkey: null, status: "disconnected" }));
    await vi.waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Food and Drink Places"));
  });

  it("opens from the copies when the community header can't be fetched, saying so", async () => {
    relays(food.filter((e) => e.pubkey !== CURATOR));
    open(FOOD);

    expect((await title()).textContent).toBe("Food and Drink Places");
    expect(screen.getByText("header not found")).toBeTruthy();
    expect(screen.getByText(/The community header was not found/)).toBeTruthy();
  });

  it("says so when nothing is known about the link, and when there is no link", async () => {
    relays(food);
    const { unmount } = open(`39998:${CURATOR}:nowhere`);
    await screen.findByText("List not found.");
    expect(screen.getByText("header not found")).toBeTruthy();
    unmount();

    nav.params = new URLSearchParams();
    render(<ListPage />);
    expect(screen.getByText("No list chosen")).toBeTruthy();
  });

  it("loads from dcosl when the index refuses, and says which relay didn't answer", async () => {
    relays(food, { refuses: "error: vespa searched only 67% of the corpus" });
    open(FOOD);

    expect((await title()).textContent).toBe("Food and Drink Places");
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("the index (search.brainstorm.world)");
  });
});

describe("a list's items", () => {
  it("rows read through the version shown: name, address, the website's host, and a Map loaded only when asked", async () => {
    relays([...food, ...foodRows]);
    open(FOOD, CURATOR);

    const steak = (await screen.findByRole("heading", { level: 3, name: "Steak 'n Shake" })).closest("article")!;
    const row = within(steak);
    expect(row.getByText("7515 North Grand Prairie Drive Peoria 61615")).toBeTruthy();
    const website = row.getByRole("link", { name: /www\.steaknshake\.com/ });
    expect(website.getAttribute("href")).toBe("https://www.steaknshake.com/locations/il-peoria-n-grand-prairie-drive/");
    expect(website.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(row.getByText("Listed by")).toBeTruthy();

    expect(steak.querySelector("iframe")).toBeNull();
    fireEvent.click(row.getByRole("button", { name: "Map" }));
    expect(steak.querySelector("iframe")?.getAttribute("src")).toMatch(/^https:\/\/www\.openstreetmap\.org\/export\/embed\.html\?/);
    // Only the row asked shows a map.
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("counts the list with its own plural, from the index, saying so; the loaded count when the index refuses", async () => {
    relays([...food, ...foodRows]);
    const { unmount } = open(FOOD, CURATOR);
    expect(await screen.findByText(`${foodRows.length} Food and Drink Places`)).toBeTruthy();
    expect(screen.getByText("counted before the web-of-trust filter")).toBeTruthy();
    unmount();

    relays([...food, ...foodRows], { refuses: "error: vespa searched only 67% of the corpus" });
    open(FOOD, CURATOR);
    await screen.findByRole("heading", { level: 3, name: "Steak 'n Shake" });
    expect(screen.getByText(`${foodRows.length} Food and Drink Places`)).toBeTruthy();
    expect(screen.queryByText("counted before the web-of-trust filter")).toBeNull();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("a Tags list titles its rows from their JSON, never from the app that wrote them", async () => {
    const root = (tagsHeaders as NostrEvent[]).find((h) => !h.tags.some((t) => t[0] === "b"))!;
    relays([...(tagsHeaders as NostrEvent[]), ...(tagsItems as NostrEvent[])]);
    open(`39998:${root.pubkey}:tag`);

    expect(await screen.findByRole("heading", { level: 3, name: "Classics" })).toBeTruthy();
    expect(screen.queryByText("Brainstorm")).toBeNull();
  });

  it("opens from its items when no header can be found, saying so, with every row untitled", async () => {
    relays(foodRows);
    open(FOOD);

    expect((await title()).textContent).toBe("Untitled list");
    expect(screen.getByText("header not found")).toBeTruthy();
    await vi.waitFor(() => expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(foodRows.length));
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(
      foodRows.map(() => "Untitled item"),
    );
  });

  it("folds items from outside the reader's web of trust, opens them in place, and never shows a rank", async () => {
    const house = generateSecretKey();
    const ta = generateSecretKey();
    const friend = generateSecretKey();
    const SCORES = "wss://scores.example.test";
    houseIs(getPublicKey(house));
    const sign = <T extends { kind: number; tags: string[][]; content?: string }>(sk: Uint8Array, ev: T) =>
      finalizeEvent({ created_at: 1_792_800_000, content: "", ...ev }, sk) as NostrEvent;
    const declaration = sign(house, { kind: 10040, tags: [["30382:rank", getPublicKey(ta), SCORES]] });
    // Ranks with figures nothing else on the page has, so a leak would show.
    const scores = [
      sign(ta, { kind: 30382, tags: [["d", getPublicKey(friend)], ["rank", "87.654321"]] }),
      sign(ta, { kind: 30382, tags: [["d", IMPORTER], ["rank", "1.234567"]] }),
    ];
    const mine = sign(friend, {
      kind: 39999,
      tags: [["d", "luna"], ["z", FOOD], ["name", "Cafe Luna"], ["category", "cafe"]],
    });
    const corpus = relayCorpus({
      [DCOSL]: [...food, ...foodRows, mine],
      [TAG_HUB]: [],
      [INDEX]: [...food, ...foodRows, mine],
      [SCORES]: scores,
      ...Object.fromEntries(PROFILE_RELAYS.map((r) => [r, [declaration]])),
    });
    setTransport(corpus.transport);
    open(FOOD, CURATOR);

    await screen.findByRole("heading", { level: 3, name: "Cafe Luna" });
    const fold = await screen.findByRole("button", { name: `${foodRows.length} more from accounts outside your web of trust` });
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Cafe Luna"]);

    fireEvent.click(fold);
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(foodRows.length + 1);
    expect(screen.getAllByText("outside your web of trust")).toHaveLength(foodRows.length);

    // Show everything puts them inline, each still labelled.
    fireEvent.click(fold);
    act(() => useView.getState().set(true));
    expect(screen.queryByRole("button", { name: /more from accounts outside/ })).toBeNull();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(foodRows.length + 1);
    expect(screen.getAllByText("outside your web of trust")).toHaveLength(foodRows.length);

    const html = document.body.innerHTML;
    for (const figure of ["87.65", "87,65", "1.2345", "1,2345"]) expect(html).not.toContain(figure);
  });

  it("folds nothing when the scorer's relay doesn't answer", async () => {
    const house = generateSecretKey();
    const ta = generateSecretKey();
    houseIs(getPublicKey(house));
    const declaration = finalizeEvent(
      { kind: 10040, created_at: 1_792_800_000, content: "", tags: [["30382:rank", getPublicKey(ta), "wss://scores.example.test"]] },
      house,
    ) as NostrEvent;
    // The scores relay isn't held, so every read of it fails.
    setTransport(
      relayCorpus({
        [DCOSL]: [...food, ...foodRows],
        [TAG_HUB]: [],
        [INDEX]: [...food, ...foodRows],
        ...Object.fromEntries(PROFILE_RELAYS.map((r) => [r, [declaration]])),
      }).transport,
    );
    open(FOOD, CURATOR);

    await screen.findByRole("heading", { level: 3, name: "Steak 'n Shake" });
    await vi.waitFor(() => expect(useRelayStatus.getState().statuses["wss://scores.example.test"]).toBe("error"));
    // Let the (empty) ranks that failed read gave reach the page: read as "nobody is inside", they'd fold every row.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(foodRows.length);
    expect(screen.queryByRole("button", { name: /more from accounts outside/ })).toBeNull();
  });
});

describe("changing a list", () => {
  /** A reader with no copy of Food, and the authors of two of the real copies: one still a copy, one withdrawn. */
  const READER = "c".repeat(64);
  const COPIER = foodCopies[2].pubkey;
  const WITHDRAWER = foodCopies[3].pubkey;
  const COMMUNITY = foodHeader[0] as HeaderEvent;
  const COPY = foodCopies[2] as HeaderEvent;
  const OWN_RELAY_MISSED = [{ ok: false as const, from: "wss://own.example.test", message: "timed out" }];

  /** What the list relay hands back for a template: it, signed by `pubkey`, as the newest header there is. */
  const signedBy = (pubkey: string, template: { kind: number; content: string; tags: string[][] }, failed: PublishResult["failed"] = []): PublishResult => ({
    event: { ...template, id: "f".repeat(64), pubkey, created_at: 1_793_000_000, sig: "5".repeat(128) },
    onHub: true,
    hubMessage: null,
    accepted: [DCOSL],
    failed,
  });
  const refusedByList: PublishResult = {
    event: { id: "f".repeat(64), pubkey: COPIER, created_at: 1_793_000_000, kind: 39998, tags: [], content: "", sig: "5".repeat(128) },
    onHub: false,
    hubMessage: "blocked: not allowed",
    accepted: [],
    failed: [{ ok: false, from: DCOSL, message: "blocked: not allowed" }],
  };

  const signIn = (pubkey: string) => useSigner.setState({ pubkey, method: "extension", status: "connected", error: null });
  const button = (name: string) => screen.getByRole("button", { name });
  const maybe = (name: string) => screen.queryByRole("button", { name });
  const click = (name: string) => fireEvent.click(button(name));
  const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const published = (n = 0) => vi.mocked(signAndPublish).mock.calls[n][0];
  const WITHDRAW_ASKED = "Withdraw your version of Food and Drink Places? It will stop counting as a version of this concept.";

  beforeEach(() => {
    relays(food);
    vi.mocked(signAndPublish).mockImplementation(async (template) => signedBy(useSigner.getState().pubkey!, template));
  });

  it("offers nothing to change to a reader who is signed out", async () => {
    open(FOOD);
    await title();

    for (const name of ["Edit list", "Edit my version", "Make my own version", "Withdraw my version"]) {
      expect(maybe(name)).toBeNull();
    }
  });

  describe("making a version of one's own", () => {
    it("is offered on a list the reader has no version of, and publishes the community header's exact copy when saved untouched", async () => {
      signIn(READER);
      open(FOOD);
      await title();
      expect(maybe("Edit list")).toBeNull();
      expect(maybe("Withdraw my version")).toBeNull();

      click("Make my own version");
      expect(screen.getByRole("form", { name: "Make my own version" })).toBeTruthy();
      click("Publish");

      await vi.waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(1));
      expect(published()).toEqual(exactCopyTemplate(definitionOf(COMMUNITY)));
      expect(published().tags).toContainEqual(["b", FOOD, "pointer"]);
    });

    it("shows the reader's version once saved, by sending the page to it", async () => {
      signIn(READER);
      open(FOOD);
      await title();
      expect(screen.getByText("Brainstorm’s version")).toBeTruthy();

      click("Make my own version");
      type("Plural name", "Eats");
      click("Publish");

      await vi.waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Eats"));
      expect(screen.getByText("Your version")).toBeTruthy();
      expect(screen.queryByRole("form")).toBeNull();
      expect(nav.router.replace).toHaveBeenCalledWith(`/list?c=${encodeURIComponent(FOOD)}&version=${READER}`);
      // It is theirs now: changed or withdrawn, not made again.
      expect(maybe("Make my own version")).toBeNull();
      expect(maybe("Edit list")).toBeTruthy();
      expect(maybe("Withdraw my version")).toBeTruthy();
    });

    it("starts from the community header, not from the version that is shown", async () => {
      signIn(READER);
      open(FOOD);
      await title();
      expect(screen.getByText("Brainstorm’s version")).toBeTruthy();

      click("Make my own version");

      // The house's version makes its recommended fields optional; the community header does not.
      expect((screen.getByLabelText("Field 3 requirement") as HTMLSelectElement).value).toBe("recommended");
      expect(screen.getAllByLabelText(/^Field \d+ name$/)).toHaveLength(definitionOf(COMMUNITY).fields.length);
    });
  });

  describe("changing a version of one's own", () => {
    it("is offered while another version is shown, and publishes the reader's copy with the change", async () => {
      signIn(COPIER);
      open(FOOD, REAL_HOUSE);
      await title();
      expect(maybe("Edit list")).toBeNull();
      expect(maybe("Make my own version")).toBeNull();

      click("Edit my version");
      expect(screen.getByRole("form", { name: "Edit my version" })).toBeTruthy();
      expect((screen.getByLabelText("Plural name") as HTMLInputElement).value).toBe("Food and Drink Places");
      type("Plural name", "Eats");
      click("Publish");

      await vi.waitFor(() => expect(signAndPublish).toHaveBeenCalledTimes(1));
      expect(published().kind).toBe(39998);
      expect(published().tags).toContainEqual(["d", "food-and-drink-places"]);
      expect(published().tags).toContainEqual(["names", "Food and Drink Place", "Eats"]);
      expect(published().tags).toContainEqual(["b", FOOD, "pointer"]);
      await vi.waitFor(() =>
        expect(nav.router.replace).toHaveBeenCalledWith(`/list?c=${encodeURIComponent(FOOD)}&version=${COPIER}`),
      );
    });

    it("is Edit list when the reader's own version is the one shown, and the change shows in place", async () => {
      signIn(COPIER);
      open(FOOD);
      await title();
      expect(screen.getByText("Your version")).toBeTruthy();
      expect(maybe("Edit my version")).toBeNull();

      click("Edit list");
      type("Plural name", "Eats");
      click("Publish");

      await vi.waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Eats"));
      expect(screen.queryByRole("form")).toBeNull();
      expect(signAndPublish).toHaveBeenCalledTimes(1);
      // Everything the form doesn't speak stays as the reader's copy had it.
      expect(published().tags).toContainEqual(["b", FOOD, "pointer"]);
      expect(published().tags.filter((t) => t[0] === "required")).toEqual(COPY.tags.filter((t) => t[0] === "required"));
    });

    it("is Edit list on the community header for the reader who wrote it, saved to the header's own short name", async () => {
      signIn(CURATOR);
      open(FOOD, CURATOR);
      await title();

      click("Edit list");
      type("Description", "Where to eat");
      click("Publish");

      await vi.waitFor(() => expect(screen.getByText("Where to eat")).toBeTruthy());
      expect(published().tags).toContainEqual(["d", "food-and-drink-places"]);
      expect(published().tags).toContainEqual(["description", "Where to eat"]);
      expect(published().tags).toContainEqual(["b", FOOD, "pointer"]);
      // Its own list, not a version: the address keeps the community header.
      expect(nav.router.replace).not.toHaveBeenCalled();
    });

    it("stops at a problem Brainstorm's checks would refuse, and says which", async () => {
      signIn(COPIER);
      open(FOOD);
      await title();
      click("Edit list");

      type("Plural name", "");

      expect(screen.getByText("Give the concept a singular and a plural name.")).toBeTruthy();
      expect((button("Publish") as HTMLButtonElement).disabled).toBe(true);
      expect(signAndPublish).not.toHaveBeenCalled();
    });

    it("keeps the form and what was typed when the list relay refuses, and finishes after a Retry that works", async () => {
      vi.mocked(signAndPublish).mockResolvedValue(refusedByList);
      vi.mocked(retryPublish).mockImplementation(async () => signedBy(COPIER, published()));
      signIn(COPIER);
      open(FOOD);
      await title();
      click("Edit list");
      type("Plural name", "Eats");

      click("Publish");

      await screen.findByText(/Not saved to the list relay: blocked: not allowed/);
      expect((screen.getByLabelText("Plural name") as HTMLInputElement).value).toBe("Eats");
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Food and Drink Places");

      click("Retry");

      await vi.waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Eats"));
      expect(retryPublish).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("form")).toBeNull();
    });

    it("waits for the reader to say Done when an own relay missed it, and shows the change then", async () => {
      vi.mocked(signAndPublish).mockImplementation(async (template) => signedBy(COPIER, template, OWN_RELAY_MISSED));
      signIn(COPIER);
      open(FOOD);
      await title();
      click("Edit list");
      type("Plural name", "Eats");

      click("Publish");

      await screen.findByText(/Not saved to 1 of your own relays: own\.example\.test/);
      expect(screen.getByRole("form", { name: "Edit list" })).toBeTruthy();
      expect((screen.getByLabelText("Plural name") as HTMLInputElement).disabled).toBe(true);
      expect(maybe("Publish")).toBeNull();
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Food and Drink Places");

      click("Done");

      await vi.waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Eats"));
      expect(screen.queryByRole("form")).toBeNull();
      expect(signAndPublish).toHaveBeenCalledTimes(1);
    });

    it("keeps what was typed when the signer refuses", async () => {
      vi.mocked(signAndPublish).mockRejectedValue(new SignerError("refused", "Your signer refused to sign."));
      signIn(COPIER);
      open(FOOD);
      await title();
      click("Edit list");
      type("Plural name", "Eats");

      click("Publish");

      await screen.findByText("Your signer refused to sign.");
      expect((screen.getByLabelText("Plural name") as HTMLInputElement).value).toBe("Eats");
      expect((button("Publish") as HTMLButtonElement).disabled).toBe(false);
    });

    it("closes without publishing on Cancel", async () => {
      signIn(COPIER);
      open(FOOD);
      await title();
      click("Edit list");

      click("Cancel");

      expect(screen.queryByRole("form")).toBeNull();
      expect(maybe("Edit list")).toBeTruthy();
      expect(signAndPublish).not.toHaveBeenCalled();
    });
  });

  describe("withdrawing one's version", () => {
    it("asks first, and publishes nothing until the reader confirms", async () => {
      signIn(COPIER);
      open(FOOD);
      await title();

      click("Withdraw my version");

      expect(screen.getByText(WITHDRAW_ASKED)).toBeTruthy();
      expect(maybe("Withdraw my version")).toBeNull();
      expect(signAndPublish).not.toHaveBeenCalled();

      click("Cancel");

      expect(screen.queryByText(WITHDRAW_ASKED)).toBeNull();
      expect(maybe("Withdraw my version")).toBeTruthy();
      expect(signAndPublish).not.toHaveBeenCalled();
    });

    it("publishes the copy withdrawn, and the list goes back to the version that applies", async () => {
      signIn(COPIER);
      open(FOOD);
      await title();
      expect(screen.getByText("Your version")).toBeTruthy();

      click("Withdraw my version");
      click("Withdraw");

      await vi.waitFor(() => expect(screen.getByText("Brainstorm’s version")).toBeTruthy());
      expect(signAndPublish).toHaveBeenCalledTimes(1);
      expect(published()).toEqual(withdrawnTemplate(definitionOf(COPY)));
      expect(published().tags).toContainEqual(["b", B_DEFERRED]);
      expect(screen.queryByText(WITHDRAW_ASKED)).toBeNull();
      expect(maybe("Withdraw my version")).toBeNull();
      // They may make another.
      expect(maybe("Make my own version")).toBeTruthy();
    });

    it("drops the reader's version from the address when that was the one being read", async () => {
      signIn(COPIER);
      open(FOOD, COPIER);
      await title();

      click("Withdraw my version");
      click("Withdraw");

      await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith(`/list?c=${encodeURIComponent(FOOD)}`));
    });

    it("leaves the copy shown when the list relay refuses, and withdraws it after a Retry that works", async () => {
      vi.mocked(signAndPublish).mockResolvedValue(refusedByList);
      vi.mocked(retryPublish).mockImplementation(async () => signedBy(COPIER, published()));
      signIn(COPIER);
      open(FOOD);
      await title();

      click("Withdraw my version");
      click("Withdraw");

      await screen.findByText(/Not saved to the list relay: blocked: not allowed/);
      expect(screen.getByText("Your version")).toBeTruthy();
      expect(screen.getByText(WITHDRAW_ASKED)).toBeTruthy();

      click("Retry");

      await vi.waitFor(() => expect(screen.getByText("Brainstorm’s version")).toBeTruthy());
      expect(retryPublish).toHaveBeenCalledTimes(1);
    });

    it("leaves the copy shown when the signer refuses", async () => {
      vi.mocked(signAndPublish).mockRejectedValue(new SignerError("refused", "Your signer refused to sign."));
      signIn(COPIER);
      open(FOOD);
      await title();

      click("Withdraw my version");
      click("Withdraw");

      await screen.findByText("Your signer refused to sign.");
      expect(screen.getByText("Your version")).toBeTruthy();
      expect(screen.getByText(WITHDRAW_ASKED)).toBeTruthy();
    });

    it("waits for the reader to say Done when an own relay missed it", async () => {
      vi.mocked(signAndPublish).mockImplementation(async (template) => signedBy(COPIER, template, OWN_RELAY_MISSED));
      signIn(COPIER);
      open(FOOD);
      await title();

      click("Withdraw my version");
      click("Withdraw");

      await screen.findByText(/Not saved to 1 of your own relays: own\.example\.test/);
      expect(screen.getByText("Your version")).toBeTruthy();
      expect(maybe("Withdraw")).toBeNull();

      click("Done");

      await vi.waitFor(() => expect(screen.getByText("Brainstorm’s version")).toBeTruthy());
      expect(signAndPublish).toHaveBeenCalledTimes(1);
    });

    it("is not offered on a list the reader has no version of", async () => {
      signIn(READER);
      open(FOOD);
      await title();

      expect(maybe("Withdraw my version")).toBeNull();
    });
  });

  describe("a withdrawn header", () => {
    it("is offered nothing, even to the reader who withdrew it: its page has no community header to copy", async () => {
      signIn(WITHDRAWER);
      open(`39998:${WITHDRAWER}:food-and-drink-places`);
      await title();
      expect(screen.getByText("withdrawn")).toBeTruthy();

      for (const name of ["Edit list", "Edit my version", "Make my own version", "Withdraw my version"]) {
        expect(maybe(name)).toBeNull();
      }
    });
  });

  describe("the address `edit=mine`", () => {
    it("opens the form at load for a reader who has no version of the list", async () => {
      signIn(READER);
      open(FOOD, undefined, "mine");

      expect(await screen.findByRole("form", { name: "Make my own version" })).toBeTruthy();
      expect(signAndPublish).not.toHaveBeenCalled();
    });

    it("opens the form on the version the reader has, when they have one", async () => {
      signIn(COPIER);
      open(FOOD, REAL_HOUSE, "mine");

      expect(await screen.findByRole("form", { name: "Edit my version" })).toBeTruthy();
    });

    it("does nothing for a reader who is signed out", async () => {
      open(FOOD, undefined, "mine");
      await title();

      expect(screen.queryByRole("form")).toBeNull();
    });

    it("opens nothing for another value", async () => {
      signIn(READER);
      open(FOOD, undefined, "yes");
      await title();

      expect(screen.queryByRole("form")).toBeNull();
    });

    it("opens once the reader signs in", async () => {
      open(FOOD, undefined, "mine");
      await title();
      expect(screen.queryByRole("form")).toBeNull();

      act(() => signIn(READER));

      expect(await screen.findByRole("form", { name: "Make my own version" })).toBeTruthy();
    });

    it("drops itself from the address when the form is cancelled, and does not open again", async () => {
      signIn(READER);
      open(FOOD, undefined, "mine");
      await screen.findByRole("form", { name: "Make my own version" });

      click("Cancel");

      expect(screen.queryByRole("form")).toBeNull();
      expect(nav.router.replace).toHaveBeenCalledWith(`/list?c=${encodeURIComponent(FOOD)}`);
      expect(maybe("Make my own version")).toBeTruthy();
    });
  });
});
