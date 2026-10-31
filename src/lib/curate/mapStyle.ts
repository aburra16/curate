/**
 * The map's styles: OpenFreeMap's, from Brainstorm's own copy of its servers (the same planet,
 * styles, fonts and sprite, at the same paths, with no key). The style, and the tiles, fonts and
 * sprite it names, all come from this one host, which answers only the sites it knows.
 */
export const TILES_HOST = "map-tiles-server.brainstorm.world";

export type Theme = "light" | "dark";

/** Positron, a quiet map in greys, for a light page; Dark, drawn for a dark ground, for a dark one. */
export const MAP_STYLES: Readonly<Record<Theme, string>> = {
  light: `https://${TILES_HOST}/styles/positron`,
  dark: `https://${TILES_HOST}/styles/dark`,
};

/** Whether a computed colour (`rgb(…)` or `rgba(…)`) is dark; null when it isn't one of those, or is clear. */
function isDark(colour: string): boolean | null {
  const m = colour.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+)(%?))?\s*\)$/);
  if (!m) return null;
  const alpha = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1);
  if (alpha === 0) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

/**
 * The page's theme, read from the ground it is drawn on (the tokens in globals.css), so the map
 * follows the page whatever its colours are: Curate's ground is dark. A page with no ground of its
 * own is the browser's white.
 */
export function pageTheme(): Theme {
  for (const el of [document.body, document.documentElement]) {
    const dark = isDark(getComputedStyle(el).backgroundColor);
    if (dark !== null) return dark ? "dark" : "light";
  }
  return "light";
}
