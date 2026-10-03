import { describe, expect, it, vi } from "vitest";
import type { ExpressionSpecification, LayerSpecification, SourceSpecification, StyleSpecification } from "maplibre-gl";
import {
  checkService, EOX_ATTRIBUTION, EOX_TEXT, isServiceError, landOpacity, loadBase, MAP_ATTRIBUTION, mapBase, PLAIN_BASE, PLAIN_STYLE,
  SATELLITE_BASE, swapBase, type BaseTarget,
} from "./basemap";

// The shape of https://tiles.openfreemap.org/styles/liberty on 2 Oct 2026 (2 of its sources, 2 of its 111 layers;
// it has a "water" layer, as the app's style has)
const LIBERTY: StyleSpecification = {
  version: 8, glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf", sprite: "https://tiles.openfreemap.org/sprites/ofm_f384/ofm",
  sources: {
    ne2_shaded: { type: "raster", tiles: ["https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 6 },
    openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
  },
  layers: [{ id: "background", type: "background" }, { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water" }],
};
const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
const ajax = (url: string, status: number) => ({ error: Object.assign(new Error("x"), { url, status }) });
const EOX_TILE_0 = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/0/0/0.jpg";

/** A stand-in for the MapLibre map: its layer order, sources, glyphs, sprite and background, and every call made. */
function fakeMap(own: string[]) {
  const layers = [...own], sources = new Set<string>(["countries", "sites"]), calls: string[] = [];
  const state = { glyphs: null as string | null, sprite: null as string | null, background: "" };
  const m: BaseTarget = {
    getLayer: (id) => layers.includes(id) || undefined,
    removeLayer: (id) => { calls.push(`removeLayer ${id}`); layers.splice(layers.indexOf(id), 1); },
    addLayer: (l: LayerSpecification, before?: string) => { calls.push(`addLayer ${l.id}`); layers.splice(before ? layers.indexOf(before) : layers.length, 0, l.id); },
    getSource: (id) => sources.has(id) || undefined,
    removeSource: (id) => { calls.push(`removeSource ${id}`); sources.delete(id); },
    addSource: (id: string, _s: SourceSpecification) => { calls.push(`addSource ${id}`); sources.add(id); },
    setGlyphs: (url) => { state.glyphs = url; },
    setSprite: (url) => { state.sprite = url; },
    setPaintProperty: (_l, _n, v) => { state.background = v; },
  };
  return { m, layers, sources, calls, state };
}

describe("map styles", () => {
  it("Plain needs no outside service", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    expect(await loadBase("plain", fetcher)).toBe(PLAIN_BASE);
    await checkService("plain", fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify([PLAIN_STYLE, PLAIN_BASE])).not.toContain("http");
  });

  it("Map is the liberty style as a base: its layers as base-…, OpenFreeMap, OpenMapTiles and OpenStreetMap credited once", async () => {
    const fetcher = ok(LIBERTY);
    const b = await loadBase("map", fetcher);
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe("https://tiles.openfreemap.org/styles/liberty");
    expect(b.layers).toEqual(LIBERTY.layers.map((l) => ({ ...l, id: `base-${l.id}` })));
    expect(b.sources.openmaptiles).toEqual({ ...LIBERTY.sources.openmaptiles, attribution: MAP_ATTRIBUTION });
    expect(b.sources.ne2_shaded).toEqual(LIBERTY.sources.ne2_shaded);
    expect([b.glyphs, b.sprite]).toEqual([LIBERTY.glyphs, LIBERTY.sprite]);
    expect(MAP_ATTRIBUTION).toContain('<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>');
    expect(MAP_ATTRIBUTION).toContain(">OpenFreeMap</a>");
  });

  it("Satellite is EOX's 2016 layer (CC BY 4.0), shown at once, its service checked with one tile alongside", async () => {
    const fetcher = vi.fn(async () => new Response(new Blob(["jpg"]), { status: 200 })) as unknown as typeof fetch;
    expect(await loadBase("satellite", fetcher)).toBe(SATELLITE_BASE);
    expect(fetcher).not.toHaveBeenCalled();
    await checkService("satellite", fetcher);
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(EOX_TILE_0);
    const eox = SATELLITE_BASE.sources.eox;
    expect(eox.type === "raster" && eox.tiles).toEqual(["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg"]);
    expect(EOX_TEXT).toBe("EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017)");
    expect(EOX_ATTRIBUTION.replace(/<[^>]+>/g, "")).toBe(`${EOX_TEXT} CC BY 4.0`);
    expect(JSON.stringify(SATELLITE_BASE)).not.toMatch(/s2cloudless-20(1[89]|2\d)/);   // no non-commercial year
  });

  it("a service that does not answer, or answers with an error, is not used", async () => {
    const down = vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    await expect(loadBase("map", down)).rejects.toThrow("Failed to fetch");
    await expect(checkService("satellite", down)).rejects.toThrow("Failed to fetch");
    const err = vi.fn(async () => new Response("", { status: 503, statusText: "Service Unavailable" })) as unknown as typeof fetch;
    await expect(loadBase("map", err)).rejects.toThrow("503");
  });

  it("switching swaps only the base, below the app's layers, which are never removed", () => {
    const own = ["water", "land", "borders", "disaster-fill", "clusters", "site", "selected-ring"];
    const f = fakeMap(own);
    const map = mapBase(LIBERTY);
    swapBase(f.m, PLAIN_BASE, map, "land");                                // Plain -> Map
    expect(f.layers).toEqual(["water", "base-background", "base-water", ...own.slice(1)]);
    expect([...f.sources]).toEqual(["countries", "sites", "ne2_shaded", "openmaptiles"]);
    expect([f.state.glyphs, f.state.sprite, f.state.background]).toEqual([LIBERTY.glyphs, LIBERTY.sprite, "#FFFFFF"]);
    swapBase(f.m, map, SATELLITE_BASE, "land");                            // Map -> Satellite
    expect(f.layers).toEqual(["water", "base-satellite", ...own.slice(1)]);
    expect([...f.sources]).toEqual(["countries", "sites", "eox"]);
    expect([f.state.glyphs, f.state.sprite, f.state.background]).toEqual([null, null, "#0B1A2A"]);
    swapBase(f.m, SATELLITE_BASE, PLAIN_BASE, "land");                     // Satellite -> Plain: nothing added
    expect(f.layers).toEqual(own);
    expect([...f.sources]).toEqual(["countries", "sites"]);
    expect(f.state.background).toBe("#FFFFFF");
    expect(f.calls.filter((c) => own.some((id) => c === `removeLayer ${id}`) || /removeSource (countries|sites)$/.test(c))).toEqual([]);
  });

  it("a failed tile request of the mode on show falls back; a missing tile or another source does not", () => {
    expect(isServiceError(ajax("https://tiles.openfreemap.org/planet/x/5/1/2.pbf", 0), "map")).toBe(true);
    expect(isServiceError(ajax("https://tiles.openfreemap.org/fonts/a/0-255.pbf", 503), "map")).toBe(true);
    expect(isServiceError(ajax("https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/3/1/2.jpg", 0), "satellite")).toBe(true);
    expect(isServiceError(ajax("https://tiles.openfreemap.org/planet/x/5/1/2.pbf", 404), "map")).toBe(false);
    expect(isServiceError(ajax("https://tiles.openfreemap.org/planet/x/5/1/2.pbf", 0), "plain")).toBe(false);
    expect(isServiceError(ajax("https://tiles.maps.eox.at/x.jpg", 0), "map")).toBe(false);
    expect(isServiceError({ error: new Error("The source 'sites' does not exist") }, "satellite")).toBe(false);
  });

  it("only Plain draws the land of countries that are not High or Watch", () => {
    const risky: ExpressionSpecification = ["in", ["get", "ISO_A2_EH"], ["literal", ["TR"]]];
    expect(landOpacity("plain", risky)).toEqual(["case", risky, 0.55, 1]);
    expect(landOpacity("map", risky)).toEqual(["case", risky, 0.55, 0]);
    expect(landOpacity("satellite", risky)).toEqual(["case", risky, 0.55, 0]);
  });
});
