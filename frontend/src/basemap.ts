import type { ErrorEvent, ExpressionSpecification, LayerSpecification, SourceSpecification, StyleSpecification } from "maplibre-gl";
import { RISK } from "./theme";

/** The map's background (DECISIONS #9). The app's own layers (country fills, disaster areas, sites) are drawn on
 *  top of every one, in flat and globe view. Plain needs no outside service and is the default.
 *  The map keeps one style (Plain's): the base of Map or Satellite is added to it below the app's layers, and removed
 *  again (swapBase), so the app's layers never leave the map and show at once after every switch. */
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

/** A base map: sources and layers (ids "base-…") added below the app's layers, with its glyphs, sprite and the
 *  colour of the map's background layer. */
export interface Base {
  mode: Basemap; sources: Record<string, SourceSpecification>; layers: LayerSpecification[];
  glyphs?: string; sprite?: string; background: string;
}
export const BASE_PREFIX = "base-";

// Plain: water as the background; land comes from the committed Natural Earth file (the app's "countries" layers).
// No tile or style URL, and no glyphs, so cluster counts are drawn as icons. It is the map's one style.
export const PLAIN_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "water", type: "background", paint: { "background-color": RISK.water } }],
};
export const PLAIN_BASE: Base = { mode: "plain", sources: {}, layers: [], background: RISK.water };

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
export const SATELLITE_BASE: Base = {
  mode: "satellite",
  sources: { eox: { type: "raster", tiles: [EOX_TILES], tileSize: 256, maxzoom: 14, attribution: EOX_ATTRIBUTION } },
  layers: [{ id: `${BASE_PREFIX}satellite`, type: "raster", source: "eox" }],
  background: "#0B1A2A",
};

/** The liberty style as a base: its sources (the one attribution above on the vector ones), its layers with ids
 *  "base-…" (liberty has a "water" layer, as the app has), its glyphs and sprite. */
export function mapBase(liberty: StyleSpecification): Base {
  const sources = Object.fromEntries(Object.entries(liberty.sources).map(([id, s]) =>
    [id, s.type === "vector" ? { ...s, attribution: MAP_ATTRIBUTION } : s]));
  return {
    mode: "map", sources, layers: liberty.layers.map((l) => ({ ...l, id: BASE_PREFIX + l.id })),
    glyphs: liberty.glyphs, sprite: typeof liberty.sprite === "string" ? liberty.sprite : undefined, background: RISK.water,
  };
}

async function get(url: string, fetcher: typeof fetch): Promise<Response> {
  const r = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r;
}

/** The base of a mode: Map fetches the liberty style (the caller keeps it after the first time); Plain and Satellite
 *  need nothing first. Throws when the service does not respond (the caller falls back to Plain). */
export async function loadBase(mode: Basemap, fetcher: typeof fetch = fetch): Promise<Base> {
  if (mode === "plain") return PLAIN_BASE;
  if (mode === "map") return mapBase(await (await get(OPENFREEMAP_STYLE_URL, fetcher)).json() as StyleSpecification);
  return SATELLITE_BASE;
}

/** Satellite's tiles are shown at once; one EOX tile, fetched alongside, tells a service that does not respond from
 *  one that is only slow to fill in. Throws when it does not answer. */
export async function checkService(mode: Basemap, fetcher: typeof fetch = fetch): Promise<void> {
  if (mode === "satellite") await (await get(EOX_TILES.replace("{z}/{y}/{x}", "0/0/0"), fetcher)).blob();
}

/** The map calls swapBase makes (a MapLibre map has them all). */
export interface BaseTarget {
  getLayer(id: string): unknown; removeLayer(id: string): unknown; addLayer(layer: LayerSpecification, beforeId?: string): unknown;
  getSource(id: string): unknown; removeSource(id: string): unknown; addSource(id: string, source: SourceSpecification): unknown;
  setGlyphs(url: string | null): unknown; setSprite(url: string | null): unknown;
  setPaintProperty(layer: string, name: string, value: string): unknown;
}

/** Replace the base below the app's layers (`beforeId`: the lowest of them) without touching them: they stay drawn
 *  while the new base's tiles fill in. Plain removes the base and needs nothing from outside. */
export function swapBase(m: BaseTarget, from: Base, to: Base, beforeId: string): void {
  for (const l of [...from.layers].reverse()) if (m.getLayer(l.id)) m.removeLayer(l.id);
  for (const id of Object.keys(from.sources)) if (m.getSource(id)) m.removeSource(id);
  if (from.glyphs !== to.glyphs) m.setGlyphs(to.glyphs ?? null);
  if (from.sprite !== to.sprite) m.setSprite(to.sprite ?? null);
  for (const [id, source] of Object.entries(to.sources)) m.addSource(id, source);
  for (const l of to.layers) m.addLayer(l, beforeId);
  m.setPaintProperty("water", "background-color", to.background);
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
