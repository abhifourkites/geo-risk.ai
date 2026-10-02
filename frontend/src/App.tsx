import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Alert from "@mui/material/Alert";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import FormControl from "@mui/material/FormControl";
import Grid from "@mui/material/Grid";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { Customer, View } from "./api";
import AnswerCards, { type CardKind } from "./Cards";
import { EVENT_TYPE, plural, threshold, updatedAt } from "./format";
import { boundsOf, coordsOf, type Focus } from "./geo";
import MapView from "./MapView";
import DetailPanel, { type Detail } from "./Panel";
import DataTables from "./Tables";
import Upload from "./Upload";

const Network = lazy(() => import("./Network"));     // React Flow is loaded only for this page

type FocusSpec = { kind: "point"; center: [number, number]; zoom: number; pitch: number } | { kind: "bounds"; bounds: [[number, number], [number, number]] };

export default function App() {
  const [page, setPage] = useState<"map" | "upload" | "network">("map");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [c, setC] = useState<string>("");
  const [high, setHigh] = useState(10);
  const [watch, setWatch] = useState(5);
  const [view, setView] = useState<View | null>(null);
  const [detail, setDetail] = useState<Detail>(null);
  const [showAll, setShowAll] = useState(false);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const focusKey = useRef(0);

  const loadCustomers = useCallback(async (select?: string) => {
    const list = await api.customers();
    setCustomers(list);
    setC((cur) => select ?? (cur || list[0]?.customer_id || ""));
  }, []);
  useEffect(() => { loadCustomers().catch((e) => setError(String(e.message))); }, [loadCustomers]);

  const loadView = useCallback(async () => {
    if (!c) return;
    try { setView(await api.view(c, high, watch)); setError(null); }
    catch (e) { setError(String((e as Error).message)); }
  }, [c, high, watch]);
  useEffect(() => { loadView(); }, [loadView]);
  useEffect(() => { setDetail(null); }, [c]);   // the map fits itself to the new company's sites

  // While the first GDACS check after a backend start is still running, look again every 5 seconds.
  useEffect(() => {
    if (view?.hazards.status.state !== "loading") return;
    const t = setTimeout(loadView, 5000);
    return () => clearTimeout(t);
  }, [view, loadView]);

  // Moving the map to a selection.
  const moveTo = (f: FocusSpec | null, scroll = false) => { if (f) setFocus({ ...f, key: ++focusKey.current, scroll }); };
  const pointsOf = (ids: Iterable<string>) => {
    const want = new Set(ids);
    return (view?.sites ?? []).filter((s) => want.has(s.os_id) && s.lng != null && s.lat != null).map((s) => [s.lng!, s.lat!] as [number, number]);
  };
  const around = (points: [number, number][]): FocusSpec | null => {
    const b = boundsOf(points);
    if (!b) return null;
    const one = b[0][0] === b[1][0] && b[0][1] === b[1][1];
    return one ? { kind: "point", center: b[0], zoom: 6, pitch: 0 } : { kind: "bounds", bounds: b };
  };

  // scroll: true when the click came from the panel or a table (the default); false from the map itself.
  const show = async (p: Promise<Detail>, move: (d: Detail) => FocusSpec | null, scroll: boolean) => {
    try { const d = await p; setDetail(d); moveTo(move(d), scroll); } catch (e) { setError(String((e as Error).message)); }
  };
  const go = {
    site: (os: string, scroll = true) => show(api.site(c, os).then((data) => ({ kind: "site", data })), () => {
      const [p] = pointsOf([os]);
      return p ? { kind: "point", center: p, zoom: 7, pitch: 45 } : null;
    }, scroll),
    owner: (o: string, scroll = true) => show(api.owner(c, o).then((data) => ({ kind: "owner", data })),
      (d) => (d?.kind === "owner" ? around(pointsOf(d.data.sites.map((s) => s.os_id))) : null), scroll),
    disaster: (e: string, scroll = true) => show(api.hazard(c, e).then((data) => ({ kind: "disaster", data })), (d) => {
      if (d?.kind !== "disaster") return null;
      const areas = (view?.hazards.areas.features ?? []).filter((f) => String(f.properties?.event_id) === e).flatMap((f) => coordsOf(f.geometry));
      return around([...areas, ...pointsOf(d.data.sites.map((s) => s.os_id))]);
    }, scroll),
    country: (code: string, scroll = true) => {
      setDetail({ kind: "country", code });
      moveTo(around(pointsOf((view?.sites ?? []).filter((s) => s.country_code === code).map((s) => s.os_id))), scroll);
    },
  };

  // What the map highlights for the current selection.
  const marks = useMemo(() => {
    const sites = new Set<string>(); const countries = new Set<string>();
    let site: string | null = null; let event: string | null = null;
    if (view && detail) {
      if (detail.kind === "site") site = detail.data.site.os_id;
      if (detail.kind === "owner") detail.data.sites.forEach((s) => sites.add(s.os_id));
      if (detail.kind === "disaster") {
        event = detail.data.event.event_id;
        detail.data.sites.forEach((s) => sites.add(s.os_id));
        Object.values(detail.data.owners_other_sites).flat().forEach((s) => sites.add(s.os_id));
      }
      if (detail.kind === "country") {
        countries.add(detail.code);
        view.sites.filter((s) => s.country_code === detail.code).forEach((s) => sites.add(s.os_id));
      }
      if (detail.kind === "card" && detail.card === "countries") {
        view.countries.filter((x) => x.level && x.country_code).forEach((x) => countries.add(x.country_code!));
        view.sites.filter((s) => s.country_code && countries.has(s.country_code)).forEach((s) => sites.add(s.os_id));
      }
      if (detail.kind === "card" && detail.card === "owners") {
        const flagged = view.owners.all.filter((o) => o.level);
        const names = new Set((flagged.length ? flagged : view.owners.all.slice(0, 1)).map((o) => o.owner));
        view.sites.filter((s) => s.owners.some((o) => names.has(o))).forEach((s) => sites.add(s.os_id));
      }
      if (detail.kind === "card" && detail.card === "disasters") view.hazards.sites.forEach((s) => sites.add(s.os_id));
    }
    return { sites, countries, site, event };
  }, [view, detail]);

  const openCard = (card: CardKind) => {
    if (detail?.kind === "card" && detail.card === card) { setDetail(null); return; }
    setDetail({ kind: "card", card });
    if (!view) return;
    let ids: string[] = [];
    if (card === "countries") {
      const codes = new Set(view.countries.filter((x) => x.level && x.country_code).map((x) => x.country_code!));
      ids = view.sites.filter((s) => s.country_code && codes.has(s.country_code)).map((s) => s.os_id);
    } else if (card === "owners") {
      const flagged = view.owners.all.filter((o) => o.level);
      const names = new Set((flagged.length ? flagged : view.owners.all.slice(0, 1)).map((o) => o.owner));
      ids = view.sites.filter((s) => s.owners.some((o) => names.has(o))).map((s) => s.os_id);
    } else ids = view.hazards.sites.map((s) => s.os_id);
    moveTo(around(pointsOf(ids)));
  };

  async function refreshHazards() {
    setRefreshing(true);
    try { await api.refreshHazards(); await loadView(); }
    catch (e) { setError(String((e as Error).message)); }
    finally { setRefreshing(false); }
  }

  const hz = view?.hazards.status;
  const updated = hz?.state === "ok" ? `Disaster data: ${updatedAt(hz.at) ?? hz.at}`
    : hz?.state === "unavailable" ? "Disaster data unavailable" : hz ? "Checking for current disasters…" : "Loading…";
  const repeats = Object.entries(hz?.repeated_by_type ?? {}).filter(([, n]) => n > 0);

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="static" color="inherit" elevation={0} sx={{ bgcolor: "background.paper", borderBottom: 1, borderColor: "divider" }}>
        <Toolbar sx={{ maxWidth: 1440, width: "100%", mx: "auto", gap: 2, flexWrap: "wrap", py: 1 }}>
          <Typography variant="h1">Supplier risk map</Typography>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="company-label">Company</InputLabel>
            <Select labelId="company-label" id="company" label="Company" value={customers.some((x) => x.customer_id === c) ? c : ""}
                    onChange={(e) => { setC(String(e.target.value)); setPage((p) => (p === "network" ? p : "map")); }}>
              {customers.map((x) => <MenuItem key={x.customer_id} value={x.customer_id}>{x.name}</MenuItem>)}
            </Select>
          </FormControl>
          <Chip label={updated} variant="outlined" role="status" id="disaster-status"
                sx={hz?.state === "unavailable" ? { borderColor: "error.main", color: "error.main" } : undefined} />
          <Box sx={{ flex: 1 }} />
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
            <Button variant="contained" onClick={refreshHazards} disabled={refreshing}>{refreshing ? "Checking…" : "Check for new disasters"}</Button>
          </Stack>
        </Toolbar>
        <Box sx={{ maxWidth: 1440, width: "100%", mx: "auto", px: 3 }}>
          <Tabs value={page} onChange={(_, v) => setPage(v)} aria-label="Pages" sx={{ minHeight: 40, "& .MuiTab-root": { minHeight: 40, py: 0.5 } }}>
            <Tab value="map" label="Risk map" />
            <Tab value="upload" label="Upload a supplier list" />
            <Tab value="network" label="Company network" />
          </Tabs>
        </Box>
      </AppBar>

      <Container maxWidth={false} sx={{ maxWidth: 1440, py: 3, px: { xs: 2, md: 3 } }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {page === "upload" && <Upload onDone={(id) => { loadCustomers(id).then(() => setPage("map")); }} />}
        {page === "network" && <Suspense fallback={<Typography color="text.secondary">Loading…</Typography>}><Network company={customers.find((x) => x.customer_id === c)} /></Suspense>}
        {page === "map" && !view && !error && <Typography color="text.secondary">Loading…</Typography>}

        {page === "map" && view && (
          <Stack spacing={3} component="main">
            <Box component="section" aria-label="Summary">
              <Typography variant="caption" color="text.secondary" component="p" id="summary-meta">
                {view.customer.name} · {plural(view.coverage.open_sites, "site", "sites")} on your current lists
              </Typography>
              <Typography variant="h2" component="p" id="summary-sentence" sx={{ maxWidth: "70ch" }}>{view.sentence}</Typography>
            </Box>

            <AnswerCards view={view} high={high} watch={watch} active={detail?.kind === "card" ? detail.card : null} onOpen={openCard} />

            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 8 }}>
                <MapView view={view} high={high} watch={watch} focus={focus} showAll={showAll} onShowAll={setShowAll}
                         highlightSites={marks.sites} highlightCountries={marks.countries} selectedSite={marks.site} selectedEvent={marks.event}
                         onSite={(os) => go.site(os, false)} onCountry={(code) => go.country(code, false)} onDisaster={(e) => go.disaster(e, false)} />
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <DetailPanel detail={detail} view={view} high={high} watch={watch} go={go} />
              </Grid>
            </Grid>

            <DataTables key={view.customer.customer_id} view={view} onCountry={go.country} onOwner={go.owner} />

            <Box>
              <Accordion variant="outlined" sx={{ borderRadius: 2.5, "&:before": { display: "none" } }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-controls="how-content" id="how-header">
                  <Typography variant="subtitle2" component="h2">How these numbers are worked out</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={1.5} sx={{ maxWidth: "80ch" }}>
                    <Typography variant="body2"><strong>Sites.</strong> Only sites on your current lists that are not closed are counted: {view.coverage.open_sites} for {view.customer.name}.</Typography>
                    <Typography variant="body2"><strong>Share basis.</strong> Shares use {view.coverage.basis === "workers" ? "your suppliers' workers" : "site counts"}.
                      Workers are used when they are known for at least 90% of sites.{" "}
                      <Typography variant="caption" color="text.secondary" component="span">Workers known for {view.coverage.workers_known.known} of {view.coverage.open_sites} sites.</Typography></Typography>
                    <Typography variant="body2"><strong>Coverage.</strong>{" "}
                      <Typography variant="caption" color="text.secondary" component="span">Owner known for {view.coverage.owner_known.known} of {view.coverage.open_sites} sites.
                      Location known for {view.coverage.location_known.known} of {view.coverage.open_sites} sites.</Typography></Typography>
                    <Typography variant="body2"><strong>Levels.</strong> A country or owner company is at High when it holds a set share or more, and at Watch
                      at a lower share. A site inside a current disaster area is at High for an Orange or Red alert, and at Watch for a Green alert.</Typography>
                    <Stack direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
                      <TextField size="small" type="number" label="High at (%)" value={high} onChange={(e) => setHigh(Number(e.target.value))}
                                 slotProps={{ htmlInput: { min: 0.1, max: 100, step: 0.5 } }} sx={{ width: 140 }} />
                      <TextField size="small" type="number" label="Watch at (%)" value={watch} onChange={(e) => setWatch(Number(e.target.value))}
                                 slotProps={{ htmlInput: { min: 0.1, max: 100, step: 0.5 } }} sx={{ width: 140 }} />
                      <Typography variant="caption" color="text.secondary">Now: High {threshold(high)} or more, Watch {threshold(watch)} or more.</Typography>
                    </Stack>
                    <Typography variant="body2"><strong>Owner companies.</strong> A site with 2 or more owners counts in full under each owner.{" "}
                      <Typography variant="caption" color="text.secondary" component="span">{view.owners.all_in_one_country.count} of {view.owners.all_in_one_country.of_owners_with_2_plus_sites} owners
                      with 2 or more sites have all of them in one country.</Typography></Typography>
                  </Stack>
                </AccordionDetails>
              </Accordion>
              <Accordion variant="outlined" sx={{ mt: 1, borderRadius: 2.5, "&:before": { display: "none" } }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-controls="source-content" id="source-header">
                  <Typography variant="subtitle2" component="h2">Source and limits of the data</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={1.5} sx={{ maxWidth: "80ch" }}>
                    <Typography variant="body2"><strong>Disaster data:</strong> GDACS (Global Disaster Awareness and Coordination System). Alerts are automatic,
                      not reviewed by people. Confirm before making decisions.</Typography>
                    {repeats.length > 0 && (
                      <Typography variant="body2">GDACS's list of current disasters repeats some entries across its pages, so some may be missing from this map:{" "}
                        {repeats.map(([t, n]) => `up to ${n} ${EVENT_TYPE[t] ?? t}`).join(", ")} at the last check.</Typography>
                    )}
                    <Typography variant="body2"><strong>Your lists</strong> (each name carries the list's date):</Typography>
                    <Box component="ul" sx={{ m: 0, pl: 3 }}>{view.lists.map((l) => <li key={l}><Typography variant="body2">{l}</Typography></li>)}</Box>
                  </Stack>
                </AccordionDetails>
              </Accordion>
            </Box>
          </Stack>
        )}
      </Container>
    </Box>
  );
}
