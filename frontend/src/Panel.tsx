import type { ReactNode } from "react";
import type { CountryShare, HazardDetail, OwnerDetail, OwnerShare, SiteDetail, View } from "./api";
import type { CardKind } from "./Cards";
import { alertText, CERTIFICATE_WARNINGS, countryName, pct, plural, threshold, WARNINGS } from "./format";
import { basisWords, disasterEvents } from "./summary";

export type Detail =
  | { kind: "site"; data: SiteDetail }
  | { kind: "owner"; data: OwnerDetail }
  | { kind: "disaster"; data: HazardDetail }
  | { kind: "country"; code: string }
  | { kind: "card"; card: CardKind }
  | null;

interface Go { site: (os: string) => void; owner: (o: string) => void; disaster: (e: string) => void; country: (c: string) => void }
const PARENT_TYPE: Record<string, string> = { direct: "Direct parent", top: "Top parent", branch: "Branch of" };

function Level({ level }: { level: string | null }) {
  return level ? <span className={`badge ${level.toLowerCase()}`}>{level}</span> : null;
}
const Link = ({ onClick, children }: { onClick: () => void; children: ReactNode }) =>
  <button type="button" className="link" onClick={onClick}>{children}</button>;

function SitePanel({ d, go }: { d: SiteDetail; go: Go }) {
  const s = d.site;
  return (
    <>
      <p className="panel-kind">Site</p>
      <h2>{s.name}</h2>
      <p>{countryName(s.country_code)}</p>
      <h3>Owner companies</h3>
      {d.owners.length === 0 ? <p>Not reported.</p> : (
        <ul>{d.owners.map((o) => <li key={o}><Link onClick={() => go.owner(o)}>{o}</Link></li>)}</ul>
      )}
      <h3>Warnings</h3>
      {s.warnings.length === 0 ? <p>None.</p> : <ul>{s.warnings.map((w) => <li key={w}>{WARNINGS[w] ?? w}</li>)}</ul>}
      {s.warnings.some((w) => CERTIFICATE_WARNINGS.has(w)) && <p className="small">Certificate dates are checked against the day the list was loaded.</p>}
      <h3>Disaster area</h3>
      {d.hazard_status !== "ok" ? <p>{d.hazard_status === "loading" ? "Checking for current disasters…" : "Disaster data unavailable."}</p>
        : d.hazards.length === 0 ? <p>Not inside a current disaster area.</p>
        : <ul>{d.hazards.map((h) => <li key={h.event_id}><Link onClick={() => go.disaster(h.event_id)}>{h.event_name}</Link> <span className="small">({alertText(h.alert_level, h.level)})</span></li>)}</ul>}
      <h3>On your lists</h3>
      <ul>{s.list_names.split(" | ").map((l) => <li key={l}>{l}</li>)}</ul>
      <h3>Parent company</h3>
      {d.gleif.confirmed.length === 0 ? <p>No confirmed parent company.</p> : d.gleif.confirmed.map((m) => (
        m.parents.length === 0 ? <p key={m.lei}>Confirmed company (LEI {m.lei}); no parent company recorded in GLEIF.</p> : (
          <ul key={m.lei}>{m.parents.map((p) => <li key={p.type}>{PARENT_TYPE[p.type] ?? p.type}: {p.parent_name ?? `LEI ${p.parent_lei}`}</li>)}</ul>
        )))}
      <p className="small meta">Open Supply Hub ID {s.os_id}{s.workers_est != null ? ` · about ${s.workers_est} workers` : " · workers not reported"}</p>
    </>
  );
}

function OwnerPanel({ d, share, view, go }: { d: OwnerDetail; share: OwnerShare | undefined; view: View; go: Go }) {
  return (
    <>
      <p className="panel-kind">Owner company</p>
      <h2>{d.owner}</h2>
      {share && <p><span className="num">{pct(share.share)}</span> of {basisWords(view)} <Level level={share.level} /></p>}
      <p>{plural(d.sites.length, "site", "sites")} in {plural(d.countries.length, "country", "countries")}: {d.countries.map(countryName).join(", ")}.
        {" "}{d.sites.length < 2 ? "" : d.all_in_one_country ? "All in one country." : "Not all in one country."}</p>
      <p className="small">These sites are highlighted on the map.</p>
      <ul>{d.sites.map((s) => <li key={s.os_id}><Link onClick={() => go.site(s.os_id)}>{s.name}</Link> <span className="small">{countryName(s.country_code)}</span></li>)}</ul>
    </>
  );
}

function DisasterPanel({ d, go }: { d: HazardDetail; go: Go }) {
  const e = d.event;
  const others = Object.entries(d.owners_other_sites);
  return (
    <>
      <p className="panel-kind">Disaster area</p>
      <h2>{e.name}</h2>
      <p>Alert: <strong>{e.alert_level}</strong>{e.level ? <>, so your sites inside are at <Level level={e.level} /></> : null}</p>
      <p className="small">GDACS alerts are automatic, not reviewed by people. Confirm before acting.</p>
      {d.sites.length === 0 ? <p>None of your sites are inside this area.</p> : (
        <>
          <h3>Your sites inside ({d.sites.length})</h3>
          <ul>{d.sites.map((s) => (
            <li key={s.os_id}>
              <Link onClick={() => go.site(s.os_id)}>{s.name}</Link> <span className="small">{countryName(s.country_code)}</span>
              {s.owners.length > 0 && <div className="small">{s.owners.length === 1 ? "Owner" : "Owners"}: {s.owners.map((o, i) => <span key={o}>{i > 0 && ", "}<Link onClick={() => go.owner(o)}>{o}</Link></span>)}</div>}
            </li>
          ))}</ul>
          <h3>Those owners' other sites</h3>
          {others.length === 0 ? <p>None.</p> : others.map(([owner, sites]) => (
            <div key={owner} className="group">
              <p><Link onClick={() => go.owner(owner)}>{owner}</Link>: {plural(sites.length, "other site", "other sites")}</p>
              <ul>{sites.map((s) => <li key={s.os_id}><Link onClick={() => go.site(s.os_id)}>{s.name}</Link> <span className="small">{countryName(s.country_code)}</span></li>)}</ul>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function CountryPanel({ c, code, view, go }: { c: CountryShare | undefined; code: string; view: View; go: Go }) {
  const sites = view.sites.filter((s) => s.country_code === code).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <p className="panel-kind">Country</p>
      <h2>{countryName(code)}</h2>
      {!c ? <p>None of your sites are in this country.</p> : (
        <>
          <p><span className="num">{pct(c.share)}</span> of {basisWords(view)} <Level level={c.level} /></p>
          <p>{plural(c.sites, "site", "sites")}; workers known for {c.workers_known} of {c.sites}.</p>
          <p className="small">These sites are highlighted on the map.</p>
          <ul>{sites.map((s) => <li key={s.os_id}><Link onClick={() => go.site(s.os_id)}>{s.name}</Link></li>)}</ul>
        </>
      )}
    </>
  );
}

function CardPanel({ card, view, high, watch, go }: { card: CardKind; view: View; high: number; watch: number; go: Go }) {
  if (card === "countries") {
    const flagged = view.countries.filter((c) => c.level);
    return (
      <>
        <p className="panel-kind">Countries at High or Watch</p>
        <h2>Where you are most exposed</h2>
        <p className="small">High: {threshold(high)} or more of {basisWords(view)}. Watch: {threshold(watch)} or more. Outlined on the map.</p>
        {flagged.length === 0 ? <p>No country holds {threshold(watch)} or more.</p> : (
          <ul>{flagged.map((c) => <li key={c.country_code}><Link onClick={() => go.country(c.country_code!)}>{countryName(c.country_code)}</Link> <span className="num">{pct(c.share)}</span> <Level level={c.level} /></li>)}</ul>
        )}
      </>
    );
  }
  if (card === "owners") {
    const flagged = view.owners.all.filter((o) => o.level);
    return (
      <>
        <p className="panel-kind">Owner companies at High or Watch</p>
        <h2>Owners holding the biggest shares</h2>
        <p className="small">Their sites are highlighted on the map.</p>
        {flagged.length === 0 ? <p>No owner holds {threshold(watch)} or more. The largest is shown below.</p> : null}
        <ul>{(flagged.length ? flagged : view.owners.all.slice(0, 1)).map((o) => (
          <li key={o.owner}><Link onClick={() => go.owner(o.owner)}>{o.owner}</Link> <span className="num">{pct(o.share)}</span> <Level level={o.level} /> <span className="small">{plural(o.sites, "site", "sites")}</span></li>
        ))}</ul>
      </>
    );
  }
  const st = view.hazards.status.state;
  const events = disasterEvents(view.hazards.sites);
  return (
    <>
      <p className="panel-kind">Disasters now</p>
      <h2>Your sites inside a current disaster area</h2>
      {st !== "ok" ? <p>{st === "loading" ? "Checking for current disasters…" : "Disaster data unavailable."}</p>
        : events.length === 0 ? <p>None of your sites is inside a current disaster area.</p>
        : <ul>{events.map((e) => <li key={e.event_id}><Link onClick={() => go.disaster(e.event_id)}>{e.name}</Link> <span className="small">({alertText(e.alert_level, e.level)}): {plural(e.sites.size, "site", "sites")}</span></li>)}</ul>}
    </>
  );
}

export default function DetailPanel(props: { detail: Detail; view: View; high: number; watch: number; go: Go }) {
  const { detail, view, go } = props;
  return (
    <aside className="panel" aria-live="polite" aria-label="Details">
      {!detail && <p className="hint">Click a site, a country or a disaster area to see details.</p>}
      {detail?.kind === "site" && <SitePanel d={detail.data} go={go} />}
      {detail?.kind === "owner" && <OwnerPanel d={detail.data} share={view.owners.all.find((o) => o.owner === detail.data.owner)} view={view} go={go} />}
      {detail?.kind === "disaster" && <DisasterPanel d={detail.data} go={go} />}
      {detail?.kind === "country" && <CountryPanel c={view.countries.find((c) => c.country_code === detail.code)} code={detail.code} view={view} go={go} />}
      {detail?.kind === "card" && <CardPanel card={detail.card} view={view} high={props.high} watch={props.watch} go={go} />}
    </aside>
  );
}
