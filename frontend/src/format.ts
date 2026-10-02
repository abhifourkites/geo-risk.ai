/** Plain-words helpers shared by the screen. They only format numbers the API returns. */

const regionName = new Intl.DisplayNames(["en"], { type: "region" });

/** Full country name for an ISO code; the code itself if the name is not known. */
export function countryName(code: string | null): string {
  if (!code) return "Unknown country";
  try { return regionName.of(code) ?? code; } catch { return code; }
}

/** A share (0..1) as a percentage with one decimal, as everywhere on the screen. */
export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** A threshold percentage as typed (10 -> "10%", 7.5 -> "7.5%"). */
export const threshold = (x: number) => `${x}%`;

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The backend writes its refresh time as local time without an offset, and it runs in UTC
 *  (checked: /etc/localtime -> Etc/UTC, TZ unset). So "2026-09-30T10:10:43" is shown as
 *  "30 Sep 2026, 10:10 UTC", with no conversion. */
export function updatedAt(at: string | null): string | null {
  const m = at?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}, ${m[4]}:${m[5]} UTC`;
}

/** A GDACS event name, tidied: spaces collapsed, no trailing comma (GDACS writes "Drought in Austria, ..., Ukraine, "). */
export function eventName(name: string | null | undefined): string {
  return (name ?? "").replace(/\s+/g, " ").replace(/[\s,]+$/, "").trim();
}

/** For cards, lists and the map: at most the first 3 countries, then "and N more countries"
 *  ("Drought in Austria, Bosnia and Herzegovina, Belgium and 26 more countries"). The disaster's own panel shows eventName. */
export function shortEventName(name: string | null | undefined): string {
  const full = eventName(name);
  const m = full.match(/^(.*? in )(.*)$/);
  const places = m ? m[2].split(", ").filter(Boolean) : [];
  if (!m || places.length <= 3) return full;
  return `${m[1]}${places.slice(0, 3).join(", ")} and ${places.length - 3} more countries`;
}

/** A parent company's name; when it is not in our GLEIF files, it is fetched once from GLEIF's API. */
export function parentName(p: { parent_lei: string; parent_name: string | null; name_status?: string }): string {
  if (p.parent_name) return p.parent_name;
  if (p.name_status === "fetching") return `fetching the name from GLEIF… (LEI ${p.parent_lei})`;
  if (p.name_status === "not_available") return `name not available (LEI ${p.parent_lei})`;
  return `LEI ${p.parent_lei}`;
}

export const WARNINGS: Record<string, string> = {
  same_coordinates: "Same map point as another site in the file, so its location may be approximate",
  owner_conflict: "Two or more owner companies are reported for this site",
  wrap_expired: "WRAP certificate has expired",
  bsci_expired: "BSCI audit has expired",
  slcp_older_than_2y: "Last SLCP assessment is more than 2 years old",
};
export const CERTIFICATE_WARNINGS = new Set(["wrap_expired", "bsci_expired", "slcp_older_than_2y"]);

export const EVENT_TYPE: Record<string, string> = {
  TC: "tropical cyclones", FL: "floods", EQ: "earthquakes", VO: "volcanoes", DR: "droughts", WF: "wildfires",
};

/** The alert level in words, and what it means for the company's sites (rule R9). */
export const alertText = (alert: string, level: string | null) =>
  `alert: ${alert}${level ? `; ${level} for your sites` : ""}`;
