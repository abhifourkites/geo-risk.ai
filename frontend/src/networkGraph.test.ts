import { describe, expect, it } from "vitest";
import type { NetworkCandidate, NetworkGraph, NetworkSite } from "./api";
import { buildGraph } from "./networkGraph";

// GET /api/network/candidates/21 (PT. Paxar Indonesia), from the committed data on 2 Oct 2026
const paxar: NetworkCandidate = {
  id: 21, source: "file", kind: "site", our_names: "PT. Paxar Indonesia", names: ["PT. Paxar Indonesia"], companies: ["Nike"], company_ids: ["nike"],
  applies_to: ["Nike"], sites: 1, file_sites: 1,
  countries: ["ID"], review_level: "1 likely - confirm", level: "1", flags: "", match_type: "exact", gleif_name_field: "LegalName",
  gleif_matched_name: "PT PAXAR INDONESIA", lei: "549300YDGYNJ5OSNWF92", gleif_legal_name: "PT PAXAR INDONESIA", gleif_country: "ID",
  entity_status: "ACTIVE", registration_status: "ISSUED", verdict: null, verdict_from: null, decided_at: null,
  confirmed_sites: 0, conflict_sites: 0, conflict_with: [], conflict_with_names: [], file_review_level: "1 likely - confirm",
};
const AVERY = { parent_lei: "549300PW7VPFCYKLIV37", parent_name: "AVERY DENNISON CORPORATION" };
const graph = (verdict: NetworkCandidate["verdict"]): NetworkGraph => ({
  candidate: { ...paxar, verdict, verdict_from: verdict ? "page" : null, confirmed_sites: verdict === "yes" ? 1 : 0 },
  companies: [{ customer_id: "nike", name: "Nike" }],
  sites: [{ os_id: "ID2021182JC36SX", name: "PT. Paxar Indonesia", country_code: "ID", companies: ["nike"], owners: [], conflict: false }],
  more_sites: 0, owners: [], parents_fetching: false,
  parents: verdict === "yes" ? [{ type: "direct", ...AVERY }, { type: "top", ...AVERY }] : [],
});
const candidateEdges = (g: NetworkGraph) => buildGraph(g).edges.filter((e) => e.target === "gleif");
const titles = (g: NetworkGraph) => buildGraph(g).nodes.map((n) => `${n.id}: ${"caption" in n.data && n.data.caption ? `${n.data.caption} | ` : ""}${n.data.title}`);

describe("company network graph", () => {
  it("draws company -> site -> GLEIF company, dashed while not confirmed, with no parents", () => {
    const g = graph(null);
    expect(titles(g)).toEqual([
      "company:nike: Company | Nike",
      "site:ID2021182JC36SX: PT. Paxar Indonesia",
      "gleif: GLEIF | PT PAXAR INDONESIA",
      "h:company: Your company", "h:osh: Open Supply Hub: sites", "h:gleif: GLEIF",
    ]);
    const [e] = candidateEdges(g);
    expect([e.source, e.label, e.style?.strokeDasharray]).toEqual(["site:ID2021182JC36SX", "candidate (not confirmed)", "6 5"]);
  });

  it("after Confirm: a solid line, then the direct and top parent (one company here)", () => {
    const g = graph("yes");
    const [e] = candidateEdges(g);
    expect([e.label, e.style?.strokeDasharray]).toEqual(["confirmed", undefined]);
    const { nodes, edges } = buildGraph(g);
    const parent = nodes.find((n) => n.id === "parent:direct")!;
    expect(parent.data).toMatchObject({ caption: "GLEIF · direct and top parent", title: "AVERY DENNISON CORPORATION", detail: "LEI 549300PW7VPFCYKLIV37" });
    expect(edges.find((x) => x.target === "parent:direct")).toMatchObject({ source: "gleif", label: "direct and top parent" });
  });

  it("draws direct parent -> top parent when they differ", () => {
    const g = { ...graph("yes"), parents: [{ type: "direct", parent_lei: "D", parent_name: "Direct Co" }, { type: "top", parent_lei: "T", parent_name: null }] };
    const { nodes, edges } = buildGraph(g);
    expect(nodes.filter((n) => n.id.startsWith("parent:")).map((n) => "title" in n.data && n.data.title)).toEqual(["Direct Co", "LEI T"]);
    const fetched = buildGraph({ ...g, parents: [{ type: "direct", parent_lei: "D", parent_name: null, name_status: "not_available" }] }).nodes;
    expect(fetched.find((n) => n.id === "parent:direct")!.data).toMatchObject({ title: "name not available (LEI D)" });
    expect(edges.filter((x) => x.id.startsWith("to:")).map((x) => `${x.source} -> ${x.target}: ${x.label}`)).toEqual([
      "gleif -> parent:direct: direct parent", "parent:direct -> parent:top: top parent"]);
  });

  it("after Reject: no line to the GLEIF company, and no parents", () => {
    const g = { ...graph("no"), parents: [{ type: "direct", ...AVERY }] };   // parents are never drawn unless confirmed
    expect(candidateEdges(g)).toEqual([]);
    const { nodes } = buildGraph(g);
    expect(nodes.find((n) => n.id === "gleif")!.data).toMatchObject({ caption: "GLEIF · rejected", tone: "rejected" });
    expect(nodes.some((n) => n.id.startsWith("parent:"))).toBe(false);
  });

  it("yes and no from two candidates: the site is marked, and with every link in conflict nothing is confirmed", () => {
    const conflicted = (confirmed_sites: number): NetworkGraph => {
      const g = graph("yes");
      return { ...g, candidate: { ...g.candidate, confirmed_sites, conflict_sites: 1, conflict_with: [7] },
               sites: [{ ...g.sites[0], conflict: true }], parents: confirmed_sites ? g.parents : [] };
    };
    let g = conflicted(0);
    const { nodes } = buildGraph(g);
    expect(nodes.find((n) => n.id === "site:ID2021182JC36SX")!.data).toMatchObject({ tone: "conflict", detail: "Indonesia · in conflict" });
    let [e] = candidateEdges(g);
    expect([e.label, e.style?.strokeDasharray]).toEqual(["conflicting verdicts – needs review", "6 5"]);
    expect(nodes.some((n) => n.id.startsWith("parent:"))).toBe(false);
    g = { ...conflicted(1), candidate: { ...conflicted(1).candidate, sites: 2 } };    // one of two sites in conflict
    [e] = candidateEdges(g);
    expect([e.label, e.style?.strokeDasharray]).toEqual(["confirmed; 1 site in conflict", undefined]);
  });

  it("an owner: sites -> owner -> GLEIF company; at most 15 site nodes, then +N more", () => {
    // AVERY DENNISON (owner, adidas and Nike): 17 sites, as GET /api/network/candidates/31 returns them (2 more not sent)
    const site = (i: number): NetworkSite => ({ os_id: `S${i}`, name: `Site ${i}`, country_code: "BD", companies: ["adidas"], owners: ["AVERY DENNISON"], conflict: false });
    const g: NetworkGraph = {
      candidate: { ...paxar, id: 31, kind: "owner", our_names: "AVERY DENNISON", names: ["AVERY DENNISON"], companies: ["adidas", "Nike"], sites: 17,
                   lei: "2138004WKONVOSRTU954", gleif_legal_name: "AVERY DENNISON SMARTRAC LATAM LTDA" },
      companies: [{ customer_id: "adidas", name: "adidas" }, { customer_id: "nike", name: "Nike" }],
      sites: Array.from({ length: 15 }, (_, i) => site(i)), more_sites: 2, owners: ["AVERY DENNISON"], parents: [], parents_fetching: false,
    };
    const { nodes, edges } = buildGraph(g);
    expect(nodes.filter((n) => n.id.startsWith("site:"))).toHaveLength(15);
    expect(nodes.find((n) => n.id === "more")!.data).toMatchObject({ title: "+2 more sites" });
    expect(nodes.find((n) => n.id === "owner:AVERY DENNISON")!.data).toMatchObject({ caption: "Open Supply Hub · owner", detail: "17 sites" });
    expect(edges.filter((e) => e.target === "owner:AVERY DENNISON")).toHaveLength(15);
    expect(candidateEdges(g).map((e) => [e.source, e.sourceHandle, e.targetHandle])).toEqual([["owner:AVERY DENNISON", "b", "t"]]);   // owner above the GLEIF company
    expect(nodes.some((n) => n.id.startsWith("product") || n.id.startsWith("contact"))).toBe(false);
  });
});
