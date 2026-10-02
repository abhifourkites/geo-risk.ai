/** Nodes and edges of the Company network graph for one candidate (React Flow, @xyflow/react).
 *  Company -> its sites (-> their owner) -> the GLEIF company: a dashed "candidate (not confirmed)" line,
 *  solid once confirmed, none once rejected. The GLEIF company's parents only when confirmed. A site whose link
 *  has yes and no from two candidates is marked "conflicting verdicts - needs review" and is not confirmed.
 *  Three columns: companies, sites, then (owner,) GLEIF company and parents one below the other. */
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { NetworkGraph } from "./api";
import { countryName, plural } from "./format";

export type Tone = "company" | "osh" | "gleif" | "parent" | "rejected" | "more" | "conflict";
export const CONFLICT = "conflicting verdicts – needs review";
export type InfoData = { caption?: string; title: string; detail?: string; tone: Tone; oneLine?: boolean };
export type HeaderData = { title: string };
export type GraphNode = Node<InfoData, "info"> | Node<HeaderData, "header">;

export const NODE_W = 184;
export const ROW = 54;                       // one site row (sites are one-line boxes)
const GAP = 40, LABEL_GAP = 150, GROUP = 76, BELOW = 108;   // LABEL_GAP: room for the candidate line's label
const LINE = "#5D6B70", CONFIRMED = "#1F3A5F";
const PARENT_LABEL: Record<string, string> = { direct: "direct parent", top: "top parent", branch: "branch of" };
const PARENT_CAPTION: Record<string, string> = { direct: "GLEIF · direct parent", top: "GLEIF · top parent", branch: "GLEIF · head office" };

const arrow = (color: string) => ({ type: MarkerType.ArrowClosed, color, width: 16, height: 16 });
const centred = (n: number, i: number, mid: number, gap: number) => mid + (i - (n - 1) / 2) * gap;

export function buildGraph(g: NetworkGraph): { nodes: GraphNode[]; edges: Edge[] } {
  const c = g.candidate;
  const nodes: GraphNode[] = [];
  const edges: Edge[] = [];
  const owner = c.kind === "owner";
  const rows = g.sites.length + (g.more_sites ? 1 : 0);
  const mid = (Math.max(rows, 1) - 1) * ROW / 2;
  const x = { company: 0, sites: NODE_W + GAP, right: 2 * NODE_W + GAP + LABEL_GAP };

  const info = (id: string, col: number, y: number, data: InfoData) =>
    nodes.push({ id, type: "info", position: { x: col, y }, data, draggable: false, selectable: false, width: NODE_W });
  const line = (id: string, source: string, target: string, o: Partial<Edge> = {}) =>
    edges.push({ id, source, target, sourceHandle: "r", targetHandle: "l", style: { stroke: LINE, strokeWidth: 1.25 }, markerEnd: arrow(LINE), ...o });

  g.companies.forEach((co, i) =>
    info(`company:${co.customer_id}`, x.company, centred(g.companies.length, i, mid, GROUP), { caption: "Company", title: co.name, tone: "company" }));
  g.sites.forEach((s, i) => {
    info(`site:${s.os_id}`, x.sites, i * ROW, s.conflict
      ? { title: s.name, detail: `${countryName(s.country_code)} · in conflict`, tone: "conflict", oneLine: true }
      : { title: s.name, detail: countryName(s.country_code), tone: "osh", oneLine: true });
    s.companies.forEach((cid) => line(`has:${cid}:${s.os_id}`, `company:${cid}`, `site:${s.os_id}`));
  });
  if (g.more_sites) info("more", x.sites, g.sites.length * ROW, { title: `+${g.more_sites} more ${g.more_sites === 1 ? "site" : "sites"}`, tone: "more", oneLine: true });
  let y = mid;                                // the right column, top to bottom
  if (owner) {
    y -= BELOW / 2;
    g.owners.forEach((o, i) => {
      info(`owner:${o}`, x.right, y + i * GROUP,
           { caption: "Open Supply Hub · owner", title: o, detail: g.owners.length === 1 ? plural(c.sites, "site", "sites") : undefined, tone: "osh" });
      g.sites.filter((s) => s.owners.includes(o)).forEach((s) => line(`owns:${s.os_id}:${o}`, `site:${s.os_id}`, `owner:${o}`));
    });
    y += (g.owners.length - 1) * GROUP + BELOW;
  }

  const rejected = c.verdict === "no", confirmed = c.verdict === "yes" && c.confirmed_sites > 0;   // yes, and not every link in conflict
  info("gleif", x.right, y, {
    caption: rejected ? "GLEIF · rejected" : "GLEIF", title: c.gleif_legal_name,
    detail: `LEI ${c.lei} · ${countryName(c.gleif_country || null)}`, tone: rejected ? "rejected" : "gleif",
  });
  if (!rejected) {
    const from = owner ? g.owners.map((o) => `owner:${o}`) : g.sites.map((s) => `site:${s.os_id}`);
    from.forEach((source, i) => line(`candidate:${source}`, source, "gleif", {
      ...(owner ? { sourceHandle: "b", targetHandle: "t" } : {}),
      label: i > 0 ? undefined : c.conflict_sites && c.verdict === "yes"
        ? (confirmed ? `confirmed; ${plural(c.conflict_sites, "site", "sites")} in conflict` : CONFLICT)
        : confirmed ? "confirmed" : "candidate (not confirmed)",
      style: confirmed ? { stroke: CONFIRMED, strokeWidth: 2.25 } : { stroke: LINE, strokeWidth: 1.5, strokeDasharray: "6 5" },
      markerEnd: arrow(confirmed ? CONFIRMED : LINE),
    }));
  }

  if (confirmed) {      // the backend sends parents only for a confirmed candidate; checked here too
    const by = Object.fromEntries(g.parents.map((p) => [p.type, p]));
    const parent = (id: string, y: number, type: string, p: NetworkGraph["parents"][number], caption = PARENT_CAPTION[type]) =>
      info(id, x.right, y, { caption, title: p.parent_name ?? `LEI ${p.parent_lei}`, detail: `LEI ${p.parent_lei}`, tone: "parent" });
    const down = (id: string, source: string, target: string, label: string) =>
      line(id, source, target, { sourceHandle: "b", targetHandle: "t", label });
    let last = "gleif";
    if (by.direct && by.top && by.direct.parent_lei === by.top.parent_lei) {
      parent("parent:direct", (y += BELOW), "direct", by.direct, "GLEIF · direct and top parent");
      down("to:direct", last, "parent:direct", "direct and top parent");
      last = "parent:direct";
    } else {
      if (by.direct) { parent("parent:direct", (y += BELOW), "direct", by.direct); down("to:direct", last, "parent:direct", PARENT_LABEL.direct); last = "parent:direct"; }
      if (by.top) { parent("parent:top", (y += BELOW), "top", by.top); down("to:top", last, "parent:top", PARENT_LABEL.top); last = "parent:top"; }
    }
    if (by.branch) { parent("parent:branch", (y += BELOW), "branch", by.branch); down("to:branch", "gleif", "parent:branch", PARENT_LABEL.branch); }
  }

  const top = Math.min(0, ...nodes.map((n) => n.position.y)) - 56;
  const header = (id: string, col: number, title: string) =>
    nodes.push({ id, type: "header", position: { x: col, y: top }, data: { title }, draggable: false, selectable: false, width: NODE_W });
  header("h:company", x.company, "Your company");
  header("h:osh", x.sites, "Open Supply Hub: sites");
  header("h:gleif", x.right, owner ? "Open Supply Hub owner, GLEIF" : "GLEIF");
  return { nodes, edges };
}
