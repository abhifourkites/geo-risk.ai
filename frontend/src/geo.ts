/** Small geometry helpers for moving the map to a selection. */
import type { Geometry } from "geojson";

export type Bounds = [[number, number], [number, number]];
/** Where the map should go. `scroll`: the move came from the panel or a table, so on a narrow screen
 *  (where the map is above them) the page scrolls the map into view. */
export type Focus = (
  | { key: number; kind: "point"; center: [number, number]; zoom: number; pitch: number }
  | { key: number; kind: "bounds"; bounds: Bounds }
  | { key: number; kind: "world" }
) & { scroll?: boolean };

export const WORLD: Bounds = [[-170, -58], [180, 78]];

/** Bounding box of a list of [lng, lat] points; null when there are none. */
export function boundsOf(points: [number, number][]): Bounds | null {
  if (!points.length) return null;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [[x0, y0], [x1, y1]];
}

/** Every [lng, lat] of a (Multi)Polygon or other geometry. */
export function coordsOf(g: Geometry | null | undefined): [number, number][] {
  if (!g) return [];
  const out: [number, number][] = [];
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") out.push([c[0] as number, c[1] as number]);
    else if (Array.isArray(c)) c.forEach(walk);
  };
  if (g.type === "GeometryCollection") g.geometries.forEach((x) => out.push(...coordsOf(x)));
  else walk((g as { coordinates: unknown }).coordinates);
  return out;
}
