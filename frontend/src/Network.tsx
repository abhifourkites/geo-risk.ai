import "@xyflow/react/dist/style.css";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import LinearProgress from "@mui/material/LinearProgress";
import ListItemButton from "@mui/material/ListItemButton";
import MenuItem from "@mui/material/MenuItem";
import Pagination from "@mui/material/Pagination";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { Controls, Handle, Position, ReactFlow, type Node, type NodeProps, type NodeTypes } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Customer, type GleifJob, type NetworkCandidate, type NetworkGraph, type NetworkVerdict } from "./api";
import { countryName, plural } from "./format";
import { buildGraph, CONFLICT, NODE_W, ROW, type HeaderData, type InfoData, type Tone } from "./networkGraph";

const PAGE = 20;
const LEVELS: Record<string, string> = { "1": "1 likely", "2": "2 possible", "3": "3 unlikely" };
const NAME_FIELD = (f: string) => f === "LegalName" ? "legal name" : f.startsWith("Transliterated") ? "transliterated other name" : "other name";
const MATCH = (c: NetworkCandidate) => `${c.match_type === "exact" ? "exact" : "starts with"}, on the GLEIF ${NAME_FIELD(c.gleif_name_field)}`;
const TONE: Record<Tone, { bg: string; border: string; dashed?: boolean; fade?: boolean }> = {
  company: { bg: "#E8EDF3", border: "#1F3A5F" },
  osh: { bg: "#FFFFFF", border: "#B8C2C5" },
  more: { bg: "#F6F7F5", border: "#B8C2C5", dashed: true },
  gleif: { bg: "#FFFFFF", border: "#1F2A2E" },
  parent: { bg: "#F6F7F5", border: "#1F2A2E" },
  rejected: { bg: "#FFFFFF", border: "#B8C2C5", dashed: true, fade: true },
  conflict: { bg: "#FFFFFF", border: "#1F2A2E", dashed: true },
};
const HIDDEN = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0 };

function InfoNode({ data }: NodeProps<Node<InfoData, "info">>) {
  const t = TONE[data.tone];
  return (
    <Box sx={{ width: NODE_W, px: 1.25, py: 0.75, bgcolor: t.bg, border: `1.5px ${t.dashed ? "dashed" : "solid"} ${t.border}`, borderRadius: 1.5, opacity: t.fade ? 0.6 : 1 }}>
      <Handle type="target" position={Position.Left} id="l" style={HIDDEN} isConnectable={false} />
      <Handle type="target" position={Position.Top} id="t" style={HIDDEN} isConnectable={false} />
      {data.caption && <Typography component="div" sx={{ fontSize: 11, lineHeight: 1.3, color: "text.secondary" }}>{data.caption}</Typography>}
      <Typography component="div" title={data.title}
                  sx={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: data.oneLine ? 1 : data.tone === "parent" ? 3 : 2, WebkitBoxOrient: "vertical", wordBreak: "break-word" }}>
        {data.title}
      </Typography>
      {data.detail && <Typography component="div" sx={{ fontSize: 11.5, lineHeight: 1.3, color: "text.secondary" }}>{data.detail}</Typography>}
      <Handle type="source" position={Position.Right} id="r" style={HIDDEN} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} id="b" style={HIDDEN} isConnectable={false} />
    </Box>
  );
}
const HeaderNode = ({ data }: NodeProps<Node<HeaderData, "header">>) =>
  <Typography sx={{ width: NODE_W, fontSize: 12, fontWeight: 600, color: "text.secondary", textTransform: "uppercase", letterSpacing: 0.4 }}>{data.title}</Typography>;
const NODE_TYPES: NodeTypes = { info: InfoNode, header: HeaderNode };

function VerdictChip({ v }: { v: NetworkVerdict }) {
  if (v === "yes") return <Chip size="small" color="primary" label="Confirmed" />;
  if (v === "no") return <Chip size="small" variant="outlined" label="Rejected" />;
  return <Chip size="small" variant="outlined" label="Not decided" sx={{ borderStyle: "dashed", color: "text.secondary" }} />;
}

function Graph({ g }: { g: NetworkGraph }) {
  const { nodes, edges } = useMemo(() => buildGraph(g), [g]);
  const c = g.candidate;
  const rows = g.sites.length + (g.more_sites ? 1 : 0);
  const height = Math.min(760, Math.max(440, rows * ROW * 0.9 + 160));     // taller for many sites, so the text stays readable
  return (
    <>
      <Box sx={{ height, border: 1, borderColor: "divider", borderRadius: 2.5, bgcolor: "#FBFBFA" }} data-testid="network-graph">
        <ReactFlow key={`${c.id}:${c.verdict}`} nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} fitView fitViewOptions={{ padding: 0.08, maxZoom: 1.1 }}
                   nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} zoomOnScroll={false} preventScrolling={false}
                   minZoom={0.2} proOptions={{ hideAttribution: false }} aria-label="Company network graph">
          <Controls showInteractive={false} />
        </ReactFlow>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        Dashed line: a candidate, not confirmed. Solid line: confirmed by a person; then the GLEIF company's direct and top parents are shown,
        here and in the map's site panel. A rejected candidate has no line. A site with yes and no from two candidates
        (for example its two owner names) is "in conflict": "{CONFLICT}", and not confirmed.
        {g.more_sites > 0 && ` The first 15 of ${c.sites} sites are drawn.`}
      </Typography>
    </>
  );
}

/** The company's GLEIF API search: progress while it runs, why it stopped, or the button that starts it. */
function JobStatus({ job, empty, busy, onStart }: { job: GleifJob | null; empty: boolean; busy: boolean; onStart: () => void }) {
  if (!job?.eligible) return null;
  if (job.state === "queued" || job.state === "running") {
    const done = job.names_done ?? 0, total = job.names_total ?? 0;
    return (
      <Box data-testid="gleif-job" sx={{ maxWidth: 720 }}>
        <Typography variant="body2" role="status">
          Finding GLEIF candidates in the background: {done} of {plural(total, "owner name", "owner names")} searched.
          GLEIF allows 60 requests a minute, so the app sends at most one a second; names searched before come from the cache.
          You can keep using the app.
        </Typography>
        <LinearProgress variant="determinate" value={total ? (100 * done) / total : 0} sx={{ mt: 1 }} aria-label="GLEIF search progress" />
      </Box>
    );
  }
  if (job.state === "failed") return (
    <Alert severity="error" data-testid="gleif-job" action={<Button color="inherit" size="small" onClick={onStart} disabled={busy}>Try again</Button>}>
      The GLEIF search stopped after {job.names_done} of {job.names_total} owner names: {job.error}
    </Alert>
  );
  if (empty && job.state === "done") return (
    <Alert severity="info" data-testid="no-candidates">GLEIF returned no candidates for this company's {plural(job.names_total ?? 0, "owner name", "owner names")}.</Alert>
  );
  if (empty) return (
    <Alert severity="info" data-testid="no-candidates" action={
      <Button variant="contained" size="small" onClick={onStart} disabled={busy || job.names === 0} sx={{ whiteSpace: "nowrap" }}>
        Find GLEIF candidates, {job.minutes ? `about ${plural(job.minutes, "minute", "minutes")}` : "under a minute"}
      </Button>}>
      No GLEIF candidates for this company yet. The search asks GLEIF's API about each of its {plural(job.names, "owner name", "owner names")},
      at most one request a second. Every candidate then waits for a person's verdict.
    </Alert>
  );
  if (job.state === "done") return (
    <Typography variant="caption" color="text.secondary" component="p" data-testid="gleif-job">
      Candidates found by a GLEIF API search of {plural(job.names_total ?? 0, "owner name", "owner names")} ({job.requests} requests sent; the rest from the cache).
    </Typography>
  );
  return null;
}

/** Company network: how Open Supply Hub sites and owners are matched to GLEIF companies (brief 3.1), and
 *  confirm or reject a match here instead of in a CSV (brief 3.3). Saved verdicts (the GLEIF files) show from the start.
 *  Shows the candidates of the company chosen in the top selector. */
export default function Network({ company }: { company: Customer | undefined }) {
  const cid = company?.customer_id ?? "";
  const [loaded, setLoaded] = useState<{ cid: string; list: NetworkCandidate[] } | null>(null);
  const all = loaded?.cid === cid ? loaded.list : null;   // only the selected company's list, never the previous one's
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);
  const [graph, setGraph] = useState<NetworkGraph | null>(null);
  const [graphTick, setGraphTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<GleifJob | null>(null);
  const jobMark = useRef("");

  const shownCid = useRef(cid);                 // answers for a company no longer selected are dropped
  shownCid.current = cid;
  const loadAll = useCallback(() => api.networkCandidates(cid).then((list) => {
    if (shownCid.current !== cid) return;
    setLoaded({ cid, list });
    setSelected((s) => (s != null && list.some((x) => x.id === s) ? s : list[0]?.id ?? null));   // keep it if it is on this list
  }), [cid]);
  useEffect(() => {
    if (!cid) return;
    setLoaded(null); setGraph(null); setError(null); setJob(null); jobMark.current = ""; setQuery(""); setLevel("");
    loadAll().catch((e) => setError(String((e as Error).message)));
  }, [cid, loadAll]);

  // the GLEIF API search: polled while it runs; the list is reloaded as it goes on and when it ends
  const loadJob = useCallback(() => api.networkJob(cid).then((j) => { if (shownCid.current === cid) setJob(j); }), [cid]);
  useEffect(() => { if (cid) loadJob().catch(() => {}); }, [cid, loadJob]);
  const running = job?.state === "queued" || job?.state === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { loadJob().catch(() => {}); }, 3000);
    return () => clearInterval(t);
  }, [running, loadJob]);
  useEffect(() => {
    if (!job) return;
    const mark = `${job.state}:${Math.floor((job.names_done ?? 0) / 10)}`;
    if (jobMark.current && mark !== jobMark.current) loadAll().catch(() => {});
    jobMark.current = mark;
  }, [job, loadAll]);
  async function startJob() {
    setBusy(true); setError(null);
    try { setJob(await api.startNetworkJob(cid)); }
    catch (e) { setError(String((e as Error).message)); }
    finally { setBusy(false); }
  }
  const current = all?.find((c) => c.id === selected) ?? null;
  const onList = current != null;               // a graph only for a candidate on this company's list
  useEffect(() => {
    if (selected == null || !onList) return;
    let live = true;
    api.networkCandidate(selected, cid).then((g) => { if (live) setGraph(g); }).catch((e) => setError(String((e as Error).message)));
    return () => { live = false; };
  }, [selected, cid, onList, current?.verdict, graphTick]);
  useEffect(() => {                              // a confirmed GLEIF API candidate: its parents are being fetched
    if (!graph?.parents_fetching) return;
    const t = setTimeout(() => setGraphTick((x) => x + 1), 2000);
    return () => clearTimeout(t);
  }, [graph]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (all ?? []).filter((c) => (!level || c.level === level)
      && (!q || [c.our_names, c.gleif_legal_name, c.gleif_matched_name, c.lei].some((s) => s.toLowerCase().includes(q))));
  }, [all, level, query]);
  useEffect(() => { setPage(1); }, [level, query, cid]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const rows = shown.slice((page - 1) * PAGE, page * PAGE);

  async function decide(c: NetworkCandidate, v: "yes" | "no" | null) {
    setBusy(true); setError(null);
    try { await api.setVerdict(c.id, v, cid); setSelected(c.id); await loadAll(); }
    catch (e) { setError(String((e as Error).message)); }
    finally { setBusy(false); }
  }

  if (error && !all) return <Alert severity="error">{error}</Alert>;
  if (!all || !company) return <Typography color="text.secondary">Loading…</Typography>;
  const count = (f: (c: NetworkCandidate) => boolean) => all.filter(f).length;
  const intro = (
    <>
      <Typography variant="h3" component="h2">Company network: {company.name}</Typography>
      <Typography variant="body2" sx={{ mt: 0.5, maxWidth: "95ch" }}>
        How Open Supply Hub sites and owner names are matched to GLEIF companies. A match is only a candidate until a person confirms it here;
        a confirmed match shows its GLEIF parent companies, here and in the map's site panel. Verdicts are saved and kept after a restart.
      </Typography>
    </>
  );
  if (!all.length) return (
    <Stack spacing={2} component="main">
      <Box>{intro}</Box>
      {error && <Alert severity="error">{error}</Alert>}
      {job ? (job.eligible ? <JobStatus job={job} empty busy={busy} onStart={startJob} />
        : <Alert severity="info" data-testid="no-candidates">No GLEIF candidates for this company.</Alert>)
        : <Typography color="text.secondary">Loading…</Typography>}
    </Stack>
  );

  return (
    <Stack spacing={2} component="main">
      <Box>
        {intro}
        <Stack direction="row" spacing={2} sx={{ mt: 1, alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
          <Typography variant="body2" color="text.secondary" role="status">
            {all.length} candidates for {company.name} {all.every((c) => c.source === "file") ? "from the GLEIF file" : "from GLEIF's API"}: {count((c) => c.level === "1")} likely, {count((c) => c.level === "2")} possible,
            {" "}{count((c) => c.level === "3")} unlikely. Confirmed {count((c) => c.verdict === "yes")}, rejected {count((c) => c.verdict === "no")},
            {" "}not decided {count((c) => !c.verdict)}.
            {count((c) => c.conflict_with.length > 0) > 0 && ` ${count((c) => c.conflict_with.length > 0)} with conflicting verdicts – needs review.`}
          </Typography>
          <Button size="small" variant="outlined" component="a" href={`/api/network/verdicts.csv?company=${encodeURIComponent(cid)}`} download>Download verdicts (CSV)</Button>
        </Stack>
        {job?.eligible && job.state && <Box sx={{ mt: 1 }}><JobStatus job={job} empty={false} busy={busy} onStart={startJob} /></Box>}
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      <Box sx={{ display: "grid", gridTemplateColumns: "minmax(0, 11fr) minmax(0, 10fr)", gap: 2, alignItems: "start" }}>
        <Card component="section" aria-label="Candidates">
          <CardContent sx={{ pb: 1 }}>
            <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", rowGap: 1.5 }}>
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel id="level-label">Review level</InputLabel>
                <Select labelId="level-label" label="Review level" value={level} onChange={(e) => setLevel(String(e.target.value))}>
                  <MenuItem value="">All levels</MenuItem>
                  {Object.entries(LEVELS).map(([k, l]) => <MenuItem key={k} value={k}>{l} ({count((c) => c.level === k)})</MenuItem>)}
                </Select>
              </FormControl>
              <TextField size="small" type="search" label="Search names or LEI" value={query} onChange={(e) => setQuery(e.target.value)} id="network-search" sx={{ flex: 1, minWidth: 180 }} />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Showing {shown.length ? `${(page - 1) * PAGE + 1}–${Math.min(page * PAGE, shown.length)} of ${shown.length}` : "0"} candidates.
            </Typography>
          </CardContent>
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, borderTop: 1, borderColor: "divider" }}>
            {rows.map((c) => (
              <Box component="li" key={c.id} sx={{ borderBottom: 1, borderColor: "divider", bgcolor: c.id === selected ? "action.selected" : undefined }}
                   data-testid={`candidate-${c.id}`}>
                <Box sx={{ display: "flex" }}>
                <ListItemButton selected={c.id === selected} onClick={() => setSelected(c.id)} aria-current={c.id === selected ? "true" : undefined}
                                sx={{ flexDirection: "column", alignItems: "flex-start", py: 1, minWidth: 0, "&.Mui-selected, &.Mui-selected:hover": { bgcolor: "transparent" } }}
                                aria-label={`Show the graph: ${c.names.join(" / ")} and ${c.gleif_legal_name}`}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {c.names.join(" / ")}
                    <Typography component="span" variant="body2" color="text.secondary" sx={{ fontWeight: 400 }}>
                      {" "}· {c.kind} · {plural(c.sites, "site", "sites")}{c.countries.length ? ` · ${c.countries.length > 3 ? plural(c.countries.length, "country", "countries") : c.countries.map((x) => countryName(x)).join(", ")}` : ""}
                    </Typography>
                  </Typography>
                  <Typography variant="body2">↔ {c.gleif_legal_name} <Typography component="span" variant="body2" color="text.secondary">({countryName(c.gleif_country || null)})</Typography></Typography>
                  <Typography variant="caption" color="text.secondary">
                    LEI {c.lei} · {MATCH(c)} · {LEVELS[c.level]}
                    {c.file_review_level && c.file_review_level[0] !== c.level && ` (file: ${LEVELS[c.file_review_level[0]]})`}
                    {c.flags ? ` · ${c.flags}` : ""}
                    {c.source === "api" && " · found by a GLEIF API search"}
                    {c.shared && <> · <Box component="span" sx={{ fontWeight: 600, color: "text.primary" }} data-testid="shared">One verdict for this GLEIF company; it also applies to other lists with the same {c.kind} name</Box></>}
                  </Typography>
                </ListItemButton>
                <Stack spacing={0.75} sx={{ justifyContent: "center", alignItems: "flex-end", px: 1.5, py: 1, flexShrink: 0 }}>
                  <VerdictChip v={c.verdict} />
                  <Stack direction="row" spacing={0.5}>
                    <Button size="small" variant="outlined" disabled={busy || c.verdict === "yes"} onClick={() => decide(c, "yes")}
                            aria-label={`Confirm: ${c.names.join(" / ")} is ${c.gleif_legal_name}`}>Confirm</Button>
                    <Button size="small" variant="outlined" disabled={busy || c.verdict === "no"} onClick={() => decide(c, "no")}
                            aria-label={`Reject: ${c.names.join(" / ")} is not ${c.gleif_legal_name}`}>Reject</Button>
                    <Button size="small" disabled={busy || c.verdict_from !== "page"} onClick={() => decide(c, null)}
                            aria-label={`Undo the verdict on ${c.names.join(" / ")} and ${c.gleif_legal_name}`}>Undo</Button>
                  </Stack>
                </Stack>
                </Box>
                {c.conflict_with.length > 0 && (
                  <Box sx={{ px: 2, pb: 1, display: "flex", gap: 1, alignItems: "baseline", flexWrap: "wrap" }} data-testid={`conflict-${c.id}`}>
                    <Chip size="small" variant="outlined" label={CONFLICT[0].toUpperCase() + CONFLICT.slice(1)} sx={{ borderStyle: "dashed", borderColor: "text.primary" }} />
                    <Typography variant="body2" color="text.secondary">
                      On {plural(c.conflict_sites, "site", "sites")}, the same LEI is {c.verdict === "yes" ? "rejected" : "confirmed"} by:
                    </Typography>
                    {c.conflict_with.map((j, k) => (     // on this company's list too: the conflict is on one of its sites
                      <Button key={j} size="small" sx={{ py: 0, minWidth: 0 }} onClick={() => setSelected(j)}>{c.conflict_with_names[k]}</Button>
                    ))}
                    <Typography variant="body2" color="text.secondary">Those sites show no parent until one verdict is changed.</Typography>
                  </Box>
                )}
              </Box>
            ))}
            {!rows.length && <Box component="li" sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">No candidate matches these filters.</Typography></Box>}
          </Box>
          {pages > 1 && <Pagination count={pages} page={page} onChange={(_, p) => setPage(p)} size="small" sx={{ p: 1.5, display: "flex", justifyContent: "center" }} />}
        </Card>
        <Card component="section" aria-label="Graph" sx={{ position: "sticky", top: 16 }}>
          <CardContent>
            {graph && graph.candidate.id === selected ? (
              <>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ flex: 1 }}>{graph.candidate.names.join(" / ")} ↔ {graph.candidate.gleif_legal_name}</Typography>
                  <VerdictChip v={graph.candidate.verdict} />
                </Stack>
                {graph.parents_fetching && <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }} role="status">
                  Confirmed: fetching its parent companies from GLEIF…</Typography>}
                <Graph g={graph} />
              </>
            ) : <Typography color="text.secondary">{selected != null ? "Loading the graph…" : "Pick a candidate to see its graph."}</Typography>}
          </CardContent>
        </Card>
      </Box>
    </Stack>
  );
}
