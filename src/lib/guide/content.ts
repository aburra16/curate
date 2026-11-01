/**
 * The guide's pages, read from the Markdown files in `src/content/guide`.
 * Server only: it reads the files with `fs` while the site is built, so a page
 * never reads one when it is asked for.
 *
 * A file is named `NN-slug.md`: `NN` puts it in order and `slug` is its address.
 * It starts with front matter, a block between two `---` lines holding a
 * `title:` and a one-sentence `summary:`; the Markdown follows.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Marked, Renderer, type Tokens } from "marked";

/** Where the site is published. */
export const SITE_URL = "https://curate.brainstorm.world";

export interface GuidePage {
  /** The page's address: `/guide/<slug>`. */
  slug: string;
  /** Its place in the guide, from the number in its file name. */
  order: number;
  title: string;
  /** One sentence, shown on the guide's index. */
  summary: string;
  /** What follows the front matter. It starts below the title, which the page draws itself. */
  markdown: string;
}

const FILE_NAME = /^(\d+)-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

/** The front matter's lines that read `key: value`, by key. The value is everything after the first colon. */
function frontMatter(lines: string[]): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of lines) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (match) fields.set(match[1], match[2].trim());
  }
  return fields;
}

/** A page from the text of its file. Throws, naming the file, on anything the guide can't be built without. */
export function parseGuideFile(fileName: string, text: string): GuidePage {
  const name = FILE_NAME.exec(fileName);
  if (!name) throw new Error(`Guide file "${fileName}" must be named NN-slug.md, in lowercase letters, digits and hyphens.`);

  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const close = lines.indexOf("---", 1);
  if (lines[0] !== "---" || close === -1) {
    throw new Error(`Guide file "${fileName}" must start with front matter between two --- lines.`);
  }

  const fields = frontMatter(lines.slice(1, close));
  const title = fields.get("title");
  const summary = fields.get("summary");
  if (!title) throw new Error(`Guide file "${fileName}" has no title in its front matter.`);
  if (!summary) throw new Error(`Guide file "${fileName}" has no summary in its front matter.`);

  return {
    slug: name[2],
    order: Number(name[1]),
    title,
    summary,
    markdown: lines.slice(close + 1).join("\n").replace(/^\n+/, ""),
  };
}

/** Every page of the guide, in order. */
export function guidePages(): GuidePage[] {
  const dir = path.join(process.cwd(), "src", "content", "guide");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => parseGuideFile(name, readFileSync(path.join(dir, name), "utf8")))
    .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
}

/** The page at a slug, or null when the guide has none. */
export function guidePage(slug: string): GuidePage | null {
  return guidePages().find((page) => page.slug === slug) ?? null;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const markdown = new Marked({
  gfm: true,
  renderer: {
    // The guide's text is Curate's own and uses no raw HTML: should any slip in, it shows as the text it is.
    html: ({ text }) => escapeHtml(text),
    // A wide table scrolls inside a box of its own, and stays a table, which a screen reader reads as one.
    table(this: Renderer, token: Tokens.Table) {
      return `<div class="guide-table">${Renderer.prototype.table.call(this, token)}</div>\n`;
    },
  },
});

/** A page's Markdown as HTML. */
export function guideHtml(page: GuidePage): string {
  return markdown.parse(page.markdown, { async: false });
}
