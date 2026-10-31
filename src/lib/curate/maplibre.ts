/**
 * The map library, with its styles and the worker it draws tiles in. The item's map loads this
 * module when the reader asks for the map, so MapLibre (about 1 MB) is a chunk of its own that a
 * page fetches only then.
 */
import "maplibre-gl/dist/maplibre-gl.css";
import { setWorkerUrl } from "maplibre-gl";

// The worker, emitted as a file of its own. MapLibre would otherwise look for it next to its own
// file, which a bundled page doesn't have.
setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);

export { Map, Marker, NavigationControl } from "maplibre-gl";
