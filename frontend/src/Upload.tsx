import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";
import { api, type Contributor, type UploadResult } from "./api";
import { pct } from "./format";
import { prefill, visibleLists } from "./uploadLists";

/** Upload page: file in; the company is found (or picked from suggestions), its lists ticked and the current ones
 *  marked; the person checks the choices and loads. Nothing loads without "Load this company". */
export default function Upload(props: { onDone: (customer_id: string) => void }) {
  const [up, setUp] = useState<UploadResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<Contributor | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const hidden = useMemo(() => new Set(up?.hidden ?? []), [up]);
  const rows = useMemo(() => visibleLists(up?.lists ?? [], { query, showAll, hidden, picked, first: chosen?.lists ?? [] }),
                       [up, query, showAll, hidden, picked, chosen]);

  const toggle = (set: Set<string>, value: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    setter(next);
  };

  /** Tick and mark the company's current lists, and fill in its name (all can still be changed). */
  function choose(c: Contributor | null) {
    const p = prefill(c);
    setChosen(c); setPicked(p.picked); setCurrent(p.current); setName(p.name);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setMsg(null); setBusy(true); setFileName(file.name);
    try {
      const r = await api.upload(file);
      setUp(r); setQuery(""); setShowAll(false);
      choose(r.contributors.find((c) => c.name === r.preselect) ?? null);
    }
    catch (e) { setMsg({ ok: false, text: String((e as Error).message) }); }
    finally { setBusy(false); }
  }

  async function onConfirm() {
    if (!up) return;
    setBusy(true); setMsg(null);
    try {
      const lists = [...picked];
      const r = await api.confirm(up.upload_id, { name, lists, current_lists: lists.filter((l) => current.has(l)) });
      setMsg({ ok: true, text: `Loaded ${name}: ${r.open_sites} sites on current lists (as of ${r.as_of}).` });
      props.onDone(r.customer_id);
    } catch (e) { setMsg({ ok: false, text: String((e as Error).message) }); }
    finally { setBusy(false); }
  }

  return (
    <Card component="main" className="upload">
      <CardContent>
        <Typography variant="h3" component="h2">Upload a supplier list</Typography>
        <Box component="ol" sx={{ pl: 3, my: 1.5 }}>
          <li><Typography variant="body2">Choose an Open Supply Hub download (CSV). Personal contact columns (<code>claim_*</code>) are dropped.</Typography></li>
          <li><Typography variant="body2">The company is filled in: the one company on every row of the file, or the one you pick from the suggestions.
            Its lists with the latest year in their name are ticked and marked current; tick its other lists by hand if needed.</Typography></li>
          <li><Typography variant="body2">Check the lists and the name, change them if needed, and load. Only sites on a current list that are not closed are loaded.
            A new upload replaces only this company's data.</Typography></li>
        </Box>
        <Stack sx={{ alignItems: "center" }} direction="row" spacing={2}>
          <Button variant="outlined" component="label" disabled={busy}>
            Choose a file
            <input hidden type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
          </Button>
          <Typography variant="body2" color="text.secondary">{fileName || "No file chosen"}</Typography>
        </Stack>
        {up && (
          <>
            <Typography variant="body2" sx={{ mt: 2 }}>{up.rows} rows in the file, naming {up.lists.length} lists.</Typography>
            {up.preselect ? (
              <Alert severity="info" sx={{ mt: 1.5 }} data-testid="company-found">
                <strong>{up.preselect}</strong> is on every row of the file, so it is filled in. Check its lists below.
              </Alert>
            ) : (
              <Box sx={{ mt: 1.5 }} data-testid="suggestions">
                <Typography variant="body2" id="suggestions-label">
                  No company is on every row of the file. Which company is it for? The companies on the most rows:
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap", rowGap: 1 }} role="group" aria-labelledby="suggestions-label">
                  {up.contributors.map((c) => (
                    <Button key={c.name} size="small" variant={chosen?.name === c.name ? "contained" : "outlined"} aria-pressed={chosen?.name === c.name}
                            onClick={() => choose(c)}>
                      {c.name} · {pct(c.share)} of rows
                    </Button>
                  ))}
                </Stack>
              </Box>
            )}
            <Stack direction="row" spacing={2} sx={{ alignItems: "center", mt: 2, flexWrap: "wrap", rowGap: 1 }}>
              <TextField size="small" type="search" label="Search lists" value={query} onChange={(e) => setQuery(e.target.value)} id="list-search" />
              <FormControlLabel control={<Checkbox size="small" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />}
                                label={`Show all lists (${hidden.size} hidden: anonymous types and "(Claimed)" entries)`} />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }} role="status">
              Showing {rows.length} of {up.lists.length} lists{chosen ? `; ${chosen.name}'s lists first` : ""}. Ticked: {picked.size}, current: {[...picked].filter((l) => current.has(l)).length}.
            </Typography>
            <TableContainer sx={{ mt: 1, border: 1, borderColor: "divider", borderRadius: 2.5 }}>
              <Table size="small">
                <TableHead><TableRow><TableCell>Company's list</TableCell><TableCell>Current</TableCell><TableCell>List name in the file</TableCell><TableCell align="right">Sites</TableCell></TableRow></TableHead>
                <TableBody>
                  {rows.map((l) => (
                    <TableRow key={l.list}>
                      <TableCell padding="checkbox"><Checkbox size="small" slotProps={{ input: { "aria-label": `Company's list: ${l.list}` } }}
                                                             checked={picked.has(l.list)} onChange={() => toggle(picked, l.list, setPicked)} /></TableCell>
                      <TableCell padding="checkbox"><Checkbox size="small" slotProps={{ input: { "aria-label": `Current: ${l.list}` } }}
                                                             checked={current.has(l.list)} disabled={!picked.has(l.list)} onChange={() => toggle(current, l.list, setCurrent)} /></TableCell>
                      <TableCell>{l.list}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{l.sites}</TableCell>
                    </TableRow>
                  ))}
                  {!rows.length && <TableRow><TableCell colSpan={4}><Typography variant="body2" color="text.secondary">No list matches "{query}".</Typography></TableCell></TableRow>}
                </TableBody>
              </Table>
            </TableContainer>
            <Stack direction="row" spacing={2} sx={{ alignItems: "center", mt: 2, flexWrap: "wrap", rowGap: 1 }}>
              <TextField size="small" label="Company name" value={name} onChange={(e) => setName(e.target.value)} id="company-name" />
              <Button variant="contained" disabled={busy || !name.trim() || ![...picked].some((l) => current.has(l))} onClick={onConfirm}>Load this company</Button>
            </Stack>
          </>
        )}
        {msg && <Alert severity={msg.ok ? "success" : "error"} sx={{ mt: 2 }} role="status">{msg.text}</Alert>}
      </CardContent>
    </Card>
  );
}
