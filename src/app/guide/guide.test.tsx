// @vitest-environment jsdom
/** The guide's index and its pages, as the static export draws them. */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { guidePages } from "@/lib/guide/content";
import { guideFile, guideFolder } from "@/test/guideFolder";

import GuideArticle, { dynamicParams, generateMetadata, generateStaticParams } from "./[slug]/page";
import GuideIndex from "./page";

const FIRST = guidePages()[0];

/** What a page is asked for: its slug, as the router hands it over. */
const forSlug = (slug: string) => ({ params: Promise.resolve({ slug }) });

describe("the guide index", () => {
  it("has a title and a short introduction", () => {
    render(<GuideIndex />);

    expect(screen.getByRole("heading", { level: 1, name: "Guide" })).toBeTruthy();
    expect(screen.getByText(/This guide explains what that means in plain words/)).toBeTruthy();
  });

  it("shows every page as a card with its title and its summary, linked to the page", () => {
    const { container } = render(<GuideIndex />);

    for (const page of guidePages()) {
      const links = container.querySelectorAll<HTMLElement>(`a[href="/guide/${page.slug}"]`);
      expect(links).toHaveLength(1);
      expect(within(links[0]).getByRole("heading", { level: 2, name: page.title })).toBeTruthy();
      expect(within(links[0]).getByText(page.summary)).toBeTruthy();
    }
  });

  it("points people who would rather ask an AI at llms.txt", () => {
    render(<GuideIndex />);

    const box = screen.getByRole("complementary");
    expect(box.textContent).toBe(
      "Prefer to ask an AI? Point it at https://curate.brainstorm.world/llms.txt and ask it to explain DLists.",
    );
    expect(within(box).getByRole("link", { name: "https://curate.brainstorm.world/llms.txt" }).getAttribute("href")).toBe(
      "https://curate.brainstorm.world/llms.txt",
    );
  });
});

describe("a guide page", () => {
  it("draws the page's title as its heading and its Markdown as the text", async () => {
    render(await GuideArticle(forSlug(FIRST.slug)));

    expect(screen.getByRole("heading", { level: 1, name: FIRST.title })).toBeTruthy();
    const prose = screen.getByRole("article");
    expect(prose.classList.contains("guide-prose")).toBe(true);
    expect(within(prose).getAllByRole("heading", { level: 2 }).length).toBeGreaterThan(0);
  });

  it("links to the page as Markdown", async () => {
    render(await GuideArticle(forSlug(FIRST.slug)));

    const link = screen.getByRole("link", { name: "View this page as Markdown" });
    expect(link.getAttribute("href")).toBe(`/guide/${FIRST.slug}.md`);
  });

  it("links back to the guide", async () => {
    render(await GuideArticle(forSlug(FIRST.slug)));

    expect(screen.getByRole("link", { name: /Guide$/ }).getAttribute("href")).toBe("/guide");
  });

  describe("with pages on either side", () => {
    const folders: { remove: () => void }[] = [];
    afterEach(() => {
      vi.restoreAllMocks();
      for (const folder of folders.splice(0)) folder.remove();
    });

    /** Three pages, read from a folder of their own. */
    function threePages() {
      const folder = guideFolder({
        "01-first.md": guideFile("First page"),
        "02-second.md": guideFile("Second page"),
        "03-third.md": guideFile("Third page"),
      });
      folders.push(folder);
      vi.spyOn(process, "cwd").mockReturnValue(folder.root);
    }

    it("links a middle page to the one before it and the one after it", async () => {
      threePages();
      render(await GuideArticle(forSlug("second")));

      expect(screen.getByRole("link", { name: "Previous First page" }).getAttribute("href")).toBe("/guide/first");
      expect(screen.getByRole("link", { name: "Next Third page" }).getAttribute("href")).toBe("/guide/third");
    });

    it("gives the first page no link back, and the last page none forward", async () => {
      threePages();

      render(await GuideArticle(forSlug("first")));
      expect(screen.queryByRole("link", { name: /^Previous/ })).toBeNull();
      expect(screen.getByRole("link", { name: "Next Second page" })).toBeTruthy();
      cleanup();

      render(await GuideArticle(forSlug("third")));
      expect(screen.queryByRole("link", { name: /^Next/ })).toBeNull();
      expect(screen.getByRole("link", { name: "Previous Second page" })).toBeTruthy();
    });

    it("stacks the links to the pages around it on a narrow screen, and sets them side by side on a wider one", async () => {
      threePages();
      render(await GuideArticle(forSlug("second")));

      const nav = screen.getByRole("navigation", { name: "More of the guide" });
      expect(nav.className).toMatch(/(^|\s)grid-cols-1(\s|$)/);
      expect(nav.className).toMatch(/(^|\s)sm:grid-cols-2(\s|$)/);
      // A bare column start would open a second column on a narrow screen too.
      const next = screen.getByRole("link", { name: "Next Third page" });
      expect(next.className).not.toMatch(/(^|\s)col-start-2(\s|$)/);
      expect(next.className).toMatch(/(^|\s)sm:col-start-2(\s|$)/);
    });

    it("has no page for a slug the guide doesn't hold", async () => {
      threePages();

      await expect(GuideArticle(forSlug("fourth"))).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    });
  });

  it("is titled, and linked to its Markdown, in the page's head", async () => {
    const metadata = await generateMetadata(forSlug(FIRST.slug));

    expect(metadata.title).toBe(`${FIRST.title} · Curate`);
    expect(metadata.description).toBe(FIRST.summary);
    const markdown = (metadata.alternates?.types as Record<string, unknown>)["text/markdown"];
    expect(String(markdown)).toMatch(new RegExp(`/guide/${FIRST.slug}\\.md$`));
  });

  it("is built once for every page of the guide, and for nothing else", () => {
    expect(generateStaticParams()).toEqual(guidePages().map((p) => ({ slug: p.slug })));
    expect(dynamicParams).toBe(false);
  });
});
