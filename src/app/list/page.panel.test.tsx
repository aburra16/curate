// @vitest-environment jsdom
/**
 * A list page's event panel, over a pretend set of
 * relays holding the real Food and Drink Places header, copies and items of
 * 31 October: a click on a row, or "View event", puts the panel in the URL
 * (the page's query beside `c`); a URL with the panel in it opens it, held
 * item or not; closing goes back the way it came; and an event the page
 * doesn't hold, or can't find, says so.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { NostrEvent } from "nostr-tools";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RELAYS } from "@/lib/nostr/relays";
import { clearSeenOn } from "@/services/nostr";
import { DCOSL, INDEX, PROFILE_RELAYS, TAG_HUB } from "@/services/relays";
import { setTransport, type RelayTransport } from "@/services/transport";
import { clearTrustCaches } from "@/services/trust";
import { useRelayStatus } from "@/stores/relay-status";
import { useSettings } from "@/stores/settings";
import { useSigner } from "@/stores/signer";
import { useView } from "@/stores/view";
import { relayCorpus } from "@/test/relayCorpus";
import foodCopies from "@/test/fixtures/food.copies.json";
import foodHeader from "@/test/fixtures/food.header.json";
import foodItems from "@/test/fixtures/food.items.json";

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
  useRouter: () => nav.router,
}));
// A link inside the panel goes where Next would send it: the router.
vi.mock("next/link", () => ({
  default: ({
    href,
    replace,
    scroll,
    children,
    ...rest
  }: {
    href: string;
    replace?: boolean;
    scroll?: boolean;
    children?: ReactNode;
    className?: string;
  }) => (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        e.preventDefault();
        (replace ? nav.router.replace : nav.router.push)(href, { scroll });
      }}
    >
      {children}
    </a>
  ),
}));
vi.mock("@/components/user-identity", () => ({
  UserIdentity: ({ pubkey }: { pubkey: string }) => <span data-testid="author">{pubkey.slice(0, 4)}</span>,
}));

import ListPage from "./page";

const REAL_HOUSE = "be7bf5de068c1d842ed34a7c270507ec940f5ea51671cfd062a95e9d09420d0a";
const CURATOR = "b83a28b7e4e5d20bd960c5faeb6625f95529166b8bdb045d42634a2f35919450";
const FOOD = `39998:${CURATOR}:food-and-drink-places`;

const food = [...foodHeader, ...foodCopies] as NostrEvent[];
const rows = foodItems as NostrEvent[];
const steak = rows[0];
const STEAK = `39999:${steak.pubkey}:osm-way-91202967`;

function relays(events: NostrEvent[]) {
  const corpus = relayCorpus({
    [DCOSL]: events,
    [TAG_HUB]: events,
    [INDEX]: events,
    ...Object.fromEntries(PROFILE_RELAYS.map((r) => [r, [] as NostrEvent[]])),
  });
  setTransport(corpus.transport);
  return corpus;
}

/** Open the page at `/list?c=FOOD&version=CURATOR` (the community header) plus whatever else the URL says. */
function open(extra: Record<string, string> = {}, version: string | null = CURATOR) {
  nav.params = new URLSearchParams({ c: FOOD, ...(version ? { version } : {}), ...extra });
  return render(<ListPage />);
}

/** The URL a push or replace was asked to go to, as the page's query. */
const queryOf = (href: string) => new URLSearchParams(href.split("?")[1]);
const dialog = () => screen.findByRole("dialog");
const rowTitle = (name: string) => screen.findByRole("heading", { level: 3, name });

beforeEach(() => {
  clearTrustCaches();
  clearSeenOn();
  localStorage.clear();
  sessionStorage.clear();
  useRelayStatus.getState().reset();
  useSettings.setState({ relays: [...DEFAULT_RELAYS] });
  useView.setState({ on: false, loaded: true });
  useSigner.setState({ pubkey: null, status: "disconnected", error: null });
  for (const fn of Object.values(nav.router)) fn.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ names: { _: REAL_HOUSE } }) })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("opening the panel", () => {
  it("a click on a row's title puts the item in the URL, keeping the list's own query", async () => {
    relays([...food, ...rows]);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Steak 'n Shake" }));

    expect(nav.router.push).toHaveBeenCalledTimes(1);
    const [href, options] = nav.router.push.mock.calls[0];
    expect(href.startsWith("/list?")).toBe(true);
    expect([...queryOf(href)]).toEqual([
      ["c", FOOD],
      ["version", CURATOR],
      ["item", STEAK],
    ]);
    expect(options).toEqual({ scroll: false });
    // The URL is the state: nothing opens until it says so.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a click on the row opens it, but not a click on a link or a control inside it", async () => {
    relays([...food, ...rows]);
    open();
    const article = (await rowTitle("Steak 'n Shake")).closest("article")!;

    fireEvent.click(within(article).getByRole("link", { name: /steaknshake\.com/ }));
    fireEvent.click(within(article).getByRole("button", { name: "Map" }));
    expect(nav.router.push).not.toHaveBeenCalled();

    // Selecting text in the row isn't asking to open it.
    const selection = vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "Peoria" } as Selection);
    fireEvent.click(article);
    expect(nav.router.push).not.toHaveBeenCalled();
    selection.mockRestore();

    fireEvent.click(within(article).getByText("7515 North Grand Prairie Drive Peoria 61615"));
    expect(nav.router.push).toHaveBeenCalledTimes(1);
    expect(queryOf(nav.router.push.mock.calls[0][0]).get("item")).toBe(STEAK);
  });

  it("View event on the header puts event=header in the URL", async () => {
    relays(food);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "View event" }));
    expect(queryOf(nav.router.push.mock.calls[0][0]).get("event")).toBe("header");
    expect(queryOf(nav.router.push.mock.calls[0][0]).get("c")).toBe(FOOD);
  });

  it("a shared ?item= link reopens the panel on that item, with Item first", async () => {
    relays([...food, ...rows]);
    open({ item: STEAK });

    const d = await dialog();
    expect(await within(d).findByRole("heading", { name: "Steak 'n Shake" })).toBeTruthy();
    expect(within(d).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Item", "Pretty", "Raw"]);
    expect(within(d).getByRole("tab", { name: "Item" }).getAttribute("aria-selected")).toBe("true");
    // Read through the list's definition: its fields, with the header's words.
    expect(within(d).getByText("Name of the business")).toBeTruthy();
  });

  it("the Pretty tab labels g as a field and alt as metadata, and links the z to its list", async () => {
    relays([...food, ...rows]);
    open({ item: STEAK });
    fireEvent.click(await screen.findByRole("tab", { name: "Pretty" }));

    const rowFor = (name: string) =>
      screen.getAllByRole("rowheader").find((h) => h.querySelector("span")?.textContent === name)!.closest("tr")!;
    expect(within(rowFor("g")).getByText("field")).toBeTruthy();
    expect(within(rowFor("alt")).getByText("metadata")).toBeTruthy();
    expect(within(rowFor("z")).getByRole("link", { name: FOOD }).getAttribute("href")).toBe(
      `/list?c=${encodeURIComponent(FOOD)}`,
    );
  });

  it("Raw is exactly the event the relay sent", async () => {
    relays([...food, ...rows]);
    const { container } = open({ item: STEAK });
    fireEvent.click(await screen.findByRole("tab", { name: "Raw" }));
    expect(container.querySelector("pre")!.textContent).toBe(JSON.stringify(steak, null, 2));
  });

  it("?event=header opens the header the page shows: Pretty and Raw, and a copy's b is a link to the concept", async () => {
    relays(food);
    // Signed out, Brainstorm's copy governs: its b points at the community header.
    open({ event: "header" }, null);
    const d = await dialog();
    expect(within(d).getByRole("heading", { name: "Food and Drink Places" })).toBeTruthy();
    expect(within(d).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Pretty", "Raw"]);
    expect(within(d).queryByText("Itself (canonical)")).toBeNull();
    const concept = within(d).getAllByRole("link", { name: FOOD }).find((l) => l.closest("section")?.querySelector("h3")?.textContent === "Concept");
    expect(concept?.getAttribute("href")).toBe(`/list?c=${encodeURIComponent(FOOD)}`);
  });

  it("the community header's Pretty names its b as itself (canonical), and its Raw lists every copy", async () => {
    relays(food);
    open({ event: "header" });
    const d = await dialog();
    expect(within(d).getByText("Itself (canonical)")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Raw" }));
    const select = (await screen.findByRole("combobox", { name: "Copy of the concept" })) as HTMLSelectElement;
    const options = [...select.options].map((o) => o.textContent);
    expect(options.length).toBe(4);
    expect(options.some((o) => o!.startsWith("Community header"))).toBe(true);
    expect(options.some((o) => o!.startsWith("Brainstorm’s"))).toBe(true);
    // Switching copies changes the Raw only.
    const other = (foodCopies as NostrEvent[])[1];
    fireEvent.change(select, { target: { value: other.id } });
    expect(d.querySelector("pre")!.textContent).toBe(JSON.stringify(other, null, 2));
  });
});

describe("an event the page doesn't hold", () => {
  it("is read from the relays once the first page is in, and is an item when it's filed under the list", async () => {
    relays([...food, ...rows]);
    // The page's own first page holds the other two; the third is only a link away.
    open({ item: `39999:${rows[2].pubkey}:osm-way-867841194` });
    const d = await dialog();
    expect(await within(d).findByRole("heading", { name: "The Rare Smokey Mare" })).toBeTruthy();
    expect(within(d).getByRole("tab", { name: "Item" })).toBeTruthy();
  });

  it("an id works as well as an address", async () => {
    relays([...food, ...rows]);
    open({ item: rows[1].id });
    expect(await within(await dialog()).findByRole("heading", { name: "Mi-Sant Banh Mi Co." })).toBeTruthy();
  });

  it("an event of another list is shown by Pretty and Raw alone", async () => {
    const stranger = { ...foodHeader[0] } as NostrEvent;
    relays([...food, ...rows]);
    open({ item: stranger.id });
    const d = await dialog();
    expect(await within(d).findByRole("heading", { name: "Food and Drink Places" })).toBeTruthy();
    expect(within(d).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Pretty", "Raw"]);
  });

  it("says no relay returned an event nobody has", async () => {
    relays([...food, ...rows]);
    open({ item: `39999:${CURATOR}:nowhere` });
    const d = await dialog();
    await within(d).findByText("No relay returned that event.");
    expect(within(d).queryAllByRole("tab")).toHaveLength(0);
  });

  it("says a link that names no event names none", async () => {
    relays([...food, ...rows]);
    open({ item: "javascript:alert(1)" });
    expect((await within(await dialog()).findByRole("status")).textContent).toMatch(/does not name an event/);
  });
});

describe("closing the panel", () => {
  it("Escape goes back when a click opened it, and focus returns to what was clicked", async () => {
    relays([...food, ...rows]);
    const { rerender } = open();
    const opener = await screen.findByRole("button", { name: "Steak 'n Shake" });
    fireEvent.click(opener);
    // The router moves the URL; the page follows.
    nav.params = queryOf(nav.router.push.mock.calls[0][0]);
    rerender(<ListPage />);
    const d = await dialog();
    expect(document.activeElement).toBe(d);

    fireEvent.keyDown(d, { key: "Escape" });
    expect(nav.router.back).toHaveBeenCalledTimes(1);
    expect(nav.router.replace).not.toHaveBeenCalled();
    nav.params = new URLSearchParams({ c: FOOD, version: CURATOR });
    rerender(<ListPage />);
    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("closing a panel a link opened replaces the URL with the list's own", async () => {
    relays([...food, ...rows]);
    open({ item: STEAK });
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    expect(nav.router.back).not.toHaveBeenCalled();
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    const [href, options] = nav.router.replace.mock.calls[0];
    expect([...queryOf(href)]).toEqual([
      ["c", FOOD],
      ["version", CURATOR],
    ]);
    expect(options).toEqual({ scroll: false });
  });
});

describe("a list opened from its items (header not found)", () => {
  it("opens an item's panel, and the Item tab says why it can't render", async () => {
    // The list's items are there; its header and copies are not.
    relays(rows);
    const { container } = open({ item: STEAK });
    const d = await dialog();
    expect(await within(d).findByRole("heading", { name: "Untitled item" })).toBeTruthy();
    expect(within(d).getByRole("note").textContent).toMatch(/header was not found/);
    fireEvent.click(within(d).getByRole("tab", { name: "Pretty" }));
    expect(within(d).getAllByRole("rowheader").length).toBe(steak.tags.length);
    fireEvent.click(within(d).getByRole("tab", { name: "Raw" }));
    expect(container.querySelector("pre")!.textContent).toBe(JSON.stringify(steak, null, 2));
  });

  it("?event=header has no header to show, and says so", async () => {
    relays(rows);
    open({ event: "header" });
    expect((await within(await dialog()).findByRole("status")).textContent).toMatch(/header was not found/);
  });
});

describe("following a link inside the panel", () => {
  const sk = generateSecretKey();
  const lister = getPublicKey(sk);
  const item = (name: string, created_at: number, extra: string[][] = []) =>
    finalizeEvent(
      {
        kind: 39999,
        created_at,
        content: "",
        tags: [["d", name.toLowerCase()], ["z", FOOD], ["name", name], ["category", "cafe"], ...extra],
      },
      sk,
    ) as NostrEvent;
  const HEADER_ID = foodHeader[0].id;
  const BETA = `39999:${lister}:beta`;
  // Alpha points at Beta (held by the page) and at the Food header (not an item: it has to be read).
  const alpha = item("Alpha", 1_792_000_200, [["a", BETA], ["e", HEADER_ID]]);
  const beta = item("Beta", 1_792_000_100);

  /** The router moved the URL; the page follows. */
  const follow = (rerender: (ui: React.ReactElement) => void, call: { mock: { calls: unknown[][] } }) => {
    nav.params = queryOf(call.mock.calls.at(-1)![0] as string);
    rerender(<ListPage />);
  };
  const closedUrl = () => new URLSearchParams({ c: FOOD, version: CURATOR });

  /** Open Alpha's panel by clicking its row, on Pretty. */
  async function openAlpha() {
    relays([...food, alpha, beta]);
    const view = open();
    const opener = await screen.findByRole("button", { name: "Alpha" });
    fireEvent.click(opener);
    follow(view.rerender, nav.router.push);
    const d = await dialog();
    await within(d).findByRole("heading", { name: "Alpha" });
    fireEvent.click(within(d).getByRole("tab", { name: "Pretty" }));
    return { ...view, opener, d };
  }

  it("Escape still closes the panel after a link to an event the page holds, and focus goes back to the row", async () => {
    const { rerender, opener, d } = await openAlpha();
    const link = within(d).getByRole("link", { name: BETA });
    link.focus();
    fireEvent.click(link);
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    follow(rerender, nav.router.replace);
    await within(await dialog()).findByRole("heading", { name: "Beta" });

    // The link that had focus went with Alpha's tags: focus is in the dialog, not on the page behind.
    expect(link.isConnected).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    // What a click opened, Back closes; following a link added no entry of its own.
    expect(nav.router.back).toHaveBeenCalledTimes(1);
    nav.params = closedUrl();
    rerender(<ListPage />);
    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("Escape closes the panel while a link's event is still being read, and focus goes back to the row", async () => {
    const { rerender, opener, d } = await openAlpha();
    // The relays hold the header, but answer a read for it only when the test says so.
    const corpus = relays([...food, alpha, beta]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow: RelayTransport = {
      ...corpus.transport,
      req: (relay, filters, onEvent, timeoutMs) =>
        filters.some((f) => f.ids?.includes(HEADER_ID))
          ? gate.then(() => corpus.transport.req(relay, filters, onEvent, timeoutMs))
          : corpus.transport.req(relay, filters, onEvent, timeoutMs),
    };
    setTransport(slow);

    const link = within(d).getByRole("link", { name: HEADER_ID });
    link.focus();
    fireEvent.click(link);
    follow(rerender, nav.router.replace);

    // Reading: no tabs, no event, and the link that had focus is gone.
    expect(screen.getByRole("status").textContent).toMatch(/Reading the event/);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(link.isConnected).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(nav.router.back).toHaveBeenCalledTimes(1);
    nav.params = closedUrl();
    rerender(<ListPage />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);

    // The read that was cut short comes back to a page that has moved on.
    release();
    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the event that was read opens in the panel, with focus in it, when the reader waits", async () => {
    const { rerender, d } = await openAlpha();
    const link = within(d).getByRole("link", { name: HEADER_ID });
    link.focus();
    fireEvent.click(link);
    follow(rerender, nav.router.replace);
    const next = await screen.findByRole("heading", { name: "Food and Drink Places" });
    expect(next).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Pretty", "Raw"]);
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });
});
