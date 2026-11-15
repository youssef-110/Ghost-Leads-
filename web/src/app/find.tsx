import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { safeUrl, supabase } from "../lib";
import type { DiscoverItem, DiscoverParams, Source } from "../../shared/types";
import { api } from "./api";
import { errText, type Ws } from "./data";
import { importItem, importNote, listNameFor, parseImport, toProspectRows } from "./logic";
import { Ext, Notice, PageHead, SignalChips, SrcLink, Tabs } from "./ui";

const SOURCES: [Source, string, string][] = [
  ["maps", "Local businesses", "Shops, clinics, agencies and any other business in a place, from OpenStreetMap."],
  ["web", "Web search", "Company websites that match a search."],
  ["startups", "Startups", "Startups by keyword, industry and location. All fields are optional."],
  ["hiring", "Hiring signals", "Companies with open roles that match a keyword."],
  ["directory", "Directory page", "Any exhibitor, member or partner list. Paste the address of the page."],
  ["import", "Import", "Paste domains, URLs or work emails, or upload a CSV. Each is reduced to the company domain; free-mail addresses are left out. Read in your browser; nothing is uploaded until you save."],
];
const BLANK = { query: "", location: "", industry: "", hiring: false, url: "", text: "" };
type Result = { items: DiscoverItem[]; note: string | null; query: Record<string, unknown>; name: string; source: Source };

export default function Find({ ws }: { ws: Ws }) {
  const nav = useNavigate();
  const [source, setSource] = useState<Source>("maps");
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [lists, setLists] = useState<{ id: string; name: string }[]>([]);
  const [target, setTarget] = useState("new");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  useEffect(() => {
    supabase.from("gl_lists").select("id,name").eq("workspace_id", ws.id).order("created_at", { ascending: false }).limit(500)
      .then(({ data }) => setLists(data ?? []));
  }, [ws.id]);

  const set = (k: "query" | "location" | "industry" | "url") => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const show = (r: Result) => { setRes(r); setPicked(new Set(r.items.keys())); setName(r.name); setSaveErr(""); };
  const reset = (s: string) => { setSource(s as Source); setRes(null); setErr(""); };

  function params(): DiscoverParams {
    const t = (s: string) => s.trim() || undefined;
    if (source === "maps") return { source, query: f.query.trim(), location: f.location.trim() };
    if (source === "web") return { source, query: f.query.trim() };
    if (source === "startups") return { source, query: t(f.query), industry: t(f.industry), location: t(f.location), hiring: f.hiring || undefined };
    if (source === "hiring") return { source, query: f.query.trim(), location: t(f.location) };
    return { source: "directory", url: f.url.trim() };
  }

  function importText(text: string) {
    const r = parseImport(text), note = importNote(r);
    setErr(r.domains.length ? "" : `No company domains found. ${note ?? "Paste one website, URL or work email per line."}`);
    if (!r.domains.length) return setRes(null);
    show({ items: r.domains.map(importItem), note, query: { count: r.domains.length }, name: listNameFor({ source: "import" }), source: "import" });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (source === "import") return importText(f.text);
    setBusy(true); setErr(""); setRes(null);
    try {
      const p = params();
      const r = await api.discover({ ws: ws.id, ...p });
      if (!r.items.length) setErr(r.note || "No companies found. Try a broader search.");
      else show({ items: r.items, note: r.note, query: p, name: listNameFor(p), source });
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 2_000_000) return setErr("That file is larger than 2 MB. Split it and import in parts.");
    importText(await file.text());
  }

  async function save() {
    if (!res) return;
    setSaving(true); setSaveErr("");
    let listId = target, created = false;
    try {
      if (target === "new") {
        const { data, error } = await supabase.from("gl_lists")
          .insert({ workspace_id: ws.id, name: name.trim(), source: res.source, query: res.query }).select("id").single();
        if (error) throw new Error(error.message);
        listId = data.id; created = true;
      }
      const rows = toProspectRows(res.items.filter((_, i) => picked.has(i)), ws.id, listId);
      for (let i = 0; i < rows.length; i += 500) {
        // re-running a search must not duplicate or overwrite companies already in the list
        const { error } = await supabase.from("gl_prospects").upsert(rows.slice(i, i + 500), { onConflict: "list_id,key", ignoreDuplicates: true });
        if (error) throw new Error(error.message);
      }
      nav(`/app/lists/${listId}`);
    } catch (e) {
      if (created) await supabase.from("gl_lists").delete().eq("id", listId);
      setSaveErr(`Could not save: ${errText(e)}`);
      setSaving(false);
    }
  }

  const all = !!res && picked.size === res.items.length;
  const toggle = (i: number) => setPicked((s) => { const n = new Set(s); if (!n.delete(i)) n.add(i); return n; });

  return (
    <>
      <PageHead title="Find leads" sub="Pick a source, preview the companies, and save the ones you want to a list." />
      <Tabs value={source} onChange={reset} items={SOURCES.map(([v, l]) => [v, l])} label="Lead source" />
      <form className="card pad find-form" onSubmit={submit}>
        <p className="muted find-desc">{SOURCES.find((s) => s[0] === source)?.[2]}</p>
        <div className="find-fields">
          {source === "maps" && <>
            <label className="field"><span className="label">What</span><input className="input" required maxLength={120} value={f.query} onChange={set("query")} placeholder="dentists, coffee roasters, web agencies" /></label>
            <label className="field"><span className="label">Where</span><input className="input" required maxLength={120} value={f.location} onChange={set("location")} placeholder="Lyon, France" /></label>
          </>}
          {source === "web" && (
            <label className="field grow"><span className="label">Search</span><input className="input" required maxLength={200} value={f.query} onChange={set("query")} placeholder="b2b logistics software companies in Benelux" /></label>
          )}
          {source === "startups" && <>
            <label className="field"><span className="label">Keyword</span><input className="input" maxLength={120} value={f.query} onChange={set("query")} placeholder="developer tools" /></label>
            <label className="field"><span className="label">Industry</span><input className="input" maxLength={120} value={f.industry} onChange={set("industry")} placeholder="fintech" /></label>
            <label className="field"><span className="label">Location</span><input className="input" maxLength={120} value={f.location} onChange={set("location")} placeholder="Berlin" /></label>
            <label className="check field-check"><input type="checkbox" checked={f.hiring} onChange={(e) => setF({ ...f, hiring: e.target.checked })} /> Hiring only</label>
          </>}
          {source === "hiring" && <>
            <label className="field"><span className="label">Role keyword</span><input className="input" required maxLength={120} value={f.query} onChange={set("query")} placeholder="account executive" /></label>
            <label className="field"><span className="label">Location (optional)</span><input className="input" maxLength={120} value={f.location} onChange={set("location")} placeholder="Remote, Europe" /></label>
          </>}
          {source === "directory" && (
            <label className="field grow"><span className="label">Page address</span><input className="input" type="url" required maxLength={2000} value={f.url} onChange={set("url")} placeholder="https://example-expo.com/exhibitors" /></label>
          )}
          {source === "import" && (
            <label className="field grow"><span className="label">Domains, URLs or emails</span>
              <textarea className="input" rows={5} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder={"acme.com\nhttps://www.example.org/about\njane@company.io"} /></label>
          )}
        </div>
        <div className="find-actions">
          {source === "import" && (
            <label className="btn btn-line btn-sm file-btn">Upload CSV<input type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" onChange={onFile} /></label>
          )}
          <button className="btn btn-ember btn-sm" disabled={busy || (source === "import" && !f.text.trim())}>
            {busy ? <><span className="spinner spinner-sm" /> Searching…</> : source === "import" ? "Preview domains" : "Search"}
          </button>
        </div>
      </form>

      {err && <Notice kind="err">{err}</Notice>}
      {busy && <div className="card empty center" role="status"><span className="spinner" /><span className="small">Searching. This can take up to a minute.</span></div>}

      {res && (
        <section className="card results" aria-label="Results">
          <div className="results-head">
            <span className="cell-main num">{res.items.length.toLocaleString()} {res.items.length === 1 ? "company" : "companies"}</span>
            <span className="small num">{picked.size.toLocaleString()} selected</span>
          </div>
          {res.note && <p className="results-note small">{res.note}</p>}
          <div className="table-wrap table-max">
            <table className="dense">
              <thead><tr>
                <th scope="col" className="col-check"><input type="checkbox" aria-label="Select all" checked={all}
                  ref={(el) => { if (el) el.indeterminate = picked.size > 0 && !all; }}
                  onChange={() => setPicked(all ? new Set() : new Set(res.items.keys()))} /></th>
                <th scope="col">Company</th><th scope="col">Website</th><th scope="col" className="m-hide">City</th><th scope="col" className="m-hide">Phone</th>
                <th scope="col" className="m-hide">Source</th><th scope="col" className="m-hide">Signals</th>
              </tr></thead>
              <tbody>
                {res.items.map((it, i) => (
                  <tr key={i} className={picked.has(i) ? "" : "row-off"}>
                    <td className="col-check"><input type="checkbox" aria-label={`Select ${it.company_name}`} checked={picked.has(i)} onChange={() => toggle(i)} /></td>
                    <td><div className="cell-main clamp">{it.company_name || "—"}</div>{it.industry && <div className="small clamp">{it.industry}</div>}</td>
                    <td className="clamp">{it.domain ? <Ext href={it.website}>{it.domain}</Ext> : <span className="faint">—</span>}</td>
                    <td className="m-hide">{it.city || <span className="faint">—</span>}</td>
                    <td className="num nowrap m-hide">{it.phone || <span className="faint">—</span>}</td>
                    <td className="m-hide">{safeUrl(it.source_url) ? <SrcLink href={it.source_url} /> : <span className="faint">—</span>}</td>
                    <td className="m-hide"><SignalChips signals={it.signals} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="savebar">
            <label className="field"><span className="label">Save to</span>
              <select className="input input-sm" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="new">New list</option>
                {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select></label>
            {target === "new" && (
              <label className="field grow"><span className="label">List name</span>
                <input className="input input-sm" maxLength={160} value={name} onChange={(e) => setName(e.target.value)} /></label>
            )}
            <button type="button" className="btn btn-ember btn-sm" onClick={save}
              disabled={saving || picked.size === 0 || (target === "new" && !name.trim())}>
              {saving ? "Saving…" : `Save ${picked.size.toLocaleString()} to list`}
            </button>
          </div>
          {saveErr && <Notice kind="err">{saveErr}</Notice>}
        </section>
      )}
    </>
  );
}
