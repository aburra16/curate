#!/usr/bin/env node
// Writes the guide's files for AI assistants and search engines into public/, where
// the build copies them to the site as they are:
//
//   public/llms.txt            what Curate is, with a link to each page's Markdown copy
//   public/llms-full.txt       the whole guide in one file
//   public/guide/<slug>.md     each page as Markdown, beside its page at /guide/<slug>
//   public/robots.txt
//   public/sitemap.xml
//
// They come from the same Markdown as the pages (src/content/guide), so they can't
// drift from them, and none is kept in git. `npm run dev` and `npm run build` run this
// first. Run it from the project's folder, as npm does.
//
// Node strips the types from the .ts files it imports, so they are read as they are.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { guidePages } from "../src/lib/guide/content.ts";
import { llmsFullTxt, llmsTxt, pageMarkdown, robotsTxt, sitemapXml } from "../src/lib/guide/export.ts";

const PUBLIC = path.join(process.cwd(), "public");
const TWINS = path.join(PUBLIC, "guide");

const pages = guidePages();

// Start the Markdown copies afresh, so a page that was renamed or removed leaves none behind.
rmSync(TWINS, { recursive: true, force: true });
mkdirSync(TWINS, { recursive: true });

for (const page of pages) writeFileSync(path.join(TWINS, `${page.slug}.md`), pageMarkdown(page));
writeFileSync(path.join(PUBLIC, "llms.txt"), llmsTxt(pages));
writeFileSync(path.join(PUBLIC, "llms-full.txt"), llmsFullTxt(pages));
writeFileSync(path.join(PUBLIC, "robots.txt"), robotsTxt());
writeFileSync(path.join(PUBLIC, "sitemap.xml"), sitemapXml(pages));

console.log(`Guide: wrote llms.txt, llms-full.txt, robots.txt, sitemap.xml and ${pages.length} Markdown copies to public/.`);
