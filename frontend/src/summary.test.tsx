import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AnswerCards from "./Cards";
import type { OwnerShare } from "./api";
import { plainSentence, type SummaryInput } from "./summary";

// adidas, as GET /api/customers/adidas/view returned it on 30 Sep 2026: only the fields the cards read.
// The disaster sites are the 5 sites in flood FL1104183 on that day (live data; not read from GDACS here).
const owner = (o: Partial<OwnerShare> & Pick<OwnerShare, "owner" | "share" | "sites" | "level" | "countries">): OwnerShare =>
  ({ all_in_one_country: false, country: null, ...o });
const flood = (os_id: string) => ({ os_id, name: os_id, country_code: "TR", event_id: "FL1104183", event_name: "Flood in Türkiye", alert_level: "Green", level: "Watch" as const });
const owners = [
  owner({ owner: "POU CHEN", share: 0.07377476745412266, sites: 9, level: "Watch", countries: 4 }),
  owner({ owner: "THE LOOK MACAO COMMERCIAL OFFSHORE", share: 0.058520507117175206, sites: 6, level: "Watch", countries: 2 }),
  owner({ owner: "HWASEUNG INDUSTRIES", share: 0.049030598067482375, sites: 10, level: null, countries: 3 }),
];
const adidas: SummaryInput = {
  coverage: { open_sites: 766, basis: "workers", workers_known: { known: 719, of: 766 }, owner_known: { known: 552, of: 766 }, location_known: { known: 766, of: 766 } },
  countries: [
    { country_code: "VN", share: 0.3152278581404079, sites: 157, workers_known: 149, level: "High" },
    { country_code: "ID", share: 0.1947850915083711, sites: 52, workers_known: 49, level: "High" },
    { country_code: "CN", share: 0.12846939359363146, sites: 203, workers_known: 189, level: "High" },
    { country_code: "PK", share: 0.08373062780523338, sites: 24, workers_known: 23, level: "Watch" },
    { country_code: "KH", share: 0.08248620940662282, sites: 28, workers_known: 27, level: "Watch" },
    { country_code: "IN", share: 0.05033274721654394, sites: 40, workers_known: 35, level: "Watch" },
    { country_code: "TH", share: 0.025252199990609132, sites: 23, workers_known: 23, level: null },
  ],
  owners: { top: owners, all: owners, at_high: 0, at_watch: 2, all_in_one_country: { count: 56, of_owners_with_2_plus_sites: 157 }, owner_known: { known: 552, of: 766 } },
  hazards: {
    status: { state: "ok", at: "2026-09-30T10:10:43", current_events: 251, areas: 404, error: null, repeated_rows: 24, repeated_by_type: { WF: 24 } },
    sites: ["TR201909837HW3X", "TR2019143NPNDKT", "TR2020029DMMXKT", "TR2020148B6AVBR", "TR202516839FJHW"].map(flood),
    areas: { type: "FeatureCollection", features: [] },
  },
};

/** The text a reader sees, one space between elements. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const cards = (v: SummaryInput) =>
  [...renderToStaticMarkup(<AnswerCards view={v} high={10} watch={5} active={null} onOpen={() => {}} />)
    .matchAll(/<button[^>]*class="card"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => text(m[1]));

describe("answer cards, adidas", () => {
  const [countries, ownersCard, disasters] = cards(adidas);

  it("renders three cards", () => {
    expect(cards(adidas)).toHaveLength(3);
  });
  it("countries: 3 countries hold 10% or more: Vietnam 31.5%, Indonesia 19.5%, China 12.8%", () => {
    expect(countries).toContain("3 countries hold 10% or more");
    for (const s of ["Vietnam 31.5%", "Indonesia 19.5%", "China 12.8%"]) expect(countries).toContain(s);
  });
  it("owners: 2 owners hold 5% or more: POU CHEN 7.4%, THE LOOK MACAO COMMERCIAL OFFSHORE 5.9%", () => {
    expect(ownersCard).toContain("2 owners hold 5% or more");
    for (const s of ["POU CHEN 7.4%", "THE LOOK MACAO COMMERCIAL OFFSHORE 5.9%"]) expect(ownersCard).toContain(s);
    expect(ownersCard).not.toContain("HWASEUNG");
  });
  it("disasters: 5 of your sites are inside 1 current disaster area: Flood in Türkiye", () => {
    expect(disasters).toContain("5 of your sites are inside 1 current disaster area");
    expect(disasters).toContain("Flood in Türkiye");
  });
});

describe("cards with nothing to report say so", () => {
  it("no owner at Watch, no site in a disaster area", () => {
    const quiet: SummaryInput = {
      ...adidas,
      owners: { ...adidas.owners, at_watch: 0, all: owners.map((o) => ({ ...o, level: null })), top: owners.map((o) => ({ ...o, level: null })) },
      hazards: { ...adidas.hazards, sites: [] },
    };
    const [, o, d] = cards(quiet);
    expect(o).toContain("No owner holds 5% or more");
    expect(o).toContain("Largest: POU CHEN, 9 sites (7.4%)");
    expect(d).toContain("None of your sites is inside a current disaster area");
  });
});

describe("the CPO sentence", () => {
  it("uses plain words and the same numbers as the backend sentence", () => {
    const backend = "3 countries at High (VN, ID, CN) and 3 at Watch by share of estimated workers; 2 owners at Watch; 5 open sites inside current GDACS Green areas.";
    const plain = plainSentence(adidas);
    expect(plain).toBe("3 countries at High (Vietnam, Indonesia, China) and 3 at Watch, by share of your suppliers' workers; "
      + "2 owner companies at Watch; 5 of your sites are inside current disaster areas (alert: Green).");
    const numbers = (s: string) => s.match(/\d+(\.\d+)?/g);
    expect(numbers(plain)).toEqual(numbers(backend));
  });
});
