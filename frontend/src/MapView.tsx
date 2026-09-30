import { geoEqualEarth, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { useEffect, useMemo, useState } from "react";
import type { View } from "./api";

const W = 960, H = 480;
const COUNTRY_FILL = { High: "var(--high)", Watch: "var(--watch)" } as const;
export const HAZARD_FILL: Record<string, string> = { Red: "#b03a2a", Orange: "#e67e22", Green: "#2e8b57" };

// Natural Earth 1:110m; ISO_A2_EH is used because ISO_A2 is "-99" for France and Norway.
type World = FeatureCollection<Geometry, { ISO_A2_EH: string; NAME: string }>;

export default function MapView(props: {
  view: View; highlight: Set<string>;
  onSite: (os_id: string) => void; onHazard: (event_id: string) => void;
}) {
  const { view, highlight, onSite, onHazard } = props;
  const [world, setWorld] = useState<World | null>(null);
  useEffect(() => {
    fetch("/ne_110m_admin_0_countries.geojson").then((r) => r.json()).then(setWorld);
  }, []);
  const projection = useMemo(() => geoEqualEarth().fitSize([W, H], { type: "Sphere" }), []);
  const path = useMemo(() => geoPath(projection), [projection]);
  const levelOf = useMemo(() => new Map(view.countries.map((c) => [c.country_code, c.level])), [view]);
  // Small countries (e.g. SG, HK) have no outline at 1:110m: say so, so a High / Watch country is never hidden.
  const noOutline = useMemo(() => {
    if (!world) return [];
    const drawn = new Set(world.features.map((f) => f.properties.ISO_A2_EH));
    return view.countries.filter((c) => c.level && c.country_code && !drawn.has(c.country_code));
  }, [world, view]);

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="map" role="img"
           aria-label="Map of the company's sites, countries by level, and current disaster areas">
        <path d={path({ type: "Sphere" }) ?? ""} className="sea" />
        {world?.features.map((f, i) => {
          const lvl = levelOf.get(f.properties.ISO_A2_EH);
          return (
            <path key={i} d={path(f) ?? ""} className="country" style={{ fill: lvl ? COUNTRY_FILL[lvl] : undefined }}>
              <title>{f.properties.NAME}{lvl ? `: ${lvl}` : ""}</title>
            </path>
          );
        })}
        {view.hazards.areas.features.map((f, i) => (
          <path key={`h${i}`} d={path(f as Feature) ?? ""} className="hazard"
                style={{ fill: HAZARD_FILL[String(f.properties?.alert_level)] ?? "#888" }}
                onClick={() => onHazard(String(f.properties?.event_id))}>
            <title>{String(f.properties?.name)} (GDACS {String(f.properties?.alert_level)})</title>
          </path>
        ))}
        {view.sites.map((s) => {
          if (s.lng == null || s.lat == null) return null;
          const p = projection([s.lng, s.lat]);
          if (!p) return null;
          const on = highlight.has(s.os_id);
          return (
            <circle key={s.os_id} cx={p[0]} cy={p[1]} r={on ? 4.5 : 2.4}
                    className={`site${on ? " on" : ""}`} onClick={() => onSite(s.os_id)}>
              <title>{s.name}</title>
            </circle>
          );
        })}
      </svg>
      {noOutline.length > 0 && (
        <p className="small">
          No outline at this map scale: {noOutline.map((c) => `${c.country_code} (${c.level})`).join(", ")}.
          Their sites are still shown as dots, and the country is in the table.
        </p>
      )}
    </>
  );
}
