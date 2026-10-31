import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

/** The css with every `@layer name { … }` block lifted out, braces matched. */
function withoutLayers(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const at = source.indexOf("@layer", i);
    if (at === -1) {
      out += source.slice(i);
      break;
    }
    out += source.slice(i, at);
    const open = source.indexOf("{", at);
    // `@layer a, b;` declares an order and has no block.
    const semicolon = source.indexOf(";", at);
    if (open === -1 || (semicolon !== -1 && semicolon < open)) {
      i = semicolon === -1 ? source.length : semicolon + 1;
      continue;
    }
    let depth = 0;
    let j = open;
    for (; j < source.length; j++) {
      if (source[j] === "{") depth++;
      else if (source[j] === "}" && --depth === 0) break;
    }
    i = j + 1;
  }
  return out;
}

describe("globals.css", () => {
  it("keeps the plain `a` rule inside a layer, so a utility class can colour a link", () => {
    // Unlayered rules beat every Tailwind utility: `text-accent` on a link would read as plain text.
    expect(withoutLayers(css)).not.toMatch(/(^|[\s,}])a\s*(,|\{)/);
  });

  it("still resets a link to its surroundings, in the base layer", () => {
    expect(css).toMatch(/@layer base\s*\{[^@]*\ba\s*\{[^}]*color:\s*inherit[^}]*text-decoration:\s*none/);
  });
});
