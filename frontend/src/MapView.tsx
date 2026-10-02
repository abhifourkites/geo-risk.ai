import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import { setWorkerUrl, type ExpressionSpecification, type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
// MapLibre's documented setup for Vite (https://maplibre.org/maplibre-gl-js/docs/, Installation): "?worker&url"
// bundles the worker with its sibling maplibre-gl-shared.mjs into one chunk, in development and in production builds.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SxProps, Theme } from "@mui/material/styles";
import Map, { Layer, NavigationControl, Source, type ErrorEvent, type MapLayerMouseEvent, type MapRef } from "react-map-gl/maplibre";
import type { View } from "./api";
import { BASEMAPS, isServiceError, landOpacity, loadBasemap, PLAIN_STYLE, SERVICE, type Basemap } from "./basemap";
import { countryName, shortEventName, threshold } from "./format";
import { boundsOf, coordsOf, sphericalMean, WORLD, type Focus } from "./geo";
import { RISK } from "./theme";

setWorkerUrl(workerUrl);

// Natural Earth 1:50m; ISO_A2_EH is used because ISO_A2 is "-99" for some countries (France and Norway at 1:110m).
type World = FeatureCollection<Geometry, { ISO_A2_EH: string; NAME: string }>;

const EMPTY: World = { type: "FeatureCollection", features: [] };
const SMALL_AREA_DEG = 3;   // an area narrower than this (about 8 px at world zoom) also gets a ring marker
const INTERACTIVE = ["selected-ring", "highlight", "site", "clusters", "disaster-ring", "disaster-fill", "land"];
const SITE_LAYERS = new Set(["selected-ring", "highlight", "site"]);
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const inList = (codes: string[]): ExpressionSpecification => ["in", ["get", "ISO_A2_EH"], ["literal", codes]];

interface Tip { x: number; y: number; title: string; sub: string }

// Cluster counts are drawn by MapLibre itself, as icons: text in a map layer needs glyph files from a URL,
// and this app loads nothing from outside. Each count becomes a small image the first time it is needed,
// so the counts are drawn with their circles (flat map and globe) and never left behind at another zoom.
const COUNT = "count-";
function countImage(text: string, ratio: number): ImageData {
  const w = Math.ceil((8 + 7.5 * text.length) * ratio), h = Math.ceil(16 * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext("2d")!;
  g.font = `700 ${12 * ratio}px Inter, system-ui, sans-serif`;
  g.fillStyle = "#FFFFFF"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + 0.5 * ratio);
  return g.getImageData(0, 0, w, h);
}

export default function MapView(props: {
  view: View; high: number; watch: number; focus: Focus | null;
  showAll: boolean; onShowAll: (v: boolean) => void;
  highlightSites: Set<string>; highlightCountries: Set<string>; selectedSite: string | null; selectedEvent: string | null;
  onSite: (os_id: string) => void; onCountry: (code: string) => void; onDisaster: (event_id: string) => void;
}) {
  const { view, focus, showAll, highlightSites, highlightCountries, selectedSite, selectedEvent } = props;
  const map = useRef<MapRef>(null);
  const box = useRef<HTMLDivElement>(null);
  const [world, setWorld] = useState<World | null>(null);
  const [globe, setGlobe] = useState(false);
  // An object, not a string: MapLibre 6 reads projection.type ("Unknown projection name: undefined" otherwise).
  const projection = useMemo(() => ({ type: globe ? "globe" : "mercator" }), [globe]);
  const [tip, setTip] = useState<Tip | null>(null);
  const [loaded, setLoaded] = useState(false);   // the map's style is loaded: the site layers can be added
  const [ready, setReady] = useState(false);     // outlines and sites are drawn: the loading message goes
  const hovered = useRef<number | string | null>(null);
  // The map style (basemap.ts): the one asked for, and the one on show (Plain until its tile service has answered).
  // A service that does not answer, or fails later, gives Plain again with a one-line notice.
  const [basemap, setBasemap] = useState<Basemap>("plain");
  const [shown, setShown] = useState<{ mode: Basemap; style: StyleSpecification }>({ mode: "plain", style: PLAIN_STYLE });
  const [notice, setNotice] = useState<string | null>(null);
  const asked = useRef<Basemap>("plain");
  const shownMode = useRef<Basemap>("plain");
  shownMode.current = shown.mode;
  const fallBack = useCallback((mode: Basemap) => {
    if (mode === "plain") return;
    asked.current = "plain";
    setBasemap("plain");
    setShown({ mode: "plain", style: PLAIN_STYLE });
    setNotice(`${BASEMAPS.find((b) => b.value === mode)?.label}: ${SERVICE[mode].name} did not respond, so the plain map is shown.`);
  }, []);
  const chooseBasemap = (mode: Basemap) => {
    asked.current = mode;
    setBasemap(mode);
    setNotice(null);
    loadBasemap(mode).then((style) => { if (asked.current === mode) setShown({ mode, style }); })
      .catch(() => { if (asked.current === mode) fallBack(mode); });
  };
  const onError = (e: ErrorEvent) => {
    if (isServiceError(e, shownMode.current)) fallBack(shownMode.current);
    else console.error(e.error);           // as react-map-gl does without onError
  };

  useEffect(() => { fetch("/ne_50m_admin_0_countries.geojson").then((r) => r.json()).then(setWorld); }, []);

  const high = useMemo(() => view.countries.filter((c) => c.level === "High" && c.country_code).map((c) => c.country_code!), [view]);
  const watch = useMemo(() => view.countries.filter((c) => c.level === "Watch" && c.country_code).map((c) => c.country_code!), [view]);
  const noOutline = useMemo(() => {
    if (!world) return [];
    const drawn = new Set(world.features.map((f) => f.properties.ISO_A2_EH));
    return view.countries.filter((c) => c.level && c.country_code && !drawn.has(c.country_code));
  }, [world, view]);

  const sites = useMemo<FeatureCollection<Point>>(() => ({
    type: "FeatureCollection",
    features: view.sites.filter((s) => s.lng != null && s.lat != null).map((s, i) => ({
      type: "Feature", id: i, geometry: { type: "Point", coordinates: [s.lng!, s.lat!] },
      properties: { os_id: s.os_id, name: s.name, country: countryName(s.country_code) },
    })),
  }), [view]);
  const subset = useCallback((keep: (os: string) => boolean): FeatureCollection<Point> =>
    ({ type: "FeatureCollection", features: sites.features.filter((f) => keep(String(f.properties?.os_id))) }), [sites]);
  const highlighted = useMemo(() => subset((os) => highlightSites.has(os)), [subset, highlightSites]);
  const selected = useMemo(() => subset((os) => os === selectedSite), [subset, selectedSite]);
  const grouped = highlightSites.size > 0;

  // Default: only the disasters that contain at least one of this company's sites.
  const eventsWithSites = useMemo(() => new Set(view.hazards.sites.map((s) => s.event_id)), [view]);
  const areas = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: view.hazards.areas.features.filter((f) => {
      const id = String(f.properties?.event_id);
      return showAll || eventsWithSites.has(id) || id === selectedEvent;
    }),
  }), [view, showAll, eventsWithSites, selectedEvent]);
  const rings = useMemo<FeatureCollection<Point>>(() => ({
    type: "FeatureCollection",
    features: areas.features.flatMap((f): Feature<Point>[] => {
      const b = boundsOf(coordsOf(f.geometry));
      if (!b || b[1][0] - b[0][0] > SMALL_AREA_DEG || b[1][1] - b[0][1] > SMALL_AREA_DEG) return [];
      return [{ type: "Feature", properties: f.properties, geometry: { type: "Point", coordinates: [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2] } }];
    }),
  }), [areas]);

  // Reset view: the company's sites, pitch 0. Flat map: fit their bounds. Globe: centre on them (the mean
  // of their positions on the sphere), at a zoom where the globe fills the map's height.
  const points = useRef<[number, number][]>([]);
  points.current = sites.features.map((f) => f.geometry.coordinates as [number, number]);
  const resetView = useCallback((asGlobe: boolean, animate = true) => {
    const m = map.current;
    if (!m) return;
    const duration = animate && !reducedMotion() ? 1000 : 0;
    const pts = points.current;
    const b = boundsOf(pts);
    if (asGlobe) m.easeTo({ center: pts.length ? sphericalMean(pts) : [30, 15], zoom: 1.6, pitch: 0, bearing: 0, duration });
    else m.fitBounds(b ?? WORLD, { padding: 40, maxZoom: 6, pitch: 0, bearing: 0, duration });
  }, []);

  // A new company: fit the map to its sites.
  useEffect(() => { if (loaded) resetView(globe); }, [view.customer.customer_id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const onLoad = () => {
    const m = map.current?.getMap();
    if (!m) return;
    // MapLibre 6 asks this resolver for a missing icon before it treats the icon as missing
    // (the "styleimagemissing" event fires only afterwards, too late for that tile).
    m.setMissingStyleImageResolver((id) => {
      if (!id.startsWith(COUNT) || m.hasImage(id)) return;
      const ratio = window.devicePixelRatio || 1;
      m.addImage(id, countImage(id.slice(COUNT.length), ratio), { pixelRatio: ratio });
    });
    setLoaded(true);
    resetView(false, false);
  };
  const onIdle = () => {
    const m = map.current?.getMap();
    if (!ready && world && m?.getSource("sites") && m.isSourceLoaded("countries") && m.isSourceLoaded("sites")) setReady(true);
  };

  // Move the map when the selection asks for it; jump instead of flying when motion is reduced.
  useEffect(() => {
    const m = map.current;
    if (!focus || !m) return;
    const duration = reducedMotion() ? 0 : 1400;
    // On a narrow screen the map is above the panel and the tables: bring it into view (MUI's md breakpoint).
    if (focus.scroll && window.matchMedia("(max-width: 899.95px)").matches) {
      box.current?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    }
    if (focus.kind === "point") m.flyTo({ center: focus.center, zoom: focus.zoom, pitch: focus.pitch, bearing: 0, duration });
    else m.fitBounds(focus.bounds, { padding: 60, maxZoom: 7, pitch: 0, bearing: 0, duration });
  }, [focus]);   // eslint-disable-line react-hooks/exhaustive-deps -- only a new focus moves the map

  const setHover = (id: number | string | null) => {
    const m = map.current?.getMap();
    if (!m) return;
    if (hovered.current != null) m.setFeatureState({ source: "sites", id: hovered.current }, { hover: false });
    hovered.current = id;
    if (id != null) m.setFeatureState({ source: "sites", id }, { hover: true });
  };
  const top = (e: MapLayerMouseEvent) => {
    const fs = e.features ?? [];
    for (const layer of INTERACTIVE) { const f = fs.find((x) => x.layer.id === layer); if (f) return f; }
    return null;
  };
  const onMove = (e: MapLayerMouseEvent) => {
    const f = top(e);
    setHover(f?.layer.id === "site" ? (f.id ?? null) : null);
    if (!f) { setTip(null); return; }
    const p = f.properties as Record<string, string>;
    const at = { x: e.point.x, y: e.point.y };
    if (SITE_LAYERS.has(f.layer.id)) setTip({ ...at, title: p.name, sub: p.country });
    else if (f.layer.id === "clusters") setTip({ ...at, title: `${p.point_count} sites`, sub: "Click to zoom in" });
    else if (f.layer.id === "land") {
      const c = view.countries.find((x) => x.country_code === p.ISO_A2_EH);
      setTip({ ...at, title: p.NAME, sub: c?.level ? `${c.level}: ${(c.share * 100).toFixed(1)}%` : c ? `${c.sites} of your sites` : "None of your sites" });
    } else setTip({ ...at, title: shortEventName(p.name), sub: `Disaster area (alert: ${p.alert_level})` });
  };
  const onClick = async (e: MapLayerMouseEvent) => {
    const f = top(e);
    if (!f) return;
    const p = f.properties as Record<string, string>;
    if (SITE_LAYERS.has(f.layer.id)) props.onSite(p.os_id);
    else if (f.layer.id === "clusters") {
      const m = map.current?.getMap();
      const src = m?.getSource("sites") as GeoJSONSource | undefined;
      if (!m || !src) return;
      const zoom = await src.getClusterExpansionZoom(Number(p.cluster_id));
      m.easeTo({ center: (f.geometry as Point).coordinates as [number, number], zoom, duration: reducedMotion() ? 0 : 600 });
    } else if (f.layer.id === "land") props.onCountry(p.ISO_A2_EH);
    else props.onDisaster(p.event_id);
  };

  const siteRadius = (base: number, hover: number): ExpressionSpecification =>
    ["interpolate", ["linear"], ["zoom"],
      0, ["case", ["boolean", ["feature-state", "hover"], false], base * hover, base],
      8, ["case", ["boolean", ["feature-state", "hover"], false], base * 1.8 * hover, base * 1.8]];

  return (
    <Box>
      {/* the attributions (long for Satellite) wrap to the right of the legend, never over it */}
      <Box ref={box} sx={{ position: "relative", height: { xs: 380, md: 560 }, borderRadius: 2.5, overflow: "hidden", border: 1, borderColor: "divider", bgcolor: "#EEF1F2",
                           "& .maplibregl-ctrl-bottom-right": { maxWidth: { sm: "calc(100% - 220px)" } } }}>
        <Map ref={map} mapStyle={shown.style} styleDiffing={false} initialViewState={{ bounds: WORLD, fitBoundsOptions: { padding: 10 } }}
             projection={projection} renderWorldCopies={false} maxPitch={60}
             interactiveLayerIds={INTERACTIVE} cursor={tip ? "pointer" : "grab"}
             onMouseMove={onMove} onMouseLeave={() => { setHover(null); setTip(null); }} onClick={onClick}
             onLoad={onLoad} onIdle={onIdle} onError={onError}
             style={{ width: "100%", height: "100%" }}>
          {/* Mounted from the start (empty until the file arrives), so the land layers are always added first,
              under the sites; mounted later, they were added on top and hid some clusters. After a change of map
              style, react-map-gl adds these sources and layers again, in this order, on top of the new style. */}
          {(
            <Source id="countries" type="geojson" data={world ?? EMPTY} attribution="Natural Earth">
              <Layer id="land" type="fill" paint={{
                "fill-color": ["case", inList(high), RISK.high, inList(watch), RISK.watchFill, RISK.land],
                "fill-opacity": landOpacity(shown.mode, inList([...high, ...watch])),
              }} />
              {/* the Map style draws its own borders */}
              <Layer id="borders" type="line" layout={{ visibility: shown.mode === "map" ? "none" : "visible" }}
                     paint={{ "line-color": "#FFFFFF", "line-width": 0.8 }} />
              <Layer id="country-picked" type="line" filter={inList([...highlightCountries])}
                     paint={{ "line-color": RISK.selected, "line-width": 1.6 }} />
            </Source>
          )}
          <Source id="disasters" type="geojson" data={areas}>
            <Layer id="disaster-fill" type="fill" paint={{ "fill-color": RISK.disaster, "fill-opacity": 0.15 }} />
            <Layer id="disaster-line" type="line" paint={{
              "line-color": RISK.disaster,
              "line-width": ["case", ["==", ["get", "event_id"], selectedEvent ?? ""], 3.5, 2],
            }} />
          </Source>
          <Source id="disaster-rings" type="geojson" data={rings}>
            <Layer id="disaster-ring" type="circle" maxzoom={4.5} paint={{
              "circle-radius": 9, "circle-color": RISK.disaster, "circle-opacity": 0.15,
              "circle-stroke-color": RISK.disaster, "circle-stroke-width": 2,
            }} />
          </Source>
          {/* The site layers are added once the map has loaded, after the count-image resolver is in place;
              added last, they are drawn above the land and the disaster areas. */}
          {loaded && <>
          <Source id="sites" type="geojson" data={sites} cluster clusterRadius={36} clusterMaxZoom={6}>
            <Layer id="clusters" type="circle" filter={["has", "point_count"]} paint={{
              "circle-color": RISK.site, "circle-opacity": grouped ? 0.3 : 0.85,
              "circle-radius": ["step", ["get", "point_count"], 12, 10, 15, 50, 19, 200, 24],
              "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 1.5,
            }} />
            <Layer id="cluster-count" type="symbol" filter={["has", "point_count"]} layout={{
              "icon-image": ["concat", COUNT, ["to-string", ["get", "point_count_abbreviated"]]],
              "icon-allow-overlap": true, "icon-ignore-placement": true,
            }} paint={{ "icon-opacity": grouped ? 0.3 : 1 }} />
            <Layer id="site" type="circle" filter={["!", ["has", "point_count"]]} paint={{
              "circle-color": RISK.site, "circle-opacity": grouped ? 0.3 : 1, "circle-stroke-opacity": grouped ? 0.3 : 1,
              "circle-radius": siteRadius(5, 1.5), "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 1.5,
            }} />
          </Source>
          <Source id="highlight" type="geojson" data={highlighted}>
            <Layer id="highlight" type="circle" paint={{
              "circle-color": RISK.site, "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 5.5, 8, 10],
              "circle-stroke-color": RISK.selected, "circle-stroke-width": 1.5,
            }} />
          </Source>
          <Source id="selected" type="geojson" data={selected}>
            <Layer id="selected-ring" type="circle" paint={{
              "circle-color": RISK.site, "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 8, 8, 13],
              "circle-stroke-color": RISK.selected, "circle-stroke-width": 3,
            }} />
          </Source>
          </>}
          <NavigationControl position="top-right" visualizePitch />
        </Map>

        {!ready && (
          <Box data-testid="map-loading" role="status" sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 1.5, bgcolor: "rgba(246, 247, 245, 0.92)", zIndex: 1 }}>
            <CircularProgress size={20} aria-hidden="true" />
            <Typography variant="body2">Loading map…</Typography>
          </Box>
        )}

        <Paper variant="outlined" sx={{ position: "absolute", top: 8, left: 8, p: 1, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1, maxWidth: "calc(100% - 70px)" }}>
          <FormControlLabel sx={{ m: 0, mr: 1 }} control={<Switch size="small" checked={showAll} onChange={(e) => props.onShowAll(e.target.checked)} />}
                            label={<Typography variant="caption">Show all current disasters</Typography>} />
          <ToggleButtonGroup size="small" exclusive value={globe ? "globe" : "flat"} aria-label="Map projection"
                             onChange={(_, v) => { if (v) { setGlobe(v === "globe"); resetView(v === "globe"); } }}>
            <ToggleButton value="flat" sx={{ py: 0.25, textTransform: "none" }}>Flat map</ToggleButton>
            <ToggleButton value="globe" sx={{ py: 0.25, textTransform: "none" }}>Globe view</ToggleButton>
          </ToggleButtonGroup>
          <ToggleButtonGroup size="small" exclusive value={basemap} aria-label="Map style"
                             onChange={(_, v: Basemap | null) => { if (v) chooseBasemap(v); }}>
            {BASEMAPS.map((b) => <ToggleButton key={b.value} value={b.value} sx={{ py: 0.25, textTransform: "none" }}>{b.label}</ToggleButton>)}
          </ToggleButtonGroup>
          <Button size="small" variant="outlined" onClick={() => resetView(globe)}>
            Reset view
          </Button>
        </Paper>

        {tip && (
          <Paper elevation={3} role="status" sx={{ position: "absolute", left: Math.min(tip.x + 14, (box.current?.clientWidth ?? 9999) - 250), top: Math.min(tip.y + 14, (box.current?.clientHeight ?? 9999) - 60), px: 1, py: 0.5, pointerEvents: "none", maxWidth: 240, bgcolor: "text.primary", color: "#fff" }}>
            <Typography variant="caption" component="div" sx={{ fontWeight: 600 }}>{tip.title}</Typography>
            <Typography variant="caption" component="div">{tip.sub}</Typography>
          </Paper>
        )}

        <Legend high={props.high} watch={props.watch} sx={{ position: "absolute", left: 8, bottom: 8, display: { xs: "none", sm: "block" } }} />
      </Box>
      <Legend high={props.high} watch={props.watch} sx={{ mt: 1, display: { xs: "block", sm: "none" } }} />
      <Stack direction="row" spacing={2} sx={{ mt: 1, flexWrap: "wrap" }}>
        {notice && <Typography variant="caption" role="status" data-testid="basemap-notice" sx={{ color: RISK.watchText, fontWeight: 600 }}>{notice}</Typography>}
        <Typography variant="caption" color="text.secondary">Disaster data: GDACS, automatic alerts. Confirm before acting.</Typography>
        {noOutline.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            Too small to draw at this map scale: {noOutline.map((c) => `${countryName(c.country_code)} (${c.level})`).join(", ")}. Their sites still show on the map.
          </Typography>
        )}
      </Stack>
    </Box>
  );
}

/** The map legend in plain words: in the map's corner, or under the map on a phone. */
function Legend({ high, watch, sx }: { high: number; watch: number; sx: SxProps<Theme> }) {
  const items: [ReactNode, string][] = [
    [<Swatch key="h" color={RISK.high} opacity={0.55} />, `High: ${threshold(high)} or more`],
    [<Swatch key="w" color={RISK.watchFill} opacity={0.55} />, `Watch: ${threshold(watch)} to under ${threshold(high)}`],
    [<Swatch key="d" color={RISK.disaster} opacity={0.15} border={RISK.disaster} />, "Disaster area"],
    [<Dot key="s" size={9} />, "Your site"],
    [<Dot key="c" size={14} />, "Group of sites (count)"],
    [<Dot key="x" size={12} ring />, "Selected site"],
  ];
  return (
    <Paper variant="outlined" component="ul" aria-label="Map legend" sx={[{ m: 0, px: 1, py: 0.75, listStyle: "none", width: 196, opacity: 0.95 }, ...(Array.isArray(sx) ? sx : [sx])]}>
      {items.map(([icon, text], i) => (
        <Box component="li" key={i} sx={{ display: "flex", alignItems: "center", gap: 1, lineHeight: 1.6 }}>
          {icon}<Typography variant="caption" sx={{ fontSize: 12 }}>{text}</Typography>
        </Box>
      ))}
    </Paper>
  );
}

function Swatch({ color, opacity = 1, border }: { color: string; opacity?: number; border?: string }) {
  return <Box component="span" sx={{ width: 14, height: 14, borderRadius: 0.5, flex: "none", position: "relative", border: border ? `2px solid ${border}` : "1px solid #D5DBDD" }}>
    <Box component="span" sx={{ position: "absolute", inset: 0, bgcolor: color, opacity }} />
  </Box>;
}
function Dot({ size, ring }: { size: number; ring?: boolean }) {
  return <Box component="span" sx={{ width: 16, display: "flex", justifyContent: "center", flex: "none" }}>
    <Box component="span" sx={{ width: size, height: size, borderRadius: "50%", bgcolor: RISK.site, border: ring ? `3px solid ${RISK.selected}` : "1.5px solid #fff", boxShadow: ring ? "none" : `0 0 0 1px ${RISK.site}` }} />
  </Box>;
}
