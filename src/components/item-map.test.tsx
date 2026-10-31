// @vitest-environment jsdom
/**
 * The item's map, as the Item tab draws it: nothing of MapLibre is fetched until the reader asks;
 * then a map from the tile server in the page's theme, a pin on a spot or the area framed, the
 * tiles' credit and a way to OpenStreetMap, and a short note when the style doesn't come. MapLibre
 * is a fake here: it records what it is asked to draw, and the tests say when its style arrives.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { NostrEvent } from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { definitionOf, type HeaderEvent } from "@/lib/conceptResolution";
import { decodeGeohash, osmPageUrl } from "@/lib/geohash";
import foodHeaders from "@/test/fixtures/food.header.json";
import foodItems from "@/test/fixtures/food.items.json";

interface Drawn {
  options: Record<string, unknown>;
  removed: boolean;
  fire(type: string, event?: object): void;
}

const maplibre = vi.hoisted(() => ({
  /** How many times the library has been loaded. */
  loads: 0,
  maps: [] as Drawn[],
  pins: [] as { lngLat: [number, number] }[],
  /** The browser can't draw a map: making one throws, as MapLibre does without WebGL. */
  noWebGL: false,
}));

vi.mock("maplibre-gl", () => {
  maplibre.loads++;
  class Map {
    options: Record<string, unknown>;
    removed = false;
    listeners = new globalThis.Map<string, ((event: object) => void)[]>();
    touchZoomRotate = { disableRotation() {} };
    keyboard = { disableRotation() {} };
    constructor(options: Record<string, unknown>) {
      if (maplibre.noWebGL) throw new Error("Failed to initialize WebGL");
      this.options = options;
      maplibre.maps.push(this);
    }
    on(type: string, listener: (event: object) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
      return this;
    }
    fire(type: string, event: object = {}) {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
    addControl() {
      return this;
    }
    remove() {
      this.removed = true;
    }
  }
  class Marker {
    lngLat: [number, number] = [0, 0];
    setLngLat(lngLat: [number, number]) {
      this.lngLat = lngLat;
      return this;
    }
    addTo() {
      maplibre.pins.push(this);
      return this;
    }
  }
  class NavigationControl {}
  return { Map, Marker, NavigationControl, setWorkerUrl() {} };
});

import { ItemHero } from "./item-hero";

const food = definitionOf(foodHeaders[0] as HeaderEvent);
const steak = foodItems[0] as NostrEvent;
/** Steak 'n Shake's spot, `g` dp0pzrexj: a 5 m cell. */
const spot = decodeGeohash("dp0pzrexj")!;
/** The same steak house, placed only as far as dp0p: an area some 40 km across. */
const steakInArea = { ...steak, tags: [...steak.tags.filter((t) => t[0] !== "g"), ["g", "dp0p"]] };
const area = decodeGeohash("dp0p")!;

const hero = (item: NostrEvent = steak) => render(<ItemHero item={item} definition={food} templates={new Map()} />);
/** Presses the offer, and waits for the library to load and the map to be made. */
async function showMap(name: RegExp = /show on map/i): Promise<Drawn> {
  fireEvent.click(screen.getByRole("button", { name }));
  await waitFor(() => expect(maplibre.maps).toHaveLength(1));
  return maplibre.maps[0];
}

beforeEach(() => {
  // Each test loads the library afresh, so each can tell whether it was loaded.
  vi.resetModules();
  maplibre.loads = 0;
  maplibre.maps = [];
  maplibre.pins = [];
  maplibre.noWebGL = false;
});

afterEach(() => {
  document.body.style.backgroundColor = "";
});

describe("before the reader asks", () => {
  it("loads no map library and asks the tile server for nothing", async () => {
    const { container } = hero();
    // Long enough for an import started on render to have run.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(maplibre.loads).toBe(0);
    expect(container.querySelector('[src*="map-tiles-server"], [href*="map-tiles-server"]')).toBeNull();
  });
});

describe("a spot", () => {
  it("is a map in Positron on a light page, with a pin at the cell's centre", async () => {
    hero();
    const map = await showMap();
    expect(maplibre.loads).toBe(1);
    expect(map.options.style).toBe("https://map-tiles-server.brainstorm.world/styles/positron");
    expect(map.options.center).toEqual([spot.lon, spot.lat]);
    expect(maplibre.pins.map((p) => p.lngLat)).toEqual([[spot.lon, spot.lat]]);
    expect(map.options.locale).toEqual({ "Map.Title": "Map: Steak 'n Shake" });
    expect(screen.queryByRole("button", { name: /show on map/i })).toBeNull();
  });

  it("is in Dark on Curate's dark ground", async () => {
    document.body.style.backgroundColor = "#141210";
    hero();
    const map = await showMap();
    expect(map.options.style).toBe("https://map-tiles-server.brainstorm.world/styles/dark");
  });

  it("leaves the wheel and one finger to the page, and draws no credit of MapLibre's own", async () => {
    hero();
    const map = await showMap();
    expect(map.options.cooperativeGestures).toBe(true);
    expect(map.options.attributionControl).toBe(false);
  });

  it("says it is loading until the style is in", async () => {
    const { container } = hero();
    const map = await showMap();
    expect(screen.getByText("Loading the map…")).toBeTruthy();
    act(() => map.fire("style.load"));
    expect(screen.queryByText("Loading the map…")).toBeNull();
    expect(container.querySelector("[data-map]")!.getAttribute("data-map")).toBe("ready");
  });

  it("credits OpenFreeMap, OpenMapTiles and OpenStreetMap's contributors, each linked to its terms", async () => {
    hero();
    await showMap();
    const credit = screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "OpenFreeMap © OpenMapTiles © OpenStreetMap contributors");
    const links = [...credit.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("target")]);
    expect(links).toEqual([
      ["OpenFreeMap", "https://openfreemap.org", "_blank"],
      ["OpenMapTiles", "https://www.openmaptiles.org/", "_blank"],
      ["OpenStreetMap contributors", "https://www.openstreetmap.org/copyright", "_blank"],
    ]);
  });

  it("keeps a way to the same place on OpenStreetMap", async () => {
    hero();
    await showMap();
    const open = screen.getByRole("link", { name: /Open in OpenStreetMap/ });
    expect(open.getAttribute("href")).toBe(osmPageUrl(spot));
    expect(open.getAttribute("target")).toBe("_blank");
    expect(open.getAttribute("rel")).toBe("noopener noreferrer nofollow");
  });

  it("is let go when the page is", async () => {
    const { unmount } = hero();
    const map = await showMap();
    unmount();
    expect(map.removed).toBe(true);
  });
});

describe("a coarser cell", () => {
  it("is framed as the area it is, with no pin", async () => {
    hero(steakInArea);
    const map = await showMap(/show area on map/i);
    expect(map.options.bounds).toEqual([
      [area.west, area.south],
      [area.east, area.north],
    ]);
    expect(map.options.center).toBeUndefined();
    expect(maplibre.pins).toHaveLength(0);
  });
});

describe("a map that can't be drawn", () => {
  it("says so in a short note, when the style doesn't come, and keeps the link", async () => {
    const { container } = hero();
    const map = await showMap();
    act(() => map.fire("error", { error: new Error("Forbidden (403)") }));
    expect(screen.getByRole("status").textContent).toBe("The map couldn’t be loaded.");
    expect(container.querySelector("[data-map]")).toBeNull();
    expect(map.removed).toBe(true);
    expect(screen.getByRole("link", { name: /Open in OpenStreetMap/ }).getAttribute("href")).toBe(osmPageUrl(spot));
  });

  it("says so when the browser can't draw a map at all", async () => {
    maplibre.noWebGL = true;
    hero();
    fireEvent.click(screen.getByRole("button", { name: /show on map/i }));
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open in OpenStreetMap/ })).toBeTruthy();
  });

  it("is not the case for a tile that doesn't come once the style is in: the map stays", async () => {
    const { container } = hero();
    const map = await showMap();
    act(() => map.fire("style.load"));
    act(() => map.fire("error", { error: new Error("tile"), sourceId: "openmaptiles" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector("[data-map]")!.getAttribute("data-map")).toBe("ready");
    expect(map.removed).toBe(false);
  });
});
