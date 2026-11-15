import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib";
import type { Scrape } from "../../shared/types";
import { api } from "./api";
import { downloadCsv, errText, fileSlug, type Ws } from "./data";
import { normDomain } from "./logic";
import { ConfirmButton, Ext, Loading, Notice, PageHead } from "./ui";

const METHOD: Record<string, string> = { ai: "AI extraction", table: "HTML table", list: "Repeated list", jsonld: "Structured data" };
const SHOWN = 200;
type Saved = Pick<Scrape, "id" | "name" | "url" | "method" | "created_at">;
type View = Pick<Scrape, "name" | "url" | "fields" | "columns" | "rows" | "method"> & { note: string | null; id: string | null };

function ChipsInput({ id, value, onChange }: { id: string; value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    // a pasted "name, price, email" becomes three columns
    const next = [...new Set([...value, ...draft.split(",").map((v) => v.trim()).filter(Boolean)])].slice(0, 24);
    if (next.length !== value.length) onChange(next);
    setDraft("");
  };
  return (
    <span className="chips-input">
      {value.map((v) => (
        <span key={v} className="tag">{v}
          <button type="button" className="chip-x" aria-label={`Remove column ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>×</button></span>
      ))}
      <input id={id} value={draft} maxLength={60} placeholder={value.length ? "" : "name, price, email  (press Enter after each)"}
        onChange={(e) => setDraft(e.target.value)} onBlur={add}
        onKeyDown={(e) => {
          if ((e.key === "Enter" && draft.trim()) || e.key === ",") { e.preventDefault(); add(); }
          else if (e.key === "Backspace" && !draft) onChange(value.slice(0, -1));
        }} />
    </span>
  );
}

export default function Scraper({ ws }: { ws: Ws }) {
  const [url, setUrl] = useState("");
  const [fields, setFields] = useState<string[]>([]);
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [view, setView] = useState<View | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Saved[] | null>(null);
  const [savedErr, setSavedErr] = useState("");
  const [deleting, setDeleting] = useState("");

  const loadSaved = useCallback(async () => {
    const { data, error } = await supabase.from("gl_scrapes").select("id,name,url,method,created_at")
      .eq("workspace_id", ws.id).order("created_at", { ascending: false }).limit(200);
    if (error) setSavedErr(error.message); else { setSaved(data as Saved[]); setSavedErr(""); }
  }, [ws.id]);
  useEffect(() => { loadSaved(); }, [loadSaved]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(""); setView(null);
    try {
      const u = url.trim();
      const r = await api.extract({ ws: ws.id, url: u, fields: fields.length ? fields : undefined, instructions: instructions.trim() || undefined });
      if (!r.rows.length) setErr(r.note || "No rows found on that page. Name the columns you want or add instructions.");
      else setView({ ...r, id: null, url: u, fields, name: `${normDomain(u) ?? "Scrape"}${new URL(u).pathname.replace(/\/$/, "")}`.slice(0, 120) });
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!view) return;
    setSaving(true); setErr("");
    const { data, error } = await supabase.from("gl_scrapes").insert({
      workspace_id: ws.id, name: view.name.trim(), url: view.url, fields: view.fields, columns: view.columns, rows: view.rows, method: view.method,
    }).select("id").single();
    setSaving(false);
    if (error) return setErr(`Could not save: ${error.message}`);
    setView({ ...view, id: data.id });
    loadSaved();
  }

  async function open(id: string) {
    setErr("");
    const { data, error } = await supabase.from("gl_scrapes").select("*").eq("id", id).maybeSingle();
    if (error || !data) return setErr(`Could not open that scrape${error ? `: ${error.message}` : "."}`);
    const s = data as Scrape;
    setView({ ...s, note: null });
    setUrl(s.url); setFields(s.fields ?? []);
    window.scrollTo({ top: 0 });
  }

  async function remove(id: string) {
    setDeleting(id);
    const { error } = await supabase.from("gl_scrapes").delete().eq("id", id);
    setDeleting("");
    if (error) return setSavedErr(`Could not delete: ${error.message}`);
    if (view?.id === id) setView(null);
    setSaved((s) => s && s.filter((x) => x.id !== id));
  }

  return (
    <>
      <PageHead title="Scraper" sub="Turn any page into a table. Name the columns you want, or leave them empty and Ghost Leads reads the page’s own structure." />
      <form className="card pad stack" onSubmit={submit}>
        <label className="field"><span className="label">Page address</span>
          <input className="input" type="url" required maxLength={2000} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/members" /></label>
        <div className="row2">
          {/* not a wrapping label: it would forward clicks to the first chip's remove button */}
          <div className="field"><label className="label" htmlFor="scr-cols">Columns (optional)</label><ChipsInput id="scr-cols" value={fields} onChange={setFields} /></div>
          <label className="field"><span className="label">Instructions (optional)</span>
            <input className="input" maxLength={500} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Only companies based in Germany" /></label>
        </div>
        <div className="find-actions">
          <button className="btn btn-ember btn-sm" disabled={busy}>{busy ? <><span className="spinner spinner-sm" /> Reading page…</> : "Extract table"}</button>
        </div>
      </form>

      {err && <Notice kind="err">{err}</Notice>}
      {busy && <Loading label="Reading the page. This can take up to a minute." />}

      {view && (
        <section className="card results" aria-label="Extracted table">
          <div className="results-head">
            <span className="cell-main num">{view.rows.length.toLocaleString()} rows · {view.columns.length} columns</span>
            <span className="tag">{METHOD[view.method] ?? view.method}</span>
            <Ext href={view.url} className="link small clamp">{view.url}</Ext>
          </div>
          {view.note && <p className="results-note small">{view.note}</p>}
          <div className="table-wrap table-max">
            <table className="dense">
              <thead><tr>{view.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
              <tbody>
                {view.rows.slice(0, SHOWN).map((r, i) => (
                  <tr key={i}>{view.columns.map((c) => <td key={c}><div className="clamp2">{r[c] ? <Ext href={r[c]}>{r[c]}</Ext> : <span className="faint">—</span>}</div></td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          {view.rows.length > SHOWN && <p className="results-note small">Showing the first {SHOWN} rows. Export and Save include all {view.rows.length.toLocaleString()}.</p>}
          <div className="savebar">
            <label className="field grow"><span className="label">Name</span>
              <input className="input input-sm" maxLength={120} value={view.name} disabled={!!view.id} onChange={(e) => setView({ ...view, name: e.target.value })} /></label>
            <button type="button" className="btn btn-line btn-sm" onClick={() => downloadCsv(`${fileSlug(view.name)}.csv`, view.columns, view.rows)}>Export CSV</button>
            <button type="button" className="btn btn-ember btn-sm" disabled={saving || !!view.id || !view.name.trim()} onClick={save}>
              {view.id ? "Saved" : saving ? "Saving…" : "Save"}</button>
          </div>
        </section>
      )}

      <h2 className="h4 sec-title">Saved scrapes</h2>
      {savedErr && <Notice kind="err">{savedErr}</Notice>}
      {!saved ? (!savedErr && <Loading />) : saved.length === 0 ? (
        <div className="card empty"><p className="muted">Nothing saved yet. Extract a table and press Save to keep it here.</p></div>
      ) : (
        <div className="card table-wrap">
          <table className="dense">
            <thead><tr><th scope="col">Name</th><th scope="col" className="m-hide">Page</th><th scope="col" className="m-hide">Method</th><th scope="col">Saved</th><th scope="col"><span className="sr">Actions</span></th></tr></thead>
            <tbody>
              {saved.map((s) => (
                <tr key={s.id} className={deleting === s.id ? "row-off" : ""}>
                  <td><button type="button" className="rowlink cell-main clamp" onClick={() => open(s.id)}>{s.name}</button></td>
                  <td className="m-hide"><Ext href={s.url} className="link small clamp">{s.url}</Ext></td>
                  <td className="m-hide"><span className="tag">{METHOD[s.method] ?? s.method ?? "—"}</span></td>
                  <td className="small nowrap">{new Date(s.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</td>
                  <td className="r"><ConfirmButton label="Delete" ariaLabel={`Delete ${s.name}`} onConfirm={() => remove(s.id)} disabled={!!deleting} className="btn btn-ghost btn-xs" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
