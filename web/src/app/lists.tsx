import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../lib";
import type { List, Prospect } from "../../shared/types";
import { api } from "./api";
import { announce, countStat, download, downloadCsv, errText, fileSlug, loadUsage, useLists, useListStats, type Stat, type Ws } from "./data";
import { ProspectDrawer } from "./drawer";
import {
  bestEmail, bestEmails, bestPerson, budgetText, canRetry, enrichBudget, failMessage, filterProspects, filtersFromQuery, filtersToQuery,
  isFiltered, needsEnrich, NO_FILTERS, planLimits, PROSPECT_COLS, prospectExportRow, runEnrichment, SORT_DIR,
  type Budget, type Filters, type RunProgress, type RunResult, type SortKey,
} from "./logic";
import { ConfirmButton, EmailTag, Loading, Notice, PageHead, StatusTag } from "./ui";

const SOURCE_LABEL: Record<string, string> = {
  maps: "Local businesses", web: "Web search", startups: "Startups", hiring: "Hiring signals", directory: "Directory", import: "Import",
};
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const count = (n: number | undefined) => (n == null ? "–" : n.toLocaleString());

export function Lists({ ws }: { ws: Ws }) {
  const { lists, error, reload } = useLists(ws);
  const { stats, error: countErr } = useListStats(ws, (lists ?? []).map((l) => l.id));
  const [err, setErr] = useState("");
  // pending, not optimistic: the row stays (dimmed) until the server has really deleted the list and its companies
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<{ id: string; name: string; saving?: boolean } | null>(null);

  async function remove(l: List) {
    setDeleting((s) => new Set(s).add(l.id)); setErr("");
    const { error } = await supabase.from("gl_lists").delete().eq("id", l.id);
    if (error) setErr(`Could not delete the list: ${error.message}`); else announce(`Deleted the list ${l.name}`);
    await reload();
    setDeleting((s) => { const n = new Set(s); n.delete(l.id); return n; });
  }

  /** Leave the inline editor and put focus back on the Rename button it replaced. */
  function stopEdit(id: string) {
    flushSync(() => setEdit(null));
    document.getElementById(`rn-${id}`)?.focus();
  }
  async function rename(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    const name = edit.name.trim();
    if (!name || name === lists?.find((l) => l.id === edit.id)?.name) return stopEdit(edit.id);
    setEdit({ ...edit, saving: true }); setErr("");
    // select() tells a real update from one row-level security silently skipped
    const { data, error } = await supabase.from("gl_lists").update({ name }).eq("id", edit.id).select("id");
    if (error || !data?.length) {
      setErr(`Could not rename the list: ${error?.message ?? "it no longer exists."}`);
      return setEdit({ ...edit, saving: false });
    }
    await reload();
    stopEdit(edit.id);
    announce(`List renamed to ${name}`);
  }

  const head = <PageHead title="Lists" sub="Every list you saved, with how far enrichment has got."
    action={<Link to="/app/find" className="btn btn-ember btn-sm">Find leads</Link>} />;
  if (error) return <>{head}<Notice kind="err">Could not load lists: {error}</Notice></>;
  if (!lists) return <>{head}<Loading /></>;
  return (
    <>
      {head}
      {err && <Notice kind="err">{err}</Notice>}
      {countErr && <Notice kind="err">Could not count companies: {countErr}</Notice>}
      {lists.length === 0 ? (
        <div className="card empty">
          <h2 className="h3">No lists yet</h2>
          <p className="muted">Search a source or import your own domains, then save the companies you want.</p>
          <Link to="/app/find" className="btn btn-ember btn-sm">Find leads</Link>
        </div>
      ) : (
        <div className="card table-wrap">
          <table className="dense">
            <thead><tr><th scope="col">List</th><th scope="col" className="m-hide">Source</th><th scope="col" className="r">Companies</th>
              <th scope="col" className="r m-hide">Enriched</th><th scope="col" className="r">With email</th><th scope="col" className="m-hide">Created</th>
              <th scope="col"><span className="sr">Actions</span></th></tr></thead>
            <tbody>
              {lists.map((l) => {
                const s = stats[l.id], off = deleting.has(l.id);
                return (
                  <tr key={l.id} className={off ? "row-off" : ""}>
                    <td>{edit?.id === l.id ? (
                      <form className="rename" onSubmit={rename}>
                        <input className="input input-sm" aria-label={`New name for ${l.name}`} autoFocus required maxLength={160} value={edit.name} disabled={edit.saving}
                          onChange={(e) => setEdit({ ...edit, name: e.target.value })} onFocus={(e) => e.target.select()}
                          onKeyDown={(e) => { if (e.key === "Escape") stopEdit(l.id); }} />
                        <button className="btn btn-ember btn-xs" disabled={edit.saving || !edit.name.trim()}>{edit.saving ? "Saving…" : "Save"}</button>
                        <button type="button" className="btn btn-ghost btn-xs" disabled={edit.saving} onClick={() => stopEdit(l.id)}>Cancel</button>
                      </form>
                    ) : <Link to={`/app/lists/${l.id}`} className="cell-main rowlink clamp">{l.name}</Link>}</td>
                    <td className="m-hide"><span className="tag">{SOURCE_LABEL[l.source] ?? l.source}</span></td>
                    <td className="num r">{count(s?.total)}</td>
                    <td className="num r m-hide">{count(s?.enriched)}</td>
                    <td className="num r">{count(s?.withEmail)}</td>
                    <td className="small nowrap m-hide">{day(l.created_at)}</td>
                    <td className="r nowrap">{off ? <span className="small" role="status">Deleting…</span> : edit?.id !== l.id && <>
                      <button type="button" id={`rn-${l.id}`} className="btn btn-ghost btn-xs" aria-label={`Rename ${l.name}`}
                        onClick={() => setEdit({ id: l.id, name: l.name })}>Rename</button>
                      <ConfirmButton label="Delete" ariaLabel={`Delete ${l.name}`} onConfirm={() => remove(l)} className="btn btn-ghost btn-xs" />
                    </>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const CAP = 1000;
const scoreTag = (n: number) => (n >= 70 ? "tag-ok" : n >= 40 ? "tag-ember" : "");
/** Time today, date before that. */
function when(iso: string) {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

type Note = { kind: "ok" | "err" | "info"; text: string };
function runSummary(r: RunResult): Note {
  const parts = [`${r.done} enriched`, r.failed > 0 && `${r.failed} failed`, r.skipped > 0 && `${r.skipped} skipped (no website)`].filter(Boolean).join(" · ");
  if (r.stopped && r.stopped !== "user")
    return { kind: "err", text: `Stopped: ${failMessage(r.stopped, "enrich")} ${parts}. The rest stay pending; press Enrich to resume.` };
  if (r.stopped === "user") return { kind: "info", text: `Stopped. ${parts}. Press Enrich to resume.` };
  return { kind: r.failed ? "info" : "ok", text: `Done. ${parts}.` };
}

export function ListDetail({ ws }: { ws: Ws }) {
  const { id = "" } = useParams();
  const [list, setList] = useState<List | null>(null);
  const [rows, setRows] = useState<Prospect[] | null>(null);
  const [total, setTotal] = useState(0);
  const [exact, setExact] = useState<Stat | null>(null);
  const [error, setError] = useState("");
  // the view lives in the query string too, so a refresh or a shared link shows the same rows
  const [params, setParams] = useSearchParams();
  const [f, setFilters] = useState<Filters>(() => filtersFromQuery(params));
  const setF = (next: Filters) => { setFilters(next); setParams(filtersToQuery(next), { replace: true }); };
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [openId, setOpenId] = useState<number | null>(null);
  const [run, setRun] = useState<RunProgress | null>(null);
  const [ask, setAsk] = useState<{ rows: Prospect[]; budget: Budget } | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const stop = useRef(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const [l, p] = await Promise.all([
        supabase.from("gl_lists").select("*").eq("id", id).maybeSingle(),
        supabase.from("gl_prospects").select("*", { count: "exact" }).eq("list_id", id).order("id").limit(CAP),
      ]);
      if (!live) return;
      if (l.error || !l.data) return setError("This list does not exist or was deleted.");
      if (p.error) return setError(p.error.message);
      setList(l.data as List); setRows(p.data as Prospect[]); setTotal(p.count ?? p.data.length);
    })();
    // leaving the page stops the run; rows left in `enriching` are picked up again next time
    return () => { live = false; stop.current = true; };
  }, [id]);

  // a list longer than the page: the header counts come from the database, refreshed when a run ends
  const capped = !!rows && total > rows.length, idle = !run;
  useEffect(() => {
    if (!capped || !idle) return;
    let live = true;
    countStat(ws.id, id).then((s) => live && setExact(s), () => {});
    return () => { live = false; };
  }, [ws.id, id, capped, idle, total]);

  /** Optimistic local update, then the database. Throws when the write fails. */
  const patch = useCallback(async (pid: number, p: Partial<Prospect>) => {
    setRows((rs) => rs && rs.map((r) => (r.id === pid ? { ...r, ...p, updated_at: new Date().toISOString() } : r)));
    const { error } = await supabase.from("gl_prospects").update(p).eq("id", pid);
    if (error) throw new Error(error.message);
  }, []);

  const visible = useMemo(() => filterProspects(rows ?? [], f), [rows, f]);
  const head = <PageHead title={list?.name ?? "List"} back={["/app/lists", "Lists"]} />;
  if (error) return <>{head}<Notice kind="err">{error}</Notice></>;
  if (!rows || !list) return <>{head}<Loading /></>;

  const chosen = rows.filter((r) => sel.has(r.id));
  const pending = rows.filter(needsEnrich), failed = rows.filter(canRetry);
  // picking rows by hand is explicit, so failed ones are retried too; enriched ones only from the drawer
  const chosenEnrich = chosen.filter((r) => r.domain && r.status !== "enriched");
  const chosenEmails = bestEmails(chosen);
  const open = rows.find((r) => r.id === openId);
  const allVisible = visible.length > 0 && visible.every((r) => sel.has(r.id));
  const filtered = isFiltered(f);
  const file = fileSlug(list.name);
  const stat = capped && exact ? exact
    : { total, enriched: rows.filter((r) => r.status === "enriched").length, withEmail: rows.filter((r) => bestEmail(r)).length };

  /** Show what the run will cost before it starts; the run is cut to what is left of today's limit. */
  async function askEnrich(which: Prospect[]) {
    if (run) return;
    setNote(null);
    try {
      const used = (await loadUsage(ws.id)).enrich ?? 0;
      setAsk({ rows: which, budget: enrichBudget(which.length, used, planLimits(ws.plan).enrich) });
    } catch (e) {
      setNote({ kind: "err", text: `Could not check today’s usage: ${errText(e)}` });
    }
  }

  async function enrich(which: Prospect[]) {
    if (run) return;
    stop.current = false; setNote(null); setAsk(null);
    announce(`Enriching ${which.length} ${which.length === 1 ? "company" : "companies"}`);
    const r = await runEnrichment(which, {
      enrich: (row) => api.enrich({ ws: ws.id, domain: row.domain, company_name: row.company_name === row.domain ? undefined : row.company_name }),
      save: patch, onProgress: setRun, shouldStop: () => stop.current,
    });
    setRun(null); setNote(runSummary(r));
  }

  async function removeSelected() {
    const ids = [...sel];
    setNote(null);
    try {
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await supabase.from("gl_prospects").delete().in("id", ids.slice(i, i + 200));
        if (error) throw new Error(error.message);
      }
      setRows((rs) => rs && rs.filter((r) => !sel.has(r.id)));
      setTotal((t) => t - ids.length); setSel(new Set());
      setNote({ kind: "ok", text: `Deleted ${ids.length.toLocaleString()} ${ids.length === 1 ? "company" : "companies"}.` });
    } catch (e) {
      setNote({ kind: "err", text: `Could not delete: ${errText(e)}` });
    }
  }

  const copyEmails = () => navigator.clipboard.writeText(chosenEmails.join("\n")).then(
    () => setNote({ kind: "ok", text: `Copied ${chosenEmails.length.toLocaleString()} ${chosenEmails.length === 1 ? "email" : "emails"} to the clipboard.` }),
    () => setNote({ kind: "err", text: "Could not copy: the browser blocked clipboard access." }));
  const exportCsv = (which: Prospect[], suffix = "") => {
    downloadCsv(`${file}${suffix}.csv`, PROSPECT_COLS, which.map(prospectExportRow));
    announce(`Exported ${which.length} companies as CSV`);
  };

  const toggle = (pid: number) => setSel((s) => { const n = new Set(s); if (!n.delete(pid)) n.add(pid); return n; });
  const toggleAll = () => setSel((s) => {
    const n = new Set(s);
    for (const r of visible) if (allVisible) n.delete(r.id); else n.add(r.id);
    return n;
  });
  const closeDrawer = () => {
    const pid = openId;
    flushSync(() => setOpenId(null));
    document.getElementById(`p-${pid}`)?.focus();
  };

  /** A column header that sorts: first click uses the column's natural direction, the next one flips it. */
  const sortTh = (key: SortKey, label: string, cls = "") => {
    const on = f.sort === key;
    return (
      <th scope="col" className={cls} aria-sort={on ? (f.dir === "asc" ? "ascending" : "descending") : undefined}>
        <button type="button" className="th-sort" onClick={() => setF({ ...f, sort: key, dir: on ? (f.dir === "asc" ? "desc" : "asc") : SORT_DIR[key] })}>
          {label}<span aria-hidden="true">{on ? (f.dir === "asc" ? "↑" : "↓") : ""}</span></button>
      </th>
    );
  };

  return (
    <>
      <PageHead title={list.name} back={["/app/lists", "Lists"]}
        sub={`${stat.total.toLocaleString()} companies · ${stat.enriched.toLocaleString()} enriched · ${stat.withEmail.toLocaleString()} with email · ${SOURCE_LABEL[list.source] ?? list.source}, ${day(list.created_at)}`}
        action={<>
          <button className="btn btn-line btn-sm" disabled={!visible.length} onClick={() => exportCsv(visible)}>
            Export CSV{filtered ? ` (${visible.length})` : ""}</button>
          <button className="btn btn-line btn-sm" disabled={!visible.length} onClick={() => download(`${file}.json`, JSON.stringify(visible, null, 2), "application/json")}>JSON</button>
          {failed.length > 0 && !run && <button className="btn btn-line btn-sm" onClick={() => askEnrich(failed)}>Retry failed ({failed.length.toLocaleString()})</button>}
          {run ? <button className="btn btn-line btn-sm" onClick={() => { stop.current = true; }}>Stop</button>
            : <button className="btn btn-ember btn-sm" disabled={!pending.length} onClick={() => askEnrich(pending)}
                title={pending.length ? undefined : "Nothing new to enrich"}>Enrich {pending.length.toLocaleString()}</button>}
        </>} />

      {capped && <Notice kind="info">Showing the first {CAP.toLocaleString()} of {total.toLocaleString()} companies. Search, enrich and export apply to these.</Notice>}
      {ask && !run && (
        <div className="card confirm" role="group" aria-label="Confirm enrichment">
          <p>{budgetText(ask.budget)}</p>
          <div className="confirm-actions">
            {ask.budget.n > 0 && <button autoFocus className="btn btn-ember btn-sm" onClick={() => enrich(ask.rows.slice(0, ask.budget.n))}>
              Enrich {ask.budget.n.toLocaleString()}</button>}
            <button autoFocus={!ask.budget.n} className="btn btn-line btn-sm" onClick={() => setAsk(null)}>{ask.budget.n ? "Cancel" : "Close"}</button>
          </div>
        </div>
      )}
      {run && (
        <div className="card runbar">
          <div className="meter-top"><span><span className="dot pulse" /> Enriching {(run.done + run.failed).toLocaleString()} of {run.total.toLocaleString()}</span>
            <span className="small num">{run.done} done{run.failed ? ` · ${run.failed} failed` : ""}{run.skipped ? ` · ${run.skipped} without website` : ""}</span></div>
          <div className="bar" role="progressbar" aria-label="Enrichment progress" aria-valuemin={0} aria-valuemax={run.total} aria-valuenow={run.done + run.failed}>
            <span style={{ transform: `scaleX(${run.total ? (run.done + run.failed) / run.total : 0})` }} /></div>
        </div>
      )}
      {note && <Notice kind={note.kind}>{note.text}</Notice>}

      <div className="toolbar">
        <input className="input input-sm search" type="search" aria-label="Search companies" placeholder="Search company, domain, person, email"
          value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <label className="check"><input type="checkbox" checked={f.hasEmail} onChange={(e) => setF({ ...f, hasEmail: e.target.checked })} /> Has email</label>
        <label className="check"><input type="checkbox" checked={f.hasPerson} onChange={(e) => setF({ ...f, hasPerson: e.target.checked })} /> Has person</label>
        <select className="input input-sm" aria-label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Filters["status"] })}>
          <option value="">Any status</option><option value="new">New</option><option value="enriching">Enriching</option>
          <option value="enriched">Enriched</option><option value="failed">Failed</option>
        </select>
        <select className="input input-sm" aria-label="Minimum score" value={f.minScore} onChange={(e) => setF({ ...f, minScore: Number(e.target.value) })}>
          <option value={0}>Any score</option><option value={40}>Score 40+</option><option value={60}>Score 60+</option><option value={80}>Score 80+</option>
        </select>
        <select className="input input-sm" aria-label="Sort by" value={f.sort}
          onChange={(e) => setF({ ...f, sort: e.target.value as SortKey, dir: SORT_DIR[e.target.value as SortKey] })}>
          <option value="score">Sort: score</option><option value="name">Sort: name</option><option value="status">Sort: status</option>
          <option value="updated">Sort: last updated</option><option value="added">Sort: date added</option>
        </select>
        {filtered && <button className="btn btn-ghost btn-xs" onClick={() => setF({ ...NO_FILTERS, sort: f.sort, dir: f.dir })}>Clear filters</button>}
      </div>

      {sel.size > 0 && (
        <div className="card bulkbar" role="group" aria-label="Actions for the selected companies">
          <span className="small num">{sel.size.toLocaleString()} selected</span>
          <button className="btn btn-line btn-xs" disabled={!!run || !chosenEnrich.length} onClick={() => askEnrich(chosenEnrich)}
            title={chosenEnrich.length ? undefined : "The selected companies are already enriched or have no website"}>Enrich{chosenEnrich.length ? ` ${chosenEnrich.length.toLocaleString()}` : ""}</button>
          <button className="btn btn-line btn-xs" onClick={() => exportCsv(chosen, "-selected")}>Export CSV</button>
          <button className="btn btn-line btn-xs" disabled={!chosenEmails.length} onClick={copyEmails}>Copy emails{chosenEmails.length ? ` (${chosenEmails.length.toLocaleString()})` : ""}</button>
          <ConfirmButton label="Delete" confirm={`Delete ${sel.size}?`} onConfirm={removeSelected} disabled={!!run} className="btn btn-line btn-xs" />
          <button className="btn btn-ghost btn-xs" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card empty"><p className="muted">This list is empty.</p><Link to="/app/find" className="btn btn-ember btn-sm">Find leads</Link></div>
      ) : visible.length === 0 ? (
        <div className="card empty"><p className="muted">No company matches these filters.</p>
          <button className="btn btn-line btn-sm" onClick={() => setF({ ...NO_FILTERS, sort: f.sort, dir: f.dir })}>Clear filters</button></div>
      ) : (
        <div className="card table-wrap">
          <table className="dense rows-click prospects">
            <thead><tr>
              <th scope="col" className="col-check"><input type="checkbox" aria-label="Select all shown" checked={allVisible}
                ref={(el) => { if (el) el.indeterminate = !allVisible && visible.some((r) => sel.has(r.id)); }} onChange={toggleAll} /></th>
              {sortTh("name", "Company", "w-co")}<th scope="col" className="w-ct m-hide">Contact</th><th scope="col" className="w-em m-hide">Email</th>
              <th scope="col" className="w-ph m-hide">Phone</th>{sortTh("score", "Score", "r w-sc")}{sortTh("status", "Status", "w-st")}{sortTh("updated", "Updated", "w-up m-hide")}
            </tr></thead>
            <tbody>
              {visible.map((p) => {
                const person = bestPerson(p.people), email = bestEmail(p), phone = p.phone ?? p.phones?.[0];
                return (
                  <tr key={p.id} className={sel.has(p.id) ? "row-on" : ""} onClick={() => setOpenId(p.id)}>
                    <td className="col-check" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select ${p.company_name}`} checked={sel.has(p.id)} onChange={() => toggle(p.id)} /></td>
                    <td><button type="button" id={`p-${p.id}`} className="rowlink cell-main clamp" onClick={(e) => { e.stopPropagation(); setOpenId(p.id); }}>{p.company_name}</button>
                      {p.domain !== p.company_name && <div className="small clamp">{p.domain ?? [p.city, p.country].filter(Boolean).join(", ")}</div>}</td>
                    <td className="m-hide">{person ? <><div className="clamp">{person.name}</div><div className="small clamp">{person.title}</div></> : <span className="faint">—</span>}</td>
                    <td className="m-hide">{email ? <span className="cell-email"><span className="clamp">{email.email}</span><EmailTag status={email.status} /></span> : <span className="faint">—</span>}</td>
                    <td className="num nowrap m-hide">{phone || <span className="faint">—</span>}</td>
                    <td className="r">{p.score == null ? <span className="faint">—</span> : <span className={`tag num ${scoreTag(p.score)}`}>{p.score}</span>}</td>
                    <td><StatusTag status={p.status} title={p.error} /></td>
                    <td className="small nowrap m-hide"><time dateTime={p.updated_at} title={new Date(p.updated_at).toLocaleString()}>{when(p.updated_at)}</time></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && <ProspectDrawer key={open.id} p={open} ws={ws} busy={!!run} note={note} patch={patch} onEnrich={() => enrich([open])} onClose={closeDrawer} />}
    </>
  );
}
