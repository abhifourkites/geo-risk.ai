import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Checkbox from "@mui/material/Checkbox";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { api } from "./api";

/** Upload page: file in, pick the company's lists, mark which are current, confirm. */
export default function Upload(props: { onDone: (customer_id: string) => void }) {
  const [up, setUp] = useState<Awaited<ReturnType<typeof api.upload>> | null>(null);
  const [fileName, setFileName] = useState("");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (set: Set<string>, value: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    setter(next);
  };

  async function onFile(file: File | undefined) {
    if (!file) return;
    setMsg(null); setBusy(true); setFileName(file.name);
    try { setUp(await api.upload(file)); setPicked(new Set()); setCurrent(new Set()); }
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
          <li><Typography variant="body2">Tick the company's own lists, and mark which of them are current.</Typography></li>
          <li><Typography variant="body2">Give the company a name, and load it. Only sites on a current list that are not closed are loaded.
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
            <TableContainer sx={{ mt: 1, border: 1, borderColor: "divider", borderRadius: 2.5 }}>
              <Table size="small">
                <TableHead><TableRow><TableCell>Company's list</TableCell><TableCell>Current</TableCell><TableCell>List name in the file</TableCell><TableCell align="right">Sites</TableCell></TableRow></TableHead>
                <TableBody>
                  {up.lists.map((l) => (
                    <TableRow key={l.list}>
                      <TableCell padding="checkbox"><Checkbox size="small" slotProps={{ input: { "aria-label": `Company's list: ${l.list}` } }}
                                                             checked={picked.has(l.list)} onChange={() => toggle(picked, l.list, setPicked)} /></TableCell>
                      <TableCell padding="checkbox"><Checkbox size="small" slotProps={{ input: { "aria-label": `Current: ${l.list}` } }}
                                                             checked={current.has(l.list)} disabled={!picked.has(l.list)} onChange={() => toggle(current, l.list, setCurrent)} /></TableCell>
                      <TableCell>{l.list}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{l.sites}</TableCell>
                    </TableRow>
                  ))}
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
