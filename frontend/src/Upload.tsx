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
      setMsg(`Loaded ${name}: ${r.open_sites} sites on current lists (as of ${r.as_of}).`);
      props.onDone(r.customer_id);
    } catch (e) { setMsg(String((e as Error).message)); }
    finally { setBusy(false); }
  }

  return (
    <main className="upload">
      <h2>Upload a supplier list</h2>
      <ol className="steps">
        <li>Choose an Open Supply Hub download (CSV). Personal contact columns (<code>claim_*</code>) are dropped.</li>
        <li>Tick the company's own lists, and mark which of them are current.</li>
        <li>Give the company a name, and load it. Only sites on a current list that are not closed are loaded.
          A new upload replaces only this company's data.</li>
      </ol>
      <label className="field">File <input type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} /></label>
      {up && (
        <>
          <p>{up.rows} rows in the file, naming {up.lists.length} lists.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Company's list</th><th scope="col">Current</th><th scope="col">List name in the file</th><th scope="col" className="num">Sites</th></tr></thead>
              <tbody>
                {up.lists.map((l) => (
                  <tr key={l.list}>
                    <td><input type="checkbox" aria-label={`Company's list: ${l.list}`} checked={picked.has(l.list)} onChange={() => toggle(picked, l.list, setPicked)} /></td>
                    <td><input type="checkbox" aria-label={`Current: ${l.list}`} checked={current.has(l.list)} disabled={!picked.has(l.list)}
                               onChange={() => toggle(current, l.list, setCurrent)} /></td>
                    <td>{l.list}</td><td className="num">{l.sites}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="field">Company name <input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <button type="button" disabled={busy || !name.trim() || ![...picked].some((l) => current.has(l))} onClick={onConfirm}>Load this company</button>
        </>
      )}
      {msg && <p className="msg" role="status">{msg}</p>}
    </main>
  );
}
