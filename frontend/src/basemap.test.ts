import { describe, expect, it, vi } from "vitest";
import type { ExpressionSpecification, StyleSpecification } from "maplibre-gl";
import { EOX_ATTRIBUTION, EOX_TEXT, isServiceError, landOpacity, loadBasemap, MAP_ATTRIBUTION, PLAIN_STYLE, SATELLITE_STYLE } from "./basemap";

// The shape of https://tiles.openfreemap.org/styles/liberty on 2 Oct 2026 (2 of its sources, 2 of its 111 layers)
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

describe("map styles", () => {
  it("Plain needs no outside service", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    expect(await loadBasemap("plain", fetcher)).toBe(PLAIN_STYLE);
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify(PLAIN_STYLE)).not.toContain("http");
  });

  it("Map is the liberty style with OpenFreeMap, OpenMapTiles and OpenStreetMap credited once, on its vector source", async () => {
    const fetcher = ok(LIBERTY);
    const s = await loadBasemap("map", fetcher);
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe("https://tiles.openfreemap.org/styles/liberty");
    expect(s.layers).toEqual(LIBERTY.layers);
    expect(s.sources.openmaptiles).toEqual({ ...LIBERTY.sources.openmaptiles, attribution: MAP_ATTRIBUTION });
    expect(s.sources.ne2_shaded).toEqual(LIBERTY.sources.ne2_shaded);
    expect(MAP_ATTRIBUTION).toContain('<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>');
    expect(MAP_ATTRIBUTION).toContain(">OpenFreeMap</a>");
  });

  it("Satellite is EOX's 2016 layer (CC BY 4.0), with EOX's attribution word for word", async () => {
    const fetcher = vi.fn(async () => new Response(new Blob(["jpg"]), { status: 200 })) as unknown as typeof fetch;
    expect(await loadBasemap("satellite", fetcher)).toBe(SATELLITE_STYLE);
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe("https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/0/0/0.jpg");
    const eox = SATELLITE_STYLE.sources.eox;
    expect(eox.type === "raster" && eox.tiles).toEqual(["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg"]);
    expect(EOX_TEXT).toBe("EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017)");
    expect(EOX_ATTRIBUTION.replace(/<[^>]+>/g, "")).toBe(`${EOX_TEXT} CC BY 4.0`);
    expect(JSON.stringify(SATELLITE_STYLE)).not.toMatch(/s2cloudless-20(1[89]|2\d)/);   // no non-commercial year
  });

  it("a service that does not answer, or answers with an error, is not used", async () => {
    const down = vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    await expect(loadBasemap("map", down)).rejects.toThrow("Failed to fetch");
    await expect(loadBasemap("satellite", down)).rejects.toThrow("Failed to fetch");
    const err = vi.fn(async () => new Response("", { status: 503, statusText: "Service Unavailable" })) as unknown as typeof fetch;
    await expect(loadBasemap("map", err)).rejects.toThrow("503");
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
