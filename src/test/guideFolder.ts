import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * A project folder holding only the guide files given, by name, for a test
 * of the loader to read in place of the real guide. Point `process.cwd()` at
 * `root`, and `remove` it when the test is over.
 */
export function guideFolder(files: Record<string, string>): { root: string; remove: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), "guide-"));
  const dir = path.join(root, "src", "content", "guide");
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  return { root, remove: () => rmSync(root, { recursive: true, force: true }) };
}

/** A guide file with a title and a summary, and a line of text. */
export function guideFile(title: string): string {
  return `---\ntitle: ${title}\nsummary: About ${title}.\n---\n${title} body.\n`;
}
