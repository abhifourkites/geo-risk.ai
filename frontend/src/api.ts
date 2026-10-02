import type { FeatureCollection } from "geojson";

export type Level = "High" | "Watch" | null;
export interface Known { known: number; of: number }
export interface Customer { customer_id: string; name: string; open_sites: number }
export interface Coverage {
  open_sites: number; basis: "workers" | "sites";
  workers_known: Known; owner_known: Known; location_known: Known;
}
export interface CountryShare { country_code: string | null; share: number; sites: number; workers_known: number; level: Level }
export interface OwnerShare {
  owner: string; share: number; sites: number; level: Level;
  all_in_one_country: boolean; country: string | null; countries: number;
}
export interface SiteDot {
  os_id: string; name: string; country_code: string | null; lng: number | null; lat: number | null;
  warnings: string[]; owners: string[]; hazard_level: Level;
}
export interface HazardSite { os_id: string; name: string; country_code: string | null; event_id: string; event_name: string; alert_level: string; level: Level }
export interface HazardStatus {
  state: "loading" | "ok" | "unavailable"; at: string | null; current_events: number | null; areas: number | null;
  error: string | null; repeated_rows: number | null; repeated_by_type: Record<string, number> | null;
}
export interface Owners {
  top: OwnerShare[]; all: OwnerShare[]; at_high: number; at_watch: number;
  all_in_one_country: { count: number; of_owners_with_2_plus_sites: number }; owner_known: Known;
}
export interface View {
  customer: { customer_id: string; name: string };
  thresholds: { high: number; watch: number };
  coverage: Coverage;
  sentence: string;
  countries: CountryShare[];
  lists: string[];
  owners: Owners;
  hazards: { status: HazardStatus; sites: HazardSite[]; areas: FeatureCollection };
  sites: SiteDot[];
}
export interface SiteDetail {
  site: { os_id: string; name: string; country_code: string | null; workers_est: number | null; list_names: string; warnings: string[] };
  owners: string[]; hazards: HazardSite[]; hazard_status: HazardStatus["state"];
  /** Events whose area holds the site, but which do not list its country as affected: not counted. */
  hazards_unlisted: HazardSite[];
  gleif: { candidates: number; confirmed: { lei: string; parents: { type: string; parent_lei: string; parent_name: string | null }[] }[] };
}
export interface OwnerDetail { owner: string; sites: { os_id: string; name: string; country_code: string | null }[]; countries: string[]; all_in_one_country: boolean }
/** A contributor of the uploaded file, for the upload page's pre-fill (backend/app/contributors.py). */
export interface Contributor { name: string; rows: number; share: number; lists: string[]; current_lists: string[] }
export interface UploadResult {
  upload_id: string; rows: number; lists: { list: string; sites: number }[];
  contributors: Contributor[]; preselect: string | null; hidden: string[];
}
export interface HazardDetail {
  event: { event_id: string; event_type: string; name: string; alert_level: string; level: Level; affected_countries: string[] };
  sites: (HazardSite & { owners: string[] })[];
  /** Inside the area, but in a country GDACS does not list as affected: not counted. */
  unlisted: HazardSite[];
  owners_other_sites: Record<string, { os_id: string; name: string; country_code: string | null }[]>;
}

/** Company network page (backend/app/network.py): one row of the GLEIF slice file. */
export type NetworkVerdict = "yes" | "no" | null;
export interface NetworkCandidate {
  id: number; source: "file" | "api"; kind: "owner" | "site"; our_names: string; names: string[];
  companies: string[]; company_ids: string[];
  /** Every company a verdict on this candidate applies to (one verdict per name and LEI). */
  applies_to: string[];
  sites: number; file_sites: number; countries: string[];
  review_level: string; level: "1" | "2" | "3"; flags: string; match_type: string; gleif_name_field: string; gleif_matched_name: string;
  lei: string; gleif_legal_name: string; gleif_country: string; entity_status: string; registration_status: string;
  verdict: NetworkVerdict; verdict_from: "page" | "file" | null; decided_at: string | null;
  /** Sites whose link to this LEI is confirmed / has yes and no from two candidates; the candidates giving the opposite verdict. */
  confirmed_sites: number; conflict_sites: number; conflict_with: number[]; conflict_with_names: string[];
}
export interface NetworkSite { os_id: string; name: string; country_code: string | null; companies: string[]; owners: string[]; conflict: boolean }
export interface NetworkGraph {
  candidate: NetworkCandidate;
  companies: { customer_id: string; name: string }[];
  sites: NetworkSite[]; more_sites: number; owners: string[];
  parents: { type: string; parent_lei: string; parent_name: string | null }[];
  /** A confirmed GLEIF API candidate whose parents are still being fetched (in the background). */
  parents_fetching: boolean;
}
/** A company's GLEIF API search (backend/app/gleif_api.py): one request a second, cached answers not sent again. */
export interface GleifJob {
  customer_id: string; eligible: boolean; state: "queued" | "running" | "done" | "failed" | null;
  names_total: number | null; names_done: number | null; requests: number | null; error: string | null;
  started_at: string | null; finished_at: string | null;
  names: number; to_search: number; minutes: number;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.detail ?? `${r.status} ${r.statusText}`);
  }
  return r.json() as Promise<T>;
}

const enc = encodeURIComponent;
export const api = {
  customers: () => call<Customer[]>("/api/customers"),
  view: (c: string, high: number, watch: number) => call<View>(`/api/customers/${enc(c)}/view?high=${high}&watch=${watch}`),
  site: (c: string, os: string) => call<SiteDetail>(`/api/customers/${enc(c)}/sites/${enc(os)}`),
  owner: (c: string, o: string) => call<OwnerDetail>(`/api/customers/${enc(c)}/owners/${enc(o)}`),
  hazard: (c: string, e: string) => call<HazardDetail>(`/api/customers/${enc(c)}/hazards/${enc(e)}`),
  refreshHazards: () => call<HazardStatus>("/api/hazards/refresh", { method: "POST" }),
  upload: (file: File) => {
    const f = new FormData(); f.append("file", file);
    return call<UploadResult>("/api/uploads", { method: "POST", body: f });
  },
  networkCandidates: (company: string) => call<NetworkCandidate[]>(`/api/network/candidates?company=${enc(company)}`),
  networkCandidate: (i: number) => call<NetworkGraph>(`/api/network/candidates/${i}`),
  networkJob: (c: string) => call<GleifJob>(`/api/network/jobs/${enc(c)}`),
  startNetworkJob: (c: string) => call<GleifJob>(`/api/network/jobs/${enc(c)}`, { method: "POST" }),
  setVerdict: (i: number, verdict: "yes" | "no" | null) => call<NetworkCandidate>(`/api/network/candidates/${i}/verdict`, verdict
    ? { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verdict }) }
    : { method: "DELETE" }),
  confirm: (id: string, body: { name: string; lists: string[]; current_lists: string[] }) =>
    call<{ customer_id: string; open_sites: number; gleif_matches: number; as_of: string }>(`/api/uploads/${enc(id)}/confirm`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
};
