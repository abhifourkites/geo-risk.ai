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
  event: { event_id: string; event_type: string; name: string; alert_level: string; level: Level };
  sites: (HazardSite & { owners: string[] })[];
  owners_other_sites: Record<string, { os_id: string; name: string; country_code: string | null }[]>;
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
  confirm: (id: string, body: { name: string; lists: string[]; current_lists: string[] }) =>
    call<{ customer_id: string; open_sites: number; gleif_matches: number; as_of: string }>(`/api/uploads/${enc(id)}/confirm`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
};
