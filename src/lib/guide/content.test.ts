import { afterEach, describe, expect, it, vi } from "vitest";
import { guideHtml, guidePage, guidePages, parseGuideFile, SITE_URL, type GuidePage } from "@/lib/guide/content";
import { guideFile, guideFolder } from "@/test/guideFolder";

const FILE = "03-coffee-shops.md";
const SOURCE = [
  "---",
  "title: Coffee shops, explained",
  "summary: A list anyone can add to: here is how it works.",
  "---",
  "",
  "First paragraph.",
  "",
  "## A heading",
  "",
].join("\n");

const page = (markdown: string): GuidePage => ({
  slug: "coffee-shops",
  order: 3,
  title: "Coffee shops",
  summary: "A summary.",
  markdown,
});

describe("parseGuideFile", () => {
  it("reads the title, the summary, the slug and the order from the file", () => {
    const parsed = parseGuideFile(FILE, SOURCE);

    expect(parsed).toMatchObject({
      slug: "coffee-shops",
      order: 3,
      title: "Coffee shops, explained",
      summary: "A list anyone can add to: here is how it works.",
    });
  });

  it("keeps everything after the first colon and space as the value, colons included", () => {
    const parsed = parseGuideFile(FILE, "---\ntitle: One: two: three\nsummary: Note: it counts.\n---\nBody.\n");

    expect(parsed.title).toBe("One: two: three");
    expect(parsed.summary).toBe("Note: it counts.");
  });

  it("keeps what follows the front matter as the Markdown, without the blank lines before it", () => {
    expect(parseGuideFile(FILE, SOURCE).markdown).toBe("First paragraph.\n\n## A heading\n");
  });

  it("reads a file saved with Windows line endings", () => {
    const parsed = parseGuideFile(FILE, SOURCE.replace(/\n/g, "\r\n"));

    expect(parsed.title).toBe("Coffee shops, explained");
    expect(parsed.summary).toBe("A list anyone can add to: here is how it works.");
    expect(parsed.markdown).not.toContain("\r");
  });

  it("reads a two-digit order and a slug with several words", () => {
    const parsed = parseGuideFile("12-glossary-and-faq.md", SOURCE);

    expect(parsed.order).toBe(12);
    expect(parsed.slug).toBe("glossary-and-faq");
  });

  it("throws on a file with no front matter", () => {
    expect(() => parseGuideFile(FILE, "Just a paragraph.\n")).toThrow(FILE);
  });

  it("throws on front matter that is never closed", () => {
    expect(() => parseGuideFile(FILE, "---\ntitle: A\nsummary: B\n\nBody.\n")).toThrow(FILE);
  });

  it("throws on a missing title", () => {
    expect(() => parseGuideFile(FILE, "---\nsummary: Only a summary.\n---\nBody.\n")).toThrow(/title/);
  });

  it("throws on a missing summary", () => {
    expect(() => parseGuideFile(FILE, "---\ntitle: Only a title\n---\nBody.\n")).toThrow(/summary/);
  });

  it("throws on a title or summary with nothing in it", () => {
    expect(() => parseGuideFile(FILE, "---\ntitle: \nsummary: B\n---\nBody.\n")).toThrow(/title/);
    expect(() => parseGuideFile(FILE, "---\ntitle: A\nsummary:\n---\nBody.\n")).toThrow(/summary/);
  });

  it.each(["coffee-shops.md", "x-coffee-shops.md", "03-Coffee.md", "03-coffee-shops.txt", "03-.md"])(
    "throws on a file name that isn't NN-slug.md: %s",
    (name) => {
      expect(() => parseGuideFile(name, SOURCE)).toThrow(name);
    },
  );
});

describe("guidePages", () => {
  const folders: { remove: () => void }[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const folder of folders.splice(0)) folder.remove();
  });

  /** Reads the guide from a folder holding only these files. */
  function guideWith(files: Record<string, string>) {
    const folder = guideFolder(files);
    folders.push(folder);
    vi.spyOn(process, "cwd").mockReturnValue(folder.root);
  }

  it("returns every page by its number, not by how the names sort as text", () => {
    guideWith({
      "10-ten.md": guideFile("Ten"),
      "2-two.md": guideFile("Two"),
      "01-one.md": guideFile("One"),
    });

    expect(guidePages().map((p) => [p.order, p.slug])).toEqual([
      [1, "one"],
      [2, "two"],
      [10, "ten"],
    ]);
  });

  it("reads only the Markdown files in the folder", () => {
    guideWith({ "01-one.md": guideFile("One"), ".DS_Store": "junk", "notes.txt": "not a page" });

    expect(guidePages().map((p) => p.slug)).toEqual(["one"]);
  });

  it("fails on a page that has no front matter, rather than leaving it out", () => {
    guideWith({ "01-one.md": guideFile("One"), "02-two.md": "No front matter here.\n" });

    expect(() => guidePages()).toThrow("02-two.md");
  });

  it("finds a page by its slug, and null for one that isn't there", () => {
    guideWith({ "01-one.md": guideFile("One"), "02-two.md": guideFile("Two") });

    expect(guidePage("two")?.title).toBe("Two");
    expect(guidePage("three")).toBeNull();
  });

  it("reads the project's own folder in order, starting with what a DList is", () => {
    const pages = guidePages();
    const orders = pages.map((p) => p.order);

    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(orders).size).toBe(orders.length);
    expect(pages[0].slug).toBe("what-is-a-dlist");
  });
});

describe("the guide's pages", () => {
  const pages = guidePages();
  const slugs = new Set(pages.map((p) => p.slug));

  /** Every page a link inside the guide names: `/guide/<slug>`, on its own or after Curate's address. */
  const linkedSlugs = (markdown: string): string[] =>
    [...markdown.matchAll(/\]\((?:https:\/\/curate\.brainstorm\.world)?\/guide\/([^)#\s]+)[)#]/g)].map((m) => m[1]);

  it("are the nine pages, in order", () => {
    expect(pages.map((p) => p.slug)).toEqual([
      "what-is-a-dlist",
      "exploring-lists",
      "trust-and-votes",
      "signing-in",
      "creating-a-list",
      "adding-items",
      "versions",
      "for-developers",
      "glossary-and-faq",
    ]);
  });

  it.each(pages.map((p) => [p.slug, p] as const))("%s has a summary of at most 160 characters", (_, page) => {
    expect(page.summary.length).toBeGreaterThan(0);
    expect(page.summary.length).toBeLessThanOrEqual(160);
  });

  it.each(pages.map((p) => [p.slug, p] as const))("%s links only to pages the guide has", (_, page) => {
    for (const slug of linkedSlugs(page.markdown)) expect(slugs).toContain(slug);
  });

  it("finds the links it checks, with or without Curate's address and an anchor", () => {
    expect(
      linkedSlugs("[a](/guide/signing-in) [b](https://curate.brainstorm.world/guide/versions#buttons) [c](/create)"),
    ).toEqual(["signing-in", "versions"]);
  });

  it("link forward from the first page to the second", () => {
    expect(linkedSlugs(pages[0].markdown)).toContain(pages[1].slug);
  });
});

describe("SITE_URL", () => {
  it("is Curate's address, without a closing slash", () => {
    expect(SITE_URL).toBe("https://curate.brainstorm.world");
  });
});

describe("guideHtml", () => {
  it("renders a heading", () => {
    expect(guideHtml(page("## Where it lives\n"))).toContain("<h2>Where it lives</h2>");
  });

  it("renders a list", () => {
    const html = guideHtml(page("- one\n- two\n"));

    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });

  it("renders a code block, with its contents escaped", () => {
    const html = guideHtml(page('```json\n{ "kind": 39998, "tags": [["names", "a<b"]] }\n```\n'));

    expect(html).toContain("<pre><code");
    expect(html).toContain("&quot;kind&quot;");
    expect(html).toContain("a&lt;b");
  });

  it("renders a table, still a table, inside a box that scrolls it sideways", () => {
    const html = guideHtml(page("| Name | Type |\n| --- | --- |\n| Website | Link |\n"));

    expect(html).toMatch(/^<div class="guide-table"><table>[\s\S]*<\/table>\s*<\/div>\s*$/);
    expect(html).toContain("<th>Name</th>");
    expect(html).toContain("<td>Website</td>");
  });

  it("keeps a table's cells as Markdown renders them, links and code included", () => {
    const html = guideHtml(page("| Tag | Means |\n| --- | --- |\n| `z` | [the list](/guide/versions) |\n"));

    expect(html).toContain("<td><code>z</code></td>");
    expect(html).toContain('<td><a href="/guide/versions">the list</a></td>');
  });

  it("renders a link", () => {
    expect(guideHtml(page("[NostrHub](https://nostrhub.io/x)\n"))).toContain('<a href="https://nostrhub.io/x">NostrHub</a>');
  });

  it("does not pass raw HTML through, as a block or inside a line", () => {
    const html = guideHtml(page('<script>alert(1)</script>\n\nA line with <img src=x onerror=alert(1)> in it.\n'));

    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });
});
