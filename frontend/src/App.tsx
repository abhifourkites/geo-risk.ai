import { useCallback, useEffect, useMemo, useState } from "react";
import { api, pct, WARNINGS } from "./api";
import type { Customer, HazardDetail, OwnerDetail, SiteDetail, View } from "./api";
import MapView, { HAZARD_FILL } from "./MapView";
import Upload from "./Upload";

type Panel =
  | { kind: "site"; data: SiteDetail }
  | { kind: "owner"; data: OwnerDetail }
  | { kind: "hazard"; data: HazardDetail }
  | null;

const regionName = new Intl.DisplayNames(["en"], { type: "region" });
const countryName = (code: string | null) => {
  if (!code) return "Unknown country";
  try { return `${regionName.of(code) ?? code} (${code})`; } catch { return code; }
};
const PARENT_TYPE: Record<string, string> = { direct: "Direct parent", top: "Top parent", branch: "Branch of" };

export default function App() {
  const [page, setPage] = useState<"map" | "upload">("map");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [c, setC] = useState<string>("");
  const [high, setHigh] = useState(10);
  const [watch, setWatch] = useState(5);
  const [view, setView] = useState<View | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
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
  useEffect(() => { setPanel(null); }, [c]);

  // Refresh the view while the first GDACS refresh (started when the backend starts) is still running.
  useEffect(() => {
    if (view?.hazards.status.state !== "loading") return;
    const t = setTimeout(loadView, 5000);
    return () => clearTimeout(t);
  }, [view, loadView]);

  const show = async (p: Promise<Panel>) => {
    try { setPanel(await p); } catch (e) { setError(String((e as Error).message)); }
  };
  const openSite = (os: string) => show(api.site(c, os).then((data) => ({ kind: "site", data })));
  const openOwner = (o: string) => show(api.owner(c, o).then((data) => ({ kind: "owner", data })));
  const openHazard = (e: string) => show(api.hazard(c, e).then((data) => ({ kind: "hazard", data })));

  const highlight = useMemo(() => {
    if (!panel) return new Set<string>();
    if (panel.kind === "site") return new Set([panel.data.site.os_id]);
    if (panel.kind === "owner") return new Set(panel.data.sites.map((s) => s.os_id));
    return new Set([...panel.data.sites.map((s) => s.os_id),
      ...Object.values(panel.data.owners_other_sites).flat().map((s) => s.os_id)]);
  }, [panel]);

  const events = useMemo(() => {
    const m = new Map<string, { event_id: string; name: string; alert_level: string; level: string | null; sites: number }>();
    for (const h of view?.hazards.sites ?? []) {
      const e = m.get(h.event_id) ?? { event_id: h.event_id, name: h.event_name, alert_level: h.alert_level, level: h.level, sites: 0 };
      e.sites += 1;
      m.set(h.event_id, e);
    }
    return [...m.values()];
  }, [view]);

  async function refreshHazards() {
    setRefreshing(true);
    try { await api.refreshHazards(); await loadView(); }
    catch (e) { setError(String((e as Error).message)); }
    finally { setRefreshing(false); }
  }

  const cov = view?.coverage;
  const hz = view?.hazards.status;

  return (
    <div className="app">
      <header>
        <h1>Supplier risk map</h1>
        <nav>
          <button className={page === "map" ? "tab on" : "tab"} onClick={() => setPage("map")}>Map</button>
          <button className={page === "upload" ? "tab on" : "tab"} onClick={() => setPage("upload")}>Upload a supplier list</button>
        </nav>
      </header>

      {error && <p className="error">{error}</p>}

      {page === "upload" && (
        <Upload onDone={(id) => { loadCustomers(id).then(() => setPage("map")); }} />
      )}

      {page === "map" && (
        <>
          <section className="controls">
            <label className="field">Company{" "}
              <select value={c} onChange={(e) => setC(e.target.value)}>
                {customers.map((x) => <option key={x.customer_id} value={x.customer_id}>{x.name} ({x.open_sites} open sites)</option>)}
              </select>
            </label>
            <label className="field">High at{" "}
              <input type="number" min={0.1} max={100} step={0.5} value={high} onChange={(e) => setHigh(Number(e.target.value))} />%
            </label>
            <label className="field">Watch at{" "}
              <input type="number" min={0.1} max={100} step={0.5} value={watch} onChange={(e) => setWatch(Number(e.target.value))} />%
            </label>
          </section>

          {view && cov && hz && (
            <>
              <section className="summary">
                <p className="sentence">{view.customer.name}: {view.sentence}</p>
                <p className="small">
                  <b>Share basis in use: {cov.basis === "workers" ? "estimated workers" : "site counts"}.</b>{" "}
                  Estimated workers known for {cov.workers_known.known} of {cov.open_sites} open sites
                  ({cov.basis === "workers" ? "at least" : "below"} the 90% needed to use workers).
                  Owner known for {cov.owner_known.known} of {cov.open_sites}. Location known for {cov.location_known.known} of {cov.open_sites}.
                </p>
              </section>

              <section className="notice">
                <b>Disaster data:</b> Global Disaster Awareness and Coordination System, GDACS. Alerts are automatic,
                not reviewed by people. Confirm them before making decisions.{" "}
                {hz.state === "ok" && <>Last refresh {hz.at}: {hz.current_events} current events, {hz.areas} affected areas.{" "}</>}
                {hz.state === "loading" && <b>Hazard data loading… </b>}
                {hz.state === "unavailable" && <b>Hazard data unavailable. </b>}
                <button onClick={refreshHazards} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh from GDACS"}</button>
              </section>

              <div className="main">
                <div className="left">
                  <MapView view={view} highlight={highlight} onSite={openSite} onHazard={openHazard} />
                  <p className="legend small">
                    <span className="key" style={{ background: "var(--high)" }} /> Country at High
                    <span className="key" style={{ background: "var(--watch)" }} /> Country at Watch
                    {Object.entries(HAZARD_FILL).map(([k, v]) => (
                      <span key={k}><span className="key" style={{ background: v, opacity: 0.6 }} /> GDACS {k} area </span>
                    ))}
                    <span><span className="dot" /> Site</span>
                    <span><span className="dot on" /> Selected</span>
                    <span>Click a dot or an area for details.</span>
                  </p>

                  <div className="tables">
                    <div>
                      <h3>Countries (share of {cov.basis === "workers" ? "estimated workers" : "sites"})</h3>
                      <div className="scroll">
                        <table>
                          <thead><tr><th>Country</th><th>Share</th><th>Level</th><th>Open sites</th><th>Workers known</th></tr></thead>
                          <tbody>
                            {view.countries.map((x) => (
                              <tr key={x.country_code ?? "?"}>
                                <td>{countryName(x.country_code)}</td><td>{pct(x.share)}</td>
                                <td className={x.level ?? ""}>{x.level ?? ""}</td><td>{x.sites}</td><td>{x.workers_known} of {x.sites}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div>
                      <h3>Owners (top 15)</h3>
                      <p className="small">
                        Owner known for {view.owners.owner_known.known} of {view.owners.owner_known.of} open sites.
                        At High: {view.owners.at_high}; at Watch: {view.owners.at_watch}.{" "}
                        {view.owners.all_in_one_country.count} of {view.owners.all_in_one_country.of_owners_with_2_plus_sites} owners
                        with 2 or more sites have all of them in one country. A site with 2 or more owners counts under each.
                      </p>
                      <div className="scroll">
                        <table>
                          <thead><tr><th>Owner</th><th>Share</th><th>Level</th><th>Sites</th><th>One country?</th></tr></thead>
                          <tbody>
                            {view.owners.top.map((o) => (
                              <tr key={o.owner}>
                                <td><button className="link" onClick={() => openOwner(o.owner)}>{o.owner}</button></td>
                                <td>{pct(o.share)}</td><td className={o.level ?? ""}>{o.level ?? ""}</td><td>{o.sites}</td>
                                <td>{o.all_in_one_country ? `Yes (${o.country})` : o.sites < 2 ? "1 site" : "No"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div>
                      <h3>Current disasters touching this company's sites</h3>
                      {hz.state !== "ok" ? <p>Hazard data {hz.state === "loading" ? "loading" : "unavailable"}.</p>
                        : events.length === 0 ? <p>No open sites inside a current GDACS affected area.</p>
                        : (
                          <ul>
                            {events.map((e) => (
                              <li key={e.event_id}>
                                <button className="link" onClick={() => openHazard(e.event_id)}>{e.name}</button>{" "}
                                (GDACS {e.alert_level}, {e.level}): {e.sites} {e.sites === 1 ? "site" : "sites"}
                              </li>
                            ))}
                          </ul>
                        )}
                    </div>
                  </div>
                </div>

                <aside className="panel">
                  {!panel && <p className="small">Click a site dot, an owner or a disaster to see details here.</p>}
                  {panel?.kind === "site" && <SitePanel d={panel.data} onOwner={openOwner} onHazard={openHazard} />}
                  {panel?.kind === "owner" && <OwnerPanel d={panel.data} onSite={openSite} />}
                  {panel?.kind === "hazard" && <HazardPanel d={panel.data} onSite={openSite} onOwner={openOwner} />}
                </aside>
              </div>
            </>
          )}

          <section className="notbuilt">
            <h3>Not built, and why</h3>
            <table>
              <thead><tr><th>Not built</th><th>Why</th></tr></thead>
              <tbody>
                <tr><td>Alternative suppliers</td><td>The data does not say what each site makes</td></tr>
                <tr><td>Single-source by material</td><td>No material data</td></tr>
                <tr><td>Supplier-to-supplier links</td><td>The data does not say which site supplies which</td></tr>
                <tr><td>Performance trends</td><td>No supplier performance data</td></tr>
                <tr><td>Per-company login</td><td>Demo only</td></tr>
              </tbody>
            </table>
            <p>All of these need the company's <b>own</b> supplier data: what each site makes, and which site it supplies.</p>
          </section>
        </>
      )}
    </div>
  );
}

function SitePanel({ d, onOwner, onHazard }: { d: SiteDetail; onOwner: (o: string) => void; onHazard: (e: string) => void }) {
  const s = d.site;
  const cert = s.warnings.some((w) => w !== "same_coordinates" && w !== "owner_conflict");
  return (
    <div>
      <h2>{s.name}</h2>
      <p className="small">{countryName(s.country_code)} · Open Supply Hub ID {s.os_id}</p>
      <p>Estimated workers: {s.workers_est ?? "not known"}</p>
      <p className="small">On list: {s.list_names}</p>
      <h3>Owners</h3>
      {d.owners.length === 0 ? <p>Owner not known.</p> : (
        <ul>{d.owners.map((o) => <li key={o}><button className="link" onClick={() => onOwner(o)}>{o}</button></li>)}</ul>
      )}
      <h3>Warnings</h3>
      {s.warnings.length === 0 ? <p>None.</p> : (
        <ul>{s.warnings.map((w) => <li key={w}>{WARNINGS[w] ?? w}</li>)}</ul>
      )}
      {cert && <p className="small">Certificate warnings are checked against the date the list was loaded.</p>}
      <h3>Disaster</h3>
      {d.hazard_status !== "ok" ? <p>Hazard data {d.hazard_status === "loading" ? "loading" : "unavailable"}.</p>
        : d.hazards.length === 0 ? <p>Not inside a current GDACS affected area.</p>
        : (
          <ul>{d.hazards.map((h) => (
            <li key={h.event_id}><button className="link" onClick={() => onHazard(h.event_id)}>{h.event_name}</button> (GDACS {h.alert_level}: {h.level})</li>
          ))}</ul>
        )}
      <h3>Parent company (GLEIF)</h3>
      {d.gleif.confirmed.length === 0 ? (
        <p>{d.gleif.candidates === 0 ? "No GLEIF name match."
          : `No confirmed GLEIF match. ${d.gleif.candidates} candidate ${d.gleif.candidates === 1 ? "match waits" : "matches wait"} for a person to confirm.`}</p>
      ) : d.gleif.confirmed.map((m) => (
        <div key={m.lei}>
          <p>Confirmed match: LEI {m.lei}</p>
          {m.parents.length === 0 ? <p>No parent company in GLEIF.</p> : (
            <ul>{m.parents.map((p) => <li key={p.type}>{PARENT_TYPE[p.type] ?? p.type}: {p.parent_name ?? `LEI ${p.parent_lei}`}</li>)}</ul>
          )}
        </div>
      ))}
    </div>
  );
}

function OwnerPanel({ d, onSite }: { d: OwnerDetail; onSite: (os: string) => void }) {
  return (
    <div>
      <h2>{d.owner}</h2>
      <p>{d.sites.length} {d.sites.length === 1 ? "site" : "sites"} of this company, in {d.countries.length}{" "}
        {d.countries.length === 1 ? "country" : "countries"}: {d.countries.join(", ")}. Highlighted on the map.</p>
      <p><b>All in one country: {d.sites.length < 2 ? "only 1 site" : d.all_in_one_country ? "yes" : "no"}.</b></p>
      <ul>{d.sites.map((s) => (
        <li key={s.os_id}><button className="link" onClick={() => onSite(s.os_id)}>{s.name}</button> ({s.country_code ?? "?"})</li>
      ))}</ul>
    </div>
  );
}

function HazardPanel({ d, onSite, onOwner }: { d: HazardDetail; onSite: (os: string) => void; onOwner: (o: string) => void }) {
  const e = d.event;
  const others = Object.entries(d.owners_other_sites);
  return (
    <div>
      <h2>{e.name}</h2>
      <p className="small">GDACS {e.event_id} · alert {e.alert_level} → {e.level ?? "no level"} · automatic, not reviewed by people</p>
      <h3>This company's sites inside the affected area</h3>
      {d.sites.length === 0 ? <p>None.</p> : (
        <ul>{d.sites.map((s) => (
          <li key={s.os_id}>
            <button className="link" onClick={() => onSite(s.os_id)}>{s.name}</button> ({s.country_code ?? "?"})
            {s.owners.length > 0 && <> · owners: {s.owners.map((o, i) => (
              <span key={o}>{i > 0 && ", "}<button className="link" onClick={() => onOwner(o)}>{o}</button></span>
            ))}</>}
          </li>
        ))}</ul>
      )}
      <h3>Those owners' other sites (highlighted)</h3>
      {others.length === 0 ? <p>None.</p> : others.map(([owner, sites]) => (
        <div key={owner}>
          <p><b>{owner}</b>: {sites.length} other {sites.length === 1 ? "site" : "sites"}</p>
          <ul>{sites.map((s) => (
            <li key={s.os_id}><button className="link" onClick={() => onSite(s.os_id)}>{s.name}</button> ({s.country_code ?? "?"})</li>
          ))}</ul>
        </div>
      ))}
    </div>
  );
}
