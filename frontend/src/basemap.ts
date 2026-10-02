import type { ErrorEvent, ExpressionSpecification, StyleSpecification } from "maplibre-gl";
import { RISK } from "./theme";

/** The map's background (DECISIONS #9). The app's own layers (country fills, disaster areas, sites) are drawn on
 *  top of every one, in flat and globe view. Plain needs no outside service and is the default. */
export type Basemap = "plain" | "map" | "satellite";
export const BASEMAPS: { value: Basemap; label: string }[] = [
  { value: "plain", label: "Plain" }, { value: "map", label: "Map" }, { value: "satellite", label: "Satellite" },
];
/** The outside service of each tile mode, named in the notice when it does not respond. */
export const SERVICE: Record<Exclude<Basemap, "plain">, { name: string; host: string }> = {
  map: { name: "OpenFreeMap", host: "tiles.openfreemap.org" },
  satellite: { name: "EOX", host: "tiles.maps.eox.at" },
};
const TIMEOUT_MS = 8000;      // a service that has not answered by then "does not respond"
const link = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;

// Plain: water as the background; land comes from the committed Natural Earth file (the app's "countries" layers).
// No tile or style URL, and no glyphs, so cluster counts are drawn as icons.
export const PLAIN_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "water", type: "background", paint: { "background-color": RISK.water } }],
};

// Map: OpenFreeMap's "liberty" style (free, no key). Its sources have no attribution; its vector source's TileJSON
// (https://tiles.openfreemap.org/planet) has "OpenFreeMap © OpenMapTiles Data from OpenStreetMap". One attribution
// is set on that source instead, so nothing is shown twice: OpenFreeMap, OpenMapTiles and OpenStreetMap's own wording.
export const OPENFREEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
export const MAP_ATTRIBUTION = [link("https://openfreemap.org", "OpenFreeMap"), link("https://www.openmaptiles.org/", "© OpenMapTiles"),
  link("https://www.openstreetmap.org/copyright", "© OpenStreetMap contributors")].join(" ");

// Satellite: EOX Sentinel-2 cloudless, the layer without a year, which is 2016 and CC BY 4.0 (its WMTS capabilities:
// "Sentinel-2 cloudless layer for 2016 by EOX"; https://cloudless.eox.at/license-non-commercial: "For the year 2016,
// EOxCloudless is licensed under the Creative Commons Attribution 4.0 International License"). The 2018-2025 layers
// are non-commercial only. Web Mercator tiles: {TileMatrix}/{TileRow}/{TileCol} = {z}/{y}/{x}; zoom 0-14 as EOX's
// product list gives for EPSG:3857, then MapLibre enlarges the last level.
export const EOX_TILES = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg";
/** EOX's required attribution for 2016, as https://cloudless.eox.at/license-non-commercial gives it (the link is its URL). */
export const EOX_TEXT = "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017)";
export const EOX_ATTRIBUTION = EOX_TEXT.replace("https://cloudless.eox.at", link("https://cloudless.eox.at", "https://cloudless.eox.at"))
  + " " + link("https://creativecommons.org/licenses/by/4.0/", "CC BY 4.0");
export const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: { eox: { type: "raster", tiles: [EOX_TILES], tileSize: 256, maxzoom: 14, attribution: EOX_ATTRIBUTION } },
  layers: [
    { id: "satellite-background", type: "background", paint: { "background-color": "#0B1A2A" } },
    { id: "satellite", type: "raster", source: "eox" },
  ],
};

/** The liberty style with the one attribution above on its vector sources. */
export function withMapAttribution(liberty: StyleSpecification): StyleSpecification {
  const sources = Object.fromEntries(Object.entries(liberty.sources).map(([id, s]) =>
    [id, s.type === "vector" ? { ...s, attribution: MAP_ATTRIBUTION } : s]));
  return { ...liberty, sources };
}

async function get(url: string, fetcher: typeof fetch): Promise<Response> {
  const r = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r;
}

/** The style of a mode, once its service has answered: Map fetches the liberty style; Satellite fetches one tile.
 *  Throws when the service does not respond (the caller falls back to Plain). */
export async function loadBasemap(mode: Basemap, fetcher: typeof fetch = fetch): Promise<StyleSpecification> {
  if (mode === "plain") return PLAIN_STYLE;
  if (mode === "map") return withMapAttribution(await (await get(OPENFREEMAP_STYLE_URL, fetcher)).json() as StyleSpecification);
  await (await get(EOX_TILES.replace("{z}/{y}/{x}", "0/0/0"), fetcher)).blob();
  return SATELLITE_STYLE;
}

/** A failed request to the tile service of the mode on show (not a missing tile, 404): fall back to Plain. */
export function isServiceError(e: Pick<ErrorEvent, "error"> & { sourceId?: string }, mode: Basemap): boolean {
  if (mode === "plain") return false;
  const err = e.error as Error & { url?: string; status?: number };
  if (err?.status === 404) return false;
  return Boolean(err?.url?.includes(SERVICE[mode].host)) || (mode === "satellite" && e.sourceId === "eox");
}

/** The land layer: on Plain it is the map's land; on Map and Satellite only the High and Watch countries are filled,
 *  over the background, with the same colours and opacity. */
export function landOpacity(mode: Basemap, risky: ExpressionSpecification): ExpressionSpecification {
  return ["case", risky, 0.55, mode === "plain" ? 1 : 0];
}
