/**
 * The guide as files for AI assistants and search engines, made from the same
 * pages the site shows: `llms.txt`, `llms-full.txt`, a Markdown copy of each
 * page, `robots.txt` and `sitemap.xml`. `scripts/guide-export.mjs` writes them
 * before the site is built, and Node runs this file as it is, so its imports
 * are relative and keep their `.ts` extension.
 */

import { SITE_URL, type GuidePage } from "./content.ts";

/** The Decentralized Lists NIP, the public description of what a DList is made of. */
const NIP_URL =
  "https://nostrhub.io/naddr1qvzqqqrcvypzpef89h53f0fsza2ugwdc3e54nfpun5nxfqclpy79r6w8nxsk5yp0qythwumn8ghj7erpwe5kgtnwdaehgu339e3k7mf0qqfkgetrv4h8gunpd35h5ety94kxjum5wv4px7v6";

/** Curate's source code. */
const SOURCE_URL = "https://github.com/aburra16/curate";

/** What Curate and DLists are, in a sentence or two. */
const WHAT_IT_IS =
  "Curate is a website for finding, reading and adding to DLists. A DList is a list that anyone can add to: one person starts it and says what it is about, and everyone else adds entries.";

/** A link to another page of the guide, as the Markdown writes it: `](/guide/<slug>)`, with any `#part` kept. */
const GUIDE_LINK = /\]\(\/guide\/([a-z0-9-]+)(#[^)\s]*)?\)/g;

/**
 * A page as a Markdown file that stands alone: its title, its summary as a
 * quote, where the page lives on the site, then the page. The site draws the
 * title itself, so the source has none. Links to the guide's other pages are
 * written for the site (`/guide/<slug>`); here they name the other page's
 * Markdown copy in full, so they lead somewhere wherever the text is read.
 */
export function pageMarkdown(page: GuidePage): string {
  const body = page.markdown
    .trimEnd()
    .replace(GUIDE_LINK, (_link, slug: string, part = "") => `](${SITE_URL}/guide/${slug}.md${part})`);
  return `# ${page.title}\n\n> ${page.summary}\n\nSource: ${SITE_URL}/guide/${page.slug}\n\n${body}\n`;
}

/** The guide in the shape llmstxt.org describes: a title, a summary, and links to each page. */
export function llmsTxt(pages: GuidePage[]): string {
  const guide = pages.map((page) => `- [${page.title}](${SITE_URL}/guide/${page.slug}.md): ${page.summary}`);
  return [
    "# Curate",
    "",
    `> ${WHAT_IT_IS}`,
    "",
    `DLists live on nostr, an open network, so no one company owns them and any app can read them. Curate has no accounts and charges nothing. Reading needs nothing at all. To add to a list or make one, you connect a signer, a small program that holds your key and signs for you. The guide explains each part in plain words, one page for each. All of it is also in one file: ${SITE_URL}/llms-full.txt.`,
    "",
    "## Guide",
    "",
    ...guide,
    "",
    "## Optional",
    "",
    `- [The whole guide in one file](${SITE_URL}/llms-full.txt): Every page, one after another.`,
    `- [The DList specification on NostrHub](${NIP_URL}): The public description of the events a DList is made of.`,
    `- [Curate's source code on GitHub](${SOURCE_URL}): The code this site is built from.`,
    "",
  ].join("\n");
}

/** The whole guide in one file: a short header, then every page in order, each under its title. */
export function llmsFullTxt(pages: GuidePage[]): string {
  const header = [
    "# The Curate guide",
    "",
    `> ${WHAT_IT_IS} This file holds every page of the guide, in order. Each page starts with its title, and a line holding three hyphens separates one page from the next.`,
    "",
  ].join("\n");
  return [header, ...pages.map(pageMarkdown)].join("\n---\n\n");
}

/** The sitemap: the site's front page, the guide's index, and each page of the guide. */
export function sitemapXml(pages: GuidePage[]): string {
  const addresses = [`${SITE_URL}/`, `${SITE_URL}/guide`, ...pages.map((page) => `${SITE_URL}/guide/${page.slug}`)];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...addresses.map((address) => `  <url><loc>${address}</loc></url>`),
    "</urlset>",
    "",
  ].join("\n");
}

/** Every crawler may read everything, and the sitemap says where to start. */
export function robotsTxt(): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}
