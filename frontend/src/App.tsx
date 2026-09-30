import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { Customer, View } from "./api";
import AnswerCards, { type CardKind } from "./Cards";
import { EVENT_TYPE, plural, threshold, updatedAt } from "./format";
import MapView from "./MapView";
import DetailPanel, { type Detail } from "./Panel";
import { plainSentence } from "./summary";
import { CountriesTable, OwnersTable } from "./Tables";
import Upload from "./Upload";

export default function App() {
  const [page, setPage] = useState<"map" | "upload">("map");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [c, setC] = useState<string>("");
  const [high, setHigh] = useState(10);
  const [watch, setWatch] = useState(5);
  const [view, setView] = useState<View | null>(null);
  const [detail, setDetail] = useState<Detail>(null);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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
  useEffect(() => { setDetail(null); }, [c]);

  // While the first GDACS check after a backend start is still running, look again every 5 seconds.
  useEffect(() => {
    if (view?.hazards.status.state !== "loading") return;
    const t = setTimeout(loadView, 5000);
    return () => clearTimeout(t);
  }, [view, loadView]);

  const show = async (p: Promise<Detail>) => {
    try { setDetail(await p); } catch (e) { setError(String((e as Error).message)); }
  };
  const go = {
    site: (os: string) => show(api.site(c, os).then((data) => ({ kind: "site", data }))),
    owner: (o: string) => show(api.owner(c, o).then((data) => ({ kind: "owner", data }))),
    disaster: (e: string) => show(api.hazard(c, e).then((data) => ({ kind: "disaster", data }))),
    country: (code: string) => setDetail({ kind: "country", code }),
  };
  const openCard = (card: CardKind) =>
    setDetail(detail?.kind === "card" && detail.card === card ? null : { kind: "card", card });

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

  async function refreshHazards() {
    setRefreshing(true);
    try { await api.refreshHazards(); await loadView(); }
    catch (e) { setError(String((e as Error).message)); }
    finally { setRefreshing(false); }
  }

  const hz = view?.hazards.status;
  const updated = hz?.state === "ok" ? `Disaster data updated ${updatedAt(hz.at) ?? hz.at}`
    : hz?.state === "unavailable" ? "Disaster data unavailable" : hz ? "Checking for current disasters…" : "";
  const repeats = Object.entries(hz?.repeated_by_type ?? {}).filter(([, n]) => n > 0);

  return (
    <div className="app">
      <header className="top">
        <h1>Supplier risk map</h1>
        <label className="company">Company{" "}
          <select value={c} onChange={(e) => { setC(e.target.value); setPage("map"); }}>
            {customers.map((x) => <option key={x.customer_id} value={x.customer_id}>{x.name}</option>)}
          </select>
        </label>
        <span className={`updated${hz?.state === "unavailable" ? " warn" : ""}`} role="status">{updated}</span>
        <div className="actions">
          <button type="button" onClick={refreshHazards} disabled={refreshing}>{refreshing ? "Checking…" : "Check for new disasters"}</button>
          {page === "map"
            ? <button type="button" className="secondary" onClick={() => setPage("upload")}>Upload</button>
            : <button type="button" className="secondary" onClick={() => setPage("map")}>Back to map</button>}
        </div>
      </header>

      {error && <p className="error" role="alert">{error}</p>}

      {page === "upload" && <Upload onDone={(id) => { loadCustomers(id).then(() => setPage("map")); }} />}

      {page === "map" && !view && !error && <p className="hint">Loading…</p>}

      {page === "map" && view && (
        <main>
          <section className="summary">
            <p className="small">{view.customer.name} · {plural(view.coverage.open_sites, "site", "sites")} on your current lists</p>
            <p className="sentence">{plainSentence(view)}</p>
          </section>

          <AnswerCards view={view} high={high} watch={watch} active={detail?.kind === "card" ? detail.card : null} onOpen={openCard} />

          <div className="workspace">
            <section className="map-col" aria-label="Map">
              <div className="map-bar">
                <label className="toggle"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all current disasters</label>
                <span className="small">Disaster data: GDACS, automatic alerts. Confirm before acting.</span>
              </div>
              <MapView view={view} showAll={showAll} high={high} watch={watch}
                       highlightSites={marks.sites} highlightCountries={marks.countries} selectedSite={marks.site} selectedEvent={marks.event}
                       onSite={go.site} onCountry={go.country} onDisaster={go.disaster} />
            </section>
            <DetailPanel detail={detail} view={view} high={high} watch={watch} go={go} />
          </div>

          <div className="tables">
            <CountriesTable view={view} onCountry={go.country} />
            <OwnersTable key={view.customer.customer_id} view={view} onOwner={go.owner} />
          </div>

          <details className="more">
            <summary>How these numbers are worked out</summary>
            <p><strong>Sites.</strong> Only sites on your current lists that are not closed are counted: {view.coverage.open_sites} for {view.customer.name}.</p>
            <p><strong>Share basis.</strong> Shares use {view.coverage.basis === "workers" ? "your suppliers' workers" : "site counts"}.
              Workers are used when they are known for at least 90% of sites.{" "}
              <span className="small">Workers known for {view.coverage.workers_known.known} of {view.coverage.open_sites} sites.</span></p>
            <p><strong>Coverage.</strong>{" "}
              <span className="small">Owner known for {view.coverage.owner_known.known} of {view.coverage.open_sites} sites.
              Location known for {view.coverage.location_known.known} of {view.coverage.open_sites} sites.</span></p>
            <div className="levels">
              <p><strong>Levels.</strong> A country or owner company is at High when it holds a set share or more, and at Watch
                at a lower share. A site inside a current disaster area is at High for an Orange or Red alert, and at Watch for a Green alert.</p>
              <label>High at <input type="number" min={0.1} max={100} step={0.5} value={high} onChange={(e) => setHigh(Number(e.target.value))} /> %</label>
              <label>Watch at <input type="number" min={0.1} max={100} step={0.5} value={watch} onChange={(e) => setWatch(Number(e.target.value))} /> %</label>
              <span className="small">Now: High {threshold(high)} or more, Watch {threshold(watch)} or more.</span>
            </div>
            <p><strong>Owner companies.</strong> A site with 2 or more owners counts in full under each owner.{" "}
              <span className="small">{view.owners.all_in_one_country.count} of {view.owners.all_in_one_country.of_owners_with_2_plus_sites} owners
              with 2 or more sites have all of them in one country.</span></p>
          </details>

          <details className="more">
            <summary>Source and limits of the data</summary>
            <p><strong>Disaster data:</strong> GDACS (Global Disaster Awareness and Coordination System). Alerts are automatic,
              not reviewed by people. Confirm before making decisions.</p>
            {repeats.length > 0 && (
              <p>GDACS's list of current disasters repeats some entries across its pages, so some may be missing from this map:{" "}
                {repeats.map(([t, n]) => `up to ${n} ${EVENT_TYPE[t] ?? t}`).join(", ")} at the last check.</p>
            )}
            <p><strong>Your lists</strong> (each name carries the list's date):</p>
            <ul>{view.lists.map((l) => <li key={l}>{l}</li>)}</ul>
          </details>
        </main>
      )}
    </div>
  );
}
