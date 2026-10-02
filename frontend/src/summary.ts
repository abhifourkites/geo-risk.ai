/** The three answer cards, in plain words, from the numbers the API returns.
 *  The one-sentence summary comes from the backend (`sentence` in the view). */
import type { CountryShare, HazardSite, OwnerShare, View } from "./api";
import { countryName, pct, plural, shortEventName, threshold } from "./format";

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
    items: events.map((e) => ({ key: e.event_id, label: shortEventName(e.name), value: plural(e.sites.size, "site", "sites"), level: `alert: ${e.alert_level}` })),
  };
}
