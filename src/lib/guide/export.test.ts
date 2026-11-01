import { describe, expect, it } from "vitest";
import { guidePages, SITE_URL, type GuidePage } from "@/lib/guide/content";
import { llmsFullTxt, llmsTxt, pageMarkdown, robotsTxt, sitemapXml } from "@/lib/guide/export";

const NIP = "https://nostrhub.io/naddr1qvzqqqrcvypzpef89h53f0fsza2ugwdc3e54nfpun5nxfqclpy79r6w8nxsk5yp0qythwumn8ghj7erpwe5kgtnwdaehgu339e3k7mf0qqfkgetrv4h8gunpd35h5ety94kxjum5wv4px7v6";
const SOURCE = "https://github.com/aburra16/curate";

const PAGES: GuidePage[] = [
  {
    slug: "coffee-shops",
    order: 1,
    title: "Coffee shops",
    summary: "A list of good places for coffee.",
    markdown: "First body.\n\n## A heading\n\nMore of the first body.\n",
  },
  {
    slug: "tea-houses",
    order: 2,
    title: "Tea houses",
    summary: "A list of good places for tea.",
    markdown: "Second body.\n",
  },
];

/** The lines between a heading and the next one. */
function section(text: string, heading: string): string[] {
  const lines = text.split("\n");
  const start = lines.indexOf(heading);
  if (start === -1) return [];
  const end = lines.findIndex((line, at) => at > start && line.startsWith("## "));
  return lines.slice(start + 1, end === -1 ? undefined : end).filter((line) => line !== "");
}

describe("pageMarkdown", () => {
  it("puts the title above the summary, the page's address and the Markdown, with no front matter", () => {
    expect(pageMarkdown(PAGES[0])).toBe(
      `# Coffee shops\n\n> A list of good places for coffee.\n\nSource: ${SITE_URL}/guide/coffee-shops\n\nFirst body.\n\n## A heading\n\nMore of the first body.\n`,
    );
  });

  it("ends with one newline however the Markdown ends", () => {
    const bare = pageMarkdown({ ...PAGES[1], markdown: "Text." });
    const spaced = pageMarkdown({ ...PAGES[1], markdown: "Text.\n\n\n" });

    expect(bare.endsWith("Text.\n")).toBe(true);
    expect(spaced.endsWith("Text.\n")).toBe(true);
  });

  it("points a link to another page of the guide at that page's Markdown copy", () => {
    const text = pageMarkdown({
      ...PAGES[0],
      markdown: "See [the tea page](/guide/tea-houses) and [signing in](/guide/signing-in), then [tea again](/guide/tea-houses).\n",
    });

    expect(text).toContain(
      `See [the tea page](${SITE_URL}/guide/tea-houses.md) and [signing in](${SITE_URL}/guide/signing-in.md), then [tea again](${SITE_URL}/guide/tea-houses.md).`,
    );
    expect(text).not.toContain("](/");
  });

  it("keeps the part of a link after # and leaves other links as they are", () => {
    const text = pageMarkdown({
      ...PAGES[0],
      markdown: "[a part](/guide/tea-houses#steeping), [the NIP](https://nostrhub.io/naddr1abc), [a path](/guide-notes/tea).\n",
    });

    expect(text).toContain(`[a part](${SITE_URL}/guide/tea-houses.md#steeping)`);
    expect(text).toContain("[the NIP](https://nostrhub.io/naddr1abc)");
    expect(text).toContain("[a path](/guide-notes/tea)");
  });

  it("leaves no link of the guide's own pages pointing anywhere but at an existing Markdown copy", () => {
    const pages = guidePages();
    const slugs = new Set(pages.map((page) => page.slug));
    let checked = 0;

    for (const page of pages) {
      const text = pageMarkdown(page);
      expect(text, page.slug).not.toContain("](/");
      for (const [, slug] of text.matchAll(new RegExp(`\\]\\(${SITE_URL}/guide/([a-z0-9-]+)\\.md(?:#[^)\\s]*)?\\)`, "g"))) {
        expect(slugs.has(slug), `${page.slug} links to ${slug}`).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("llmsTxt", () => {
  const text = llmsTxt(PAGES);

  it("opens with one # Curate heading and no other level-one heading", () => {
    expect(text.split("\n")[0]).toBe("# Curate");
    expect(text.split("\n").filter((line) => line.startsWith("# "))).toEqual(["# Curate"]);
  });

  it("follows the heading with a > summary and then a plain paragraph", () => {
    const lines = text.split("\n");

    expect(lines[1]).toBe("");
    expect(lines[2]).toMatch(/^> \S/);
    expect(lines[3]).toBe("");
    expect(lines[4]).toMatch(/^[A-Z]/);
  });

  it("says the whole guide is also in one file, and where", () => {
    expect(text.split("\n")[4]).toContain(`All of it is also in one file: ${SITE_URL}/llms-full.txt.`);
  });

  it("lists every page under ## Guide, in order, with its absolute Markdown address and its summary", () => {
    expect(section(text, "## Guide")).toEqual([
      `- [Coffee shops](${SITE_URL}/guide/coffee-shops.md): A list of good places for coffee.`,
      `- [Tea houses](${SITE_URL}/guide/tea-houses.md): A list of good places for tea.`,
    ]);
  });

  it("links the whole guide, the NIP on NostrHub and the source under ## Optional", () => {
    const links = section(text, "## Optional");

    expect(links).toHaveLength(3);
    expect(links[0]).toMatch(new RegExp(`^- \\[[^\\]]+\\]\\(${SITE_URL}/llms-full\\.txt\\): \\S`));
    expect(links[1]).toMatch(new RegExp(`^- \\[[^\\]]+\\]\\(${NIP}\\): \\S`));
    expect(links[2]).toMatch(new RegExp(`^- \\[[^\\]]+\\]\\(${SOURCE}\\): \\S`));
  });

  it("puts ## Guide before ## Optional", () => {
    expect(text.indexOf("## Guide")).toBeGreaterThan(0);
    expect(text.indexOf("## Optional")).toBeGreaterThan(text.indexOf("## Guide"));
  });

  it("has no em dashes and no exclamation marks, and ends with one newline", () => {
    expect(text).not.toMatch(/—|!/);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });
});

describe("llmsFullTxt", () => {
  const text = llmsFullTxt(PAGES);

  it("opens with a heading and a short header before the first page", () => {
    expect(text.startsWith("# ")).toBe(true);
    expect(text.indexOf("# Coffee shops")).toBeGreaterThan(text.indexOf("\n\n"));
  });

  it("holds every page, in order, each under its title and summary", () => {
    const at = PAGES.map((page) => text.indexOf(pageMarkdown(page)));

    expect(at.every((index) => index > 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    for (const page of PAGES) {
      expect(text).toContain(
        `# ${page.title}\n\n> ${page.summary}\n\nSource: ${SITE_URL}/guide/${page.slug}\n\n${page.markdown}`,
      );
    }
  });

  it("separates the pages with a line holding three hyphens", () => {
    const between = text.slice(text.indexOf(pageMarkdown(PAGES[0])) + pageMarkdown(PAGES[0]).length, text.indexOf("# Tea houses"));

    expect(between).toBe("\n---\n\n");
  });

  it("ends with one newline", () => {
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });
});

describe("sitemapXml", () => {
  const xml = sitemapXml(PAGES);
  const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

  it("lists the site root, the guide and every page, once each", () => {
    expect(locations).toEqual([`${SITE_URL}/`, `${SITE_URL}/guide`, `${SITE_URL}/guide/coffee-shops`, `${SITE_URL}/guide/tea-houses`]);
  });

  it("is a sitemap document", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });
});

describe("robotsTxt", () => {
  it("lets every crawler in and names the sitemap", () => {
    expect(robotsTxt()).toBe(`User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  });
});
