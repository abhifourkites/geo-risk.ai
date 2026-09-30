import { geoEqualEarth, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { View } from "./api";
import { countryName, threshold } from "./format";

const W = 960, H = 480;
const MIN_AREA_PX = 8;     // a disaster area smaller than this on screen also gets a ring marker, so it can be seen

// Natural Earth 1:110m; ISO_A2_EH is used because ISO_A2 is "-99" for France and Norway.
type World = FeatureCollection<Geometry, { ISO_A2_EH: string; NAME: string }>;
interface Tip { x: number; y: number; title: string; sub: string }

export default function MapView(props: {
  view: View; showAll: boolean; high: number; watch: number;
  highlightSites: Set<string>; highlightCountries: Set<string>; selectedSite: string | null; selectedEvent: string | null;
  onSite: (os_id: string) => void; onCountry: (code: string) => void; onDisaster: (event_id: string) => void;
}) {
  const { view, showAll, highlightSites, highlightCountries, selectedSite, selectedEvent } = props;
  const [world, setWorld] = useState<World | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    fetch("/ne_110m_admin_0_countries.geojson").then((r) => r.json()).then(setWorld);
  }, []);
  const projection = useMemo(() => geoEqualEarth().fitSize([W, H], { type: "Sphere" }), []);
  const path = useMemo(() => geoPath(projection), [projection]);
  const byCode = useMemo(() => new Map(view.countries.map((c) => [c.country_code, c])), [view]);

  // Default: only the disasters that contain at least one of this company's sites.
  const eventsWithSites = useMemo(() => new Set(view.hazards.sites.map((s) => s.event_id)), [view]);
  const areas = useMemo(() => view.hazards.areas.features.filter((f) => {
    const id = String(f.properties?.event_id);
    return showAll || eventsWithSites.has(id) || id === selectedEvent;
  }), [view, showAll, eventsWithSites, selectedEvent]);

  const noOutline = useMemo(() => {
    if (!world) return [];
    const drawn = new Set(world.features.map((f) => f.properties.ISO_A2_EH));
    return view.countries.filter((c) => c.level && c.country_code && !drawn.has(c.country_code));
  }, [world, view]);

  const showTip = (e: MouseEvent, title: string, sub: string) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setTip({ x: e.clientX - r.left, y: e.clientY - r.top, title, sub });
  };
  const activate = (fn: () => void) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); }
  };
  const grouped = highlightSites.size > 0;

  return (
    <div className="map-box" ref={box} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="map" role="img"
           aria-label="World map of your sites, countries at High or Watch, and current disaster areas">
        <defs>
          <pattern id="hatch" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
            <rect width="5" height="5" className="hatch-bg" />
            <line x1="0" y1="0" x2="0" y2="5" className="hatch-line" />
          </pattern>
        </defs>
        <path d={path({ type: "Sphere" }) ?? ""} className="sea" />
        {world?.features.map((f, i) => {
          const code = f.properties.ISO_A2_EH;
          const c = byCode.get(code);
          const lvl = c?.level;
          return (
            <path key={i} d={path(f) ?? ""}
                  className={`country${lvl ? ` ${lvl.toLowerCase()}` : ""}${highlightCountries.has(code) ? " picked" : ""}`}
                  onClick={() => props.onCountry(code)}
                  onMouseMove={(e) => showTip(e, f.properties.NAME, lvl ? `${lvl}: ${(c!.share * 100).toFixed(1)}% of ${view.coverage.basis === "workers" ? "workers" : "sites"}` : c ? `${c.sites} of your sites` : "None of your sites")} />
          );
        })}
        {areas.map((f, i) => {
          const id = String(f.properties?.event_id);
          const name = String(f.properties?.name);
          const alert = String(f.properties?.alert_level);
          const d = path(f as Feature) ?? "";
          const [[x0, y0], [x1, y1]] = path.bounds(f as Feature);
          const small = x1 - x0 < MIN_AREA_PX && y1 - y0 < MIN_AREA_PX;
          const [cx, cy] = path.centroid(f as Feature);
          const common = {
            className: `disaster${id === selectedEvent ? " picked" : ""}`,
            tabIndex: 0, role: "button", "aria-label": `${name}, alert ${alert}`,
            onClick: () => props.onDisaster(id), onKeyDown: activate(() => props.onDisaster(id)),
            onMouseMove: (e: MouseEvent) => showTip(e, name, `Disaster area (alert: ${alert})`),
          };
          return small && Number.isFinite(cx)
            ? <g key={`d${i}`} {...common}><path d={d} /><circle cx={cx} cy={cy} r={7} /></g>
            : <path key={`d${i}`} d={d} {...common} />;
        })}
        {view.sites.map((s) => {
          if (s.lng == null || s.lat == null || s.os_id === selectedSite) return null;
          const p = projection([s.lng, s.lat]);
          if (!p) return null;
          const on = highlightSites.has(s.os_id);
          return (
            <circle key={s.os_id} cx={p[0]} cy={p[1]} r={on ? 3.6 : 2.6}
                    className={`site${on ? " on" : grouped ? " dim" : ""}`} onClick={() => props.onSite(s.os_id)}
                    onMouseMove={(e) => showTip(e, s.name, countryName(s.country_code))} />
          );
        })}
        {(() => {   // the selected site is drawn last, on top
          const s = view.sites.find((x) => x.os_id === selectedSite);
          const p = s && s.lng != null && s.lat != null ? projection([s.lng, s.lat]) : null;
          return s && p ? <circle cx={p[0]} cy={p[1]} r={6} className="site selected" onClick={() => props.onSite(s.os_id)}
                                  onMouseMove={(e) => showTip(e, s.name, countryName(s.country_code))} /> : null;
        })()}
      </svg>
      {tip && (
        <div className="tip" style={{ left: Math.min(tip.x + 14, (box.current?.clientWidth ?? 0) - 220), top: tip.y + 14 }} role="status">
          <strong>{tip.title}</strong><span>{tip.sub}</span>
        </div>
      )}
      <ul className="legend" aria-label="Map legend">
        <li><span className="key high" /> Country at High: {threshold(props.high)} or more of {view.coverage.basis === "workers" ? "your suppliers' workers" : "your sites"}</li>
        <li><span className="key watch" /> Country at Watch: {threshold(props.watch)} to under {threshold(props.high)}</li>
        <li><span className="key land" /> Other countries</li>
        <li><svg className="key-svg" viewBox="0 0 14 14" aria-hidden="true"><rect x="1" y="1" width="12" height="12" className="disaster-key" /></svg> Disaster area (the alert level is shown when you point at it or click it)</li>
        <li><svg className="key-svg" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="3.5" className="site" /></svg> One of your sites</li>
        <li><svg className="key-svg" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5" className="site selected" /></svg> Selected site</li>
      </ul>
      {noOutline.length > 0 && (
        <p className="small">
          Too small to draw at this map scale: {noOutline.map((c) => `${countryName(c.country_code)} (${c.level})`).join(", ")}.
          Their sites still show as dots.
        </p>
      )}
    </div>
  );
}
