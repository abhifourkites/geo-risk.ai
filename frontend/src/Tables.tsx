import { useState } from "react";
import type { View } from "./api";
import { countryName, pct, plural } from "./format";
import { basisWords } from "./summary";

const DEFAULT_OWNERS = 10;   // owners at High / Watch first; at least the 10 largest before "Show all owners"

function Level({ level }: { level: string | null }) {
  return level ? <span className={`badge ${level.toLowerCase()}`}>{level}</span> : <span className="muted">–</span>;
}

export function CountriesTable({ view, onCountry }: { view: View; onCountry: (code: string) => void }) {
  return (
    <section className="table-block">
      <h2>Countries</h2>
      <p className="small">Share of {basisWords(view)}, largest first.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">Country</th><th scope="col" className="num">Share</th><th scope="col">Level</th>
            <th scope="col" className="num">Sites</th><th scope="col" className="num">Workers known</th></tr></thead>
          <tbody>
            {view.countries.map((c) => (
              <tr key={c.country_code ?? "?"}>
                <td>{c.country_code ? <button type="button" className="link" onClick={() => onCountry(c.country_code!)}>{countryName(c.country_code)}</button> : countryName(null)}</td>
                <td className="num">{pct(c.share)}</td>
                <td><Level level={c.level} /></td>
                <td className="num">{c.sites}</td>
                <td className="num">{c.workers_known} of {c.sites}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function OwnersTable({ view, onOwner }: { view: View; onOwner: (o: string) => void }) {
  const [all, setAll] = useState(false);
  const owners = view.owners.all;
  const flagged = owners.filter((o) => o.level).length;
  const shown = all ? owners : owners.slice(0, Math.max(flagged, DEFAULT_OWNERS));
  return (
    <section className="table-block">
      <h2>Owner companies</h2>
      <p className="small">Share of {basisWords(view)}, largest first; owners at High or Watch are at the top.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">Owner</th><th scope="col" className="num">Share</th>
            <th scope="col" className="num">Sites</th><th scope="col">Countries</th></tr></thead>
          <tbody>
            {shown.map((o) => (
              <tr key={o.owner}>
                <td><button type="button" className="link" onClick={() => onOwner(o.owner)}>{o.owner}</button>{o.level && <> <Level level={o.level} /></>}</td>
                <td className="num">{pct(o.share)}</td>
                <td className="num">{o.sites}</td>
                <td>{o.countries === 1 ? countryName(o.country) : plural(o.countries, "country", "countries")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {owners.length > shown.length && (
        <button type="button" className="secondary" onClick={() => setAll(true)}>Show all owners ({owners.length})</button>
      )}
      {all && owners.length > Math.max(flagged, DEFAULT_OWNERS) && (
        <button type="button" className="secondary" onClick={() => setAll(false)}>Show fewer owners</button>
      )}
    </section>
  );
}
