// @vitest-environment jsdom
/**
 * A concept's card on Discover: its own name as written, how many versions
 * it has, and a count loaded only once the card scrolls into view.
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardModel } from "@/app/discover-model";

vi.mock("@/services/items", () => ({ countItems: vi.fn() }));
vi.mock("@/components/user-identity", () => ({
  UserIdentity: ({ pubkey }: { pubkey: string }) => <span data-testid="author">{pubkey.slice(0, 4)}</span>,
}));

import { countItems } from "@/services/items";
import { clearCountCache, ConceptCard } from "./concept-card";

const count = vi.mocked(countItems);
const COUNT_TITLE = "Everything filed, before the web-of-trust filter";
const COUNT_NOTE = "counted before the web-of-trust filter";

/** An IntersectionObserver the test drives: `see()` scrolls every observed card into view. */
const observers: { callback: IntersectionObserverCallback; disconnected: boolean }[] = [];
class FakeObserver {
  constructor(callback: IntersectionObserverCallback) {
    observers.push({ callback, disconnected: false });
    this.index = observers.length - 1;
  }
  index: number;
  observe() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
  disconnect() {
    observers[this.index].disconnected = true;
  }
}
const see = () =>
  act(() => {
    for (const o of observers.filter((o) => !o.disconnected)) {
      o.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    }
  });

const AUTHOR = "ab".repeat(32);
const ROOT = `39998:${AUTHOR}:food-and-drink-places`;
const card = (over: Partial<CardModel> = {}): CardModel => ({
  root: ROOT,
  plural: "Food and Drink Places",
  description: "Restaurants, cafes and bars.",
  image: null,
  author: AUTHOR,
  versions: 1,
  label: null,
  copies: [],
  ...over,
});

beforeEach(() => {
  observers.length = 0;
  clearCountCache();
  count.mockReset();
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ConceptCard", () => {
  it("links to /list?c=<coordinate>, encoded", () => {
    render(<ConceptCard card={card()} />);
    const link = screen.getByRole("link", { name: /Food and Drink Places/ });
    expect(link.getAttribute("href")).toBe(`/list?c=${encodeURIComponent(ROOT)}`);
  });

  it("shows the name exactly as written, never capitalized", () => {
    render(<ConceptCard card={card({ plural: "iPhone apps" })} />);
    expect(screen.getByRole("heading", { name: "iPhone apps" })).toBeTruthy();
    render(<ConceptCard card={card({ plural: "tags" })} />);
    expect(screen.getByRole("heading", { name: "tags" })).toBeTruthy();
    expect(screen.queryByText("Tags")).toBeNull();
  });

  it("shows the description, and 'N versions' only when there are copies", () => {
    const { rerender } = render(<ConceptCard card={card()} />);
    expect(screen.getByText("Restaurants, cafes and bars.")).toBeTruthy();
    expect(screen.queryByText(/versions/)).toBeNull();
    rerender(<ConceptCard card={card({ versions: 4 })} />);
    expect(screen.getByText("4 versions")).toBeTruthy();
  });

  it("shows no count until it scrolls into view, then '{count} {plural}' with its title, saying it's counted before the filter", async () => {
    count.mockResolvedValue(1234);
    render(<ConceptCard card={card()} handles={[ROOT, "39998:x:y"]} />);
    expect(count).not.toHaveBeenCalled();
    expect(screen.queryByTitle(COUNT_TITLE)).toBeNull();

    see();
    expect(count).toHaveBeenCalledWith([ROOT, "39998:x:y"]);
    const shown = await screen.findByText(`${(1234).toLocaleString()} Food and Drink Places`);
    expect(shown.getAttribute("title")).toBe(COUNT_TITLE);
    expect(screen.getByText(COUNT_NOTE)).toBeTruthy();
  });

  it("asks once, however many times it is seen", async () => {
    count.mockResolvedValue(7);
    render(<ConceptCard card={card()} handles={[ROOT]} />);
    see();
    see();
    await screen.findByText("7 Food and Drink Places");
    expect(count).toHaveBeenCalledTimes(1);
  });

  it("shows nothing when the index gives no count", async () => {
    count.mockResolvedValue(null);
    render(<ConceptCard card={card()} handles={[ROOT]} />);
    see();
    await vi.waitFor(() => expect(count).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTitle(COUNT_TITLE)).toBeNull();
    expect(screen.queryByText(COUNT_NOTE)).toBeNull();
    expect(screen.getByRole("heading", { name: "Food and Drink Places" })).toBeTruthy(); // the card still renders
  });

  it("a card with no handles never asks", () => {
    render(<ConceptCard card={card({ label: "blank" })} />);
    see();
    expect(count).not.toHaveBeenCalled();
  });

  it("remembers a count, so a card that comes back doesn't ask again", async () => {
    count.mockResolvedValue(5);
    const first = render(<ConceptCard card={card()} handles={[ROOT]} />);
    see();
    await screen.findByText("5 Food and Drink Places");
    first.unmount();
    render(<ConceptCard card={card()} handles={[ROOT]} />);
    await screen.findByText("5 Food and Drink Places");
    see();
    expect(count).toHaveBeenCalledTimes(1);
  });

  it("stops listening when it unmounts before it was seen", () => {
    const { unmount } = render(<ConceptCard card={card()} handles={[ROOT]} />);
    unmount();
    expect(observers.every((o) => o.disconnected)).toBe(true);
    see();
    expect(count).not.toHaveBeenCalled();
  });

  it("asks at once where there is no IntersectionObserver", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    count.mockResolvedValue(3);
    render(<ConceptCard card={card()} handles={[ROOT]} />);
    await screen.findByText("3 Food and Drink Places");
  });

  it("labels a withdrawn or blank concept", () => {
    const { rerender } = render(<ConceptCard card={card({ label: "withdrawn" })} />);
    expect(screen.getByText("withdrawn")).toBeTruthy();
    rerender(<ConceptCard card={card({ label: "blank" })} />);
    expect(screen.getByText("blank")).toBeTruthy();
    expect(screen.queryByText("withdrawn")).toBeNull();
  });

  it("lists its copies, each its own link, labelled 'copy' or 'withdrawn'", () => {
    const copy = (over: Partial<CardModel>): CardModel => card({ author: "cd".repeat(32), ...over });
    const copies = [
      copy({ root: `39998:${"cd".repeat(32)}:food`, plural: "Eats", label: null }),
      copy({ root: `39998:${"ef".repeat(32)}:food`, plural: "Old eats", label: "withdrawn" }),
    ];
    render(<ConceptCard card={card({ versions: 2, copies })} />);
    const eats = screen.getByRole("link", { name: /Eats/ });
    expect(eats.getAttribute("href")).toBe(`/list?c=${encodeURIComponent(copies[0].root)}`);
    expect(eats.textContent).toContain("copy");
    const old = screen.getByRole("link", { name: /Old eats/ });
    expect(old.textContent).toContain("withdrawn");
    expect(old.textContent).not.toContain("copy");
    // no link sits inside another
    expect(document.querySelectorAll("a a")).toHaveLength(0);
  });

  it("draws the list's image only when it has one", () => {
    const { container, rerender } = render(<ConceptCard card={card()} />);
    expect(container.querySelector("img")).toBeNull();
    rerender(<ConceptCard card={card({ image: "https://example.com/a.png" })} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://example.com/a.png");
  });
});
