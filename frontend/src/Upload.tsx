import { useState } from "react";
import { api } from "./api";

/** Upload page: file in, pick the company's lists, mark which are current, confirm. */
export default function Upload(props: { onDone: (customer_id: string) => void }) {
  const [up, setUp] = useState<Awaited<ReturnType<typeof api.upload>> | null>(null);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (set: Set<string>, value: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    setter(next);
  };

  async function onFile(file: File | undefined) {
    if (!file) return;
    setMsg(null); setBusy(true);
    try { setUp(await api.upload(file)); setPicked(new Set()); setCurrent(new Set()); }
    catch (e) { setMsg(String((e as Error).message)); }
    finally { setBusy(false); }
  }

  async function onConfirm() {
    if (!up) return;
    setBusy(true); setMsg(null);
    try {
      const lists = [...picked];
      const r = await api.confirm(up.upload_id, { name, lists, current_lists: lists.filter((l) => current.has(l)) });
      setMsg(`Loaded ${name}: ${r.open_sites} open sites (as of ${r.as_of}).`);
      props.onDone(r.customer_id);
    } catch (e) { setMsg(String((e as Error).message)); }
    finally { setBusy(false); }
  }

  return (
    <section className="upload">
      <h2>Upload a supplier list</h2>
      <p>Choose an Open Supply Hub download (CSV). Any <code>claim_*</code> columns (personal contact details) are dropped.
        A new upload replaces only this company's data.</p>
      <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
      {up && (
        <>
          <p>{up.rows} rows. Tick the company's own lists, and mark which of them are current.
            Open sites are sites on a current list that are not closed.</p>
          <label className="field">Company name <input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <div className="scroll">
            <table>
              <thead><tr><th>Company's list</th><th>Current</th><th>List name in the file</th><th>Sites</th></tr></thead>
              <tbody>
                {up.lists.map((l) => (
                  <tr key={l.list}>
                    <td><input type="checkbox" checked={picked.has(l.list)} onChange={() => toggle(picked, l.list, setPicked)} /></td>
                    <td><input type="checkbox" checked={current.has(l.list)} disabled={!picked.has(l.list)}
                               onChange={() => toggle(current, l.list, setCurrent)} /></td>
                    <td>{l.list}</td><td>{l.sites}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button disabled={busy || !name.trim() || ![...picked].some((l) => current.has(l))} onClick={onConfirm}>Load this company</button>
        </>
      )}
      {msg && <p className="msg">{msg}</p>}
    </section>
  );
}
