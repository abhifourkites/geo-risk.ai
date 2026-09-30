/** The CPO sentence and the three answer cards, in plain words, from the numbers the API returns.
 *  The backend's `sentence` field says the same with the same numbers; this one uses the screen's words
 *  (full country names, "your suppliers' workers", "disaster area"). */
import type { CountryShare, HazardSite, OwnerShare, View } from "./api";
import { countryName, pct, plural, threshold } from "./format";

export type SummaryInput = Pick<View, "coverage" | "countries" | "owners" | "hazards">;

export const basisWords = (v: Pick<View, "coverage">) =>
  v.coverage.basis === "workers" ? "your suppliers' workers" : "your sites";

/** The disasters that contain at least one of the company's sites, largest first. */
export function disasterEvents(sites: HazardSite[]) {
  const m = new Map<string, { event_id: string; name: string; alert_level: string; level: string | null; sites: Set<string> }>();
  for (const h of sites) {
    const e = m.get(h.event_id) ?? { event_id: h.event_id, name: h.event_name, alert_level: h.alert_level, level: h.level, sites: new Set() };
    e.sites.add(h.os_id);
    m.set(h.event_id, e);
  }
  return [...m.values()].sort((a, b) => b.sites.size - a.sites.size || a.name.localeCompare(b.name));
}

export function plainSentence(v: SummaryInput): string {
  const cov = v.coverage;
  const high = v.countries.filter((c) => c.level === "High").map((c) => countryName(c.country_code));
  const nWatch = v.countries.filter((c) => c.level === "Watch").length;
  const lead = high.length ? `${plural(high.length, "country", "countries")} at High (${high.join(", ")})` : "No countries at High";
  const basis = cov.basis === "workers" ? "your suppliers' workers"
    : `sites (workers known for ${cov.workers_known.known} of ${cov.open_sites})`;
  const parts = [`${lead} and ${nWatch} at Watch, by share of ${basis}`];
  const { at_high: oh, at_watch: ow } = v.owners;
  if (oh || ow) {
    parts.push([oh ? `${plural(oh, "owner company", "owner companies")} at High` : "",
                ow ? (oh ? `${ow} at Watch` : `${plural(ow, "owner company", "owner companies")} at Watch`) : ""]
      .filter(Boolean).join(" and "));
  } else {
    parts.push(`owner known for ${cov.owner_known.known} of ${cov.open_sites} sites`);
  }
  const st = v.hazards.status.state;
  if (st !== "ok") {
    parts.push(st === "unavailable" ? "disaster data unavailable" : "checking for current disasters");
  } else {
    const inside = new Set(v.hazards.sites.map((s) => s.os_id));
    if (inside.size) {
      const levels = ["Red", "Orange", "Green"].filter((l) => v.hazards.sites.some((s) => s.alert_level === l));
      parts.push(`${inside.size} of your sites ${inside.size === 1 ? "is" : "are"} inside current disaster areas (alert: ${levels.join(", ")})`);
    } else {
      parts.push("none of your sites is inside a current disaster area");
    }
  }
  return parts.join("; ") + ".";
}

export interface CardItem { key: string; label: string; value: string; level: string | null }
export interface Card { headline: string; items: CardItem[]; more: string | null; note: string }

export function countriesCard(v: SummaryInput, high: number, watch: number): Card {
  const item = (c: CountryShare): CardItem => ({ key: c.country_code ?? "?", label: countryName(c.country_code), value: pct(c.share), level: c.level });
  const atHigh = v.countries.filter((c) => c.level === "High");
  const atWatch = v.countries.filter((c) => c.level === "Watch");
  const headline = atHigh.length
    ? `${plural(atHigh.length, "country holds", "countries hold")} ${threshold(high)} or more`
    : `No country holds ${threshold(high)} or more`;
  const more = atWatch.length
    ? `${atWatch.length === 1 ? "1 more holds" : `${atWatch.length} more hold`} ${threshold(watch)} or more: ${atWatch.map((c) => `${countryName(c.country_code)} ${pct(c.share)}`).join(", ")}`
    : atHigh.length ? null : `Largest: ${v.countries[0] ? `${countryName(v.countries[0].country_code)} ${pct(v.countries[0].share)}` : "none"}`;
  return { headline, items: atHigh.map(item), more, note: `Share of ${basisWords(v)}` };
}

export function ownersCard(v: SummaryInput, watch: number): Card {
  const all = v.owners.all ?? v.owners.top;
  const flagged = all.filter((o) => o.level);
  const item = (o: OwnerShare): CardItem => ({ key: o.owner, label: o.owner, value: pct(o.share), level: o.level });
  const shown = flagged.slice(0, 5);
  const headline = flagged.length
    ? `${plural(flagged.length, "owner holds", "owners hold")} ${threshold(watch)} or more`
    : `No owner holds ${threshold(watch)} or more`;
  const largest = all[0];
  const more = flagged.length > shown.length ? `and ${flagged.length - shown.length} more`
    : !flagged.length && largest ? `Largest: ${largest.owner}, ${plural(largest.sites, "site", "sites")} (${pct(largest.share)})` : null;
  const k = v.owners.owner_known;
  return { headline, items: shown.map(item), more, note: `Owner known for ${k.known} of ${k.of} sites` };
}

export function disastersCard(v: SummaryInput): Card {
  const st = v.hazards.status.state;
  const note = "Disaster data: GDACS, automatic alerts";
  if (st === "loading") return { headline: "Checking for current disasters…", items: [], more: null, note };
  if (st === "unavailable") return { headline: "Disaster data unavailable", items: [], more: null, note };
  const events = disasterEvents(v.hazards.sites);
  const inside = new Set(v.hazards.sites.map((s) => s.os_id)).size;
  const headline = inside
    ? `${inside} of your sites ${inside === 1 ? "is" : "are"} inside ${plural(events.length, "current disaster area", "current disaster areas")}`
    : "None of your sites is inside a current disaster area";
  return {
    headline, more: null, note,
    items: events.map((e) => ({ key: e.event_id, label: e.name, value: plural(e.sites.size, "site", "sites"), level: `alert: ${e.alert_level}` })),
  };
}
