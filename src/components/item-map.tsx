"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { isSpot, osmPageUrl, type GeohashCell } from "@/lib/geohash";
import { MAP_STYLES, pageTheme } from "@/lib/curate/mapStyle";

/** A link out of Curate: a new tab, no referrer, no endorsement. */
const OUT = { target: "_blank", rel: "noopener noreferrer nofollow" } as const;
const ROUNDED = { borderRadius: "var(--radius-input)" } as const;

/** How close a spot's map looks: its street, and the streets around it. */
const SPOT_ZOOM = 16;

/** Each source's terms, which its name in the map's credit links to. */
const CREDITS = [
  ["OpenFreeMap", "https://openfreemap.org"],
  ["OpenMapTiles", "https://www.openmaptiles.org/"],
  ["OpenStreetMap contributors", "https://www.openstreetmap.org/copyright"],
] as const;

/** Where the map's tiles come from, as their licences ask: "OpenFreeMap © OpenMapTiles © OpenStreetMap contributors". */
function Credit() {
  return (
    <p className="absolute bottom-1 right-1 z-10 bg-bg/80 px-1.5 py-0.5 text-[10px] leading-[1.4] text-mute" style={ROUNDED}>
      {CREDITS.map(([name, href], i) => (
        <span key={href}>
          {i > 0 ? " © " : null}
          <a href={href} {...OUT} className="underline underline-offset-2 hover:text-ink">
            {name}
          </a>
        </span>
      ))}
    </p>
  );
}

/**
 * The map itself, drawn with MapLibre from OpenFreeMap's tiles in the page's theme. A spot gets a
 * pin at the cell's centre; a coarser cell is framed as the area it is. The page scrolls past it:
 * the wheel zooms it only with Ctrl (⌘ on a Mac), and one finger moves the page, not the map. A
 * style that doesn't come, or a browser that can't draw a map, leaves a short note instead.
 */
function DrawnMap({ cell, title }: { cell: GeohashCell; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let gone = false;
    let map: MapLibreMap | undefined;
    const fail = () => {
      map?.remove();
      map = undefined;
      if (!gone) setState("failed");
    };

    import("@/lib/curate/maplibre").then((lib) => {
      if (gone || !box.current) return;
      const spot = isSpot(cell);
      try {
        map = new lib.Map({
          container: box.current,
          style: MAP_STYLES[pageTheme()],
          ...(spot
            ? { center: [cell.lon, cell.lat], zoom: SPOT_ZOOM }
            : {
                bounds: [
                  [cell.west, cell.south],
                  [cell.east, cell.north],
                ],
                fitBoundsOptions: { padding: 16, maxZoom: SPOT_ZOOM },
              }),
          cooperativeGestures: true,
          // North up and flat: too small a map for turning or tilting to help.
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          attributionControl: false,
          locale: { "Map.Title": `Map: ${title}` },
        });
      } catch {
        // No WebGL.
        fail();
        return;
      }
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
      map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
      if (spot) {
        const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
        new lib.Marker(accent ? { color: accent } : {}).setLngLat([cell.lon, cell.lat]).addTo(map);
      }

      let styled = false;
      map.on("style.load", () => {
        styled = true;
        setState("ready");
      });
      // Handled here, so MapLibre doesn't write each one to the console. A tile that doesn't come
      // leaves a gap the next move fills; only the style not coming is a map that can't be drawn.
      map.on("error", (event) => {
        if (!styled && !("sourceId" in event)) fail();
      });
    }, fail);

    return () => {
      gone = true;
      map?.remove();
    };
  }, [cell, title]);

  if (state === "failed") {
    return (
      <p role="status" className="border border-rule bg-surface p-3 text-[13px] leading-[1.55] text-ink-soft" style={ROUNDED}>
        The map couldn&rsquo;t be loaded.
      </p>
    );
  }
  return (
    <div className="relative h-64 w-full overflow-hidden border border-rule bg-surface" style={ROUNDED}>
      {/* MapLibre makes its container `position: relative`, so it fills the box by its size. */}
      <div ref={box} data-map={state} className="h-full w-full" />
      {state === "loading" ? (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] text-mute">Loading the map&hellip;</p>
      ) : null}
      <Credit />
    </div>
  );
}

/**
 * Where the item is, on a map. Only on request: until the reader asks, the page contacts no map
 * server and loads no map library. A spot gets a pin; a coarser geohash is framed as the area it
 * is. The same place on openstreetmap.org is a link below it either way.
 */
export function ItemMap({ location, title }: { location: GeohashCell; title: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-baseline gap-1.5 self-start border border-rule bg-surface px-3 py-1.5 text-[12px] text-ink-soft transition-colors hover:border-rule-strong hover:text-ink"
        style={ROUNDED}
      >
        {isSpot(location) ? "Show on map" : "Show area on map"}
      </button>
    );
  }
  return (
    <div>
      <DrawnMap cell={location} title={title} />
      <a href={osmPageUrl(location)} {...OUT} className="mt-1.5 inline-block text-[11px] text-mute hover:text-accent">
        Open in OpenStreetMap <span className="text-mute/70">www.openstreetmap.org</span>
      </a>
    </div>
  );
}
