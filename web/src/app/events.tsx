// Event signals: who is attending an event, enriched and drafted by the local Python worker (tables gl_events / gl_attendees /
// gl_leads / gl_jobs). The browser only queues jobs and reads rows.
import { useCallback, useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { STAGES, safeUrl, supabase, type Attendee, type EventRow, type Job, type Lead } from "../lib";
import { downloadCsv, errText, type Ws } from "./data";
import { Loading, Notice, PageHead, Table, Tabs } from "./ui";

type Data = { leads: Lead[]; attendees: Attendee[]; events: EventRow[]; jobs: Job[] };

/** `d` is null until the first read succeeds. A failed read never shows as empty tables: the last good data stays, with the error. */
function useData(ws: Ws) {
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const q = (t: string, order: string, asc = false) =>
      supabase.from(t).select("*").eq("workspace_id", ws.id).order(order, { ascending: asc }).limit(1000);
    const [l, a, e, j] = await Promise.all([q("gl_leads", "updated_at"), q("gl_attendees", "attend_score"),
      q("gl_events", "created_at"), supabase.from("gl_jobs").select("*").eq("workspace_id", ws.id)
        .order("created_at", { ascending: false }).limit(20)]);
    const failed = [l, a, e, j].find((r) => r.error);
    if (failed?.error) return setError(failed.error.message);
    setError("");
    setD({ leads: (l.data ?? []) as Lead[], attendees: (a.data ?? []) as Attendee[],
      events: (e.data ?? []) as EventRow[], jobs: (j.data ?? []) as Job[] });
  }, [ws.id]);
  useEffect(() => { load(); }, [load]);
  const busy = !!d?.jobs.some((j) => j.status === "queued" || j.status === "running");
  useEffect(() => {
    const t = setInterval(load, busy ? 4000 : 20000);
    return () => clearInterval(t);
  }, [load, busy]);
  return { d, error, load };
}

/** Queue a run for the worker. Throws when the job was not stored. */
async function queue(ws: Ws, kind: string, payload: Record<string, unknown>) {
  const { data: u, error: authError } = await supabase.auth.getUser();
  if (authError || !u.user) throw new Error(authError?.message ?? "Your session has expired. Sign in again.");
  const { error } = await supabase.from("gl_jobs").insert({ workspace_id: ws.id, kind, payload, created_by: u.user.id });
  if (error) throw new Error(error.message);
}

const JOB_LABEL: Record<string, string> = {
  attendee_search: "Find attendees", pipeline: "Run pipeline", queue_drafts: "Queue in Needle", sync: "Sync Needle",
};

const isBusy = (j?: Job) => !!j && (j.status === "queued" || j.status === "running");

/** Live status of a run: what is happening now, or what the last run produced. */
function JobLine({ job }: { job?: Job }) {
  const [, tick] = useState(0);
  useEffect(() => { if (!isBusy(job)) return; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, [job]);
  if (!job) return null;
  const secs = Math.max(0, Math.round((Date.now() - new Date(job.created_at).getTime()) / 1000));
  const label = JOB_LABEL[job.kind] ?? job.kind;
  if (job.status === "queued") return (
    <p className="jobline"><span className="dot pulse" /> {label}: waiting for the worker · {secs}s
      {secs > 45 && <span className="warn"> · worker offline? Start <code>python -m ghostleads.cloud worker</code></span>}</p>);
  if (job.status === "running") return (
    <p className="jobline"><span className="dot pulse" /> {label}: {job.kind === "attendee_search"
      ? "searching LinkedIn posts and comments, scoring attendance" : "working"} · {secs}s</p>);
  const r = job.result ?? {};
  if (job.status === "failed") return <p className="jobline warn">{label} failed{typeof r.detail === "string" ? `: ${r.detail}` : ""}</p>;
  const parts = [typeof r.attendees === "number" && `${r.attendees} people`, typeof r.leads === "number" && `${r.leads} leads`,
    typeof r.queued === "number" && `${r.queued} queued`].filter(Boolean);
  return <p className="jobline ok">✓ {label} done{parts.length ? ` · ${parts.join(" · ")} updated` : ""}</p>;
}

function Badge({ l }: { l: Lead }) {
  if (l.in_aiark === 0) return <span className="tag tag-ember">Not in AI Ark</span>;
  if (l.in_aiark === 1) return <span className="tag">In AI Ark</span>;
  return <span className="tag">Not checked</span>;
}

function Pipeline({ d }: { d: Data }) {
  const reached = (s: string) => d.leads.filter((l) => STAGES.indexOf(l.stage as typeof STAGES[number]) >= STAGES.indexOf(s as typeof STAGES[number])).length;
  const kpis = [
    { n: d.attendees.length, l: "People found" },
    { n: d.attendees.filter((a) => a.decision === "keep").length, l: "Confirmed attending" },
    { n: d.leads.length, l: "Leads" },
    { n: d.leads.filter((l) => l.in_aiark === 0).length, l: "Not in AI Ark" },
    { n: reached("drafted"), l: "Notes drafted" },
    { n: d.leads.filter((l) => l.needle_status === "sent").length, l: "Sent" },
  ];
  const max = Math.max(1, d.leads.length);
  return (
    <>
      {d.leads.length === 0 && d.attendees.length === 0 && (
        <div className="card empty">
          <h3 className="h3">Start with an event</h3>
          <p className="muted">Add the trade fair or conference your team is attending. Ghost Leads finds who else is going.</p>
          <NavLink to="/app/events/manage" className="btn btn-ember btn-sm">Add your first event</NavLink>
        </div>
      )}
      <div className="kpis">
        {kpis.map((k) => (
          <div key={k.l} className="card kpi"><span className="kpi-n num">{k.n}</span><span className="small">{k.l}</span></div>
        ))}
      </div>
      <div className="grid2">
        <div className="card pad">
          <h3 className="h3">Funnel</h3>
          <div className="funnel">
            {STAGES.slice(0, 6).map((s) => (
              <div key={s} className="funnel-row">
                <span className="funnel-l">{s}</span>
                <span className="funnel-bar"><span style={{ width: `${(reached(s) / max) * 100}%` }} /></span>
                <span className="num funnel-n">{reached(s)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card pad">
          <h3 className="h3">Recent activity</h3>
          {d.jobs.length === 0 ? <p className="muted small">No runs yet.</p> : (
            <ul className="jobs">
              {d.jobs.slice(0, 8).map((j) => (
                <li key={j.id}>
                  <span>{JOB_LABEL[j.kind] ?? j.kind}{typeof j.payload?.event === "string" ? ` · ${j.payload.event}` : ""}</span>
                  <span className={`tag ${j.status === "done" ? "tag-ok" : j.status === "failed" ? "tag-err" : "tag-ember"}`}>
                    {j.status === "queued" || j.status === "running" ? <span className="dot pulse" /> : null}{j.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

function Events({ d, ws, reload }: { d: Data; ws: Ws; reload: () => void }) {
  const [f, setF] = useState({ name: "", city: "", start_date: "", end_date: "", url: "", terms: "" });
  const [err, setErr] = useState("");
  const [runErr, setRunErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function add(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    const search_terms = f.terms.split("\n").map((t) => t.trim()).filter(Boolean);
    const { error } = await supabase.from("gl_events").insert({
      workspace_id: ws.id, name: f.name.trim(), city: f.city || null, start_date: f.start_date || null,
      end_date: f.end_date || null, url: f.url || null,
      search_terms: search_terms.length ? search_terms : [`"${f.name.trim()}" see you`, `"${f.name.trim()}" attending`],
    });
    if (error) return setErr(error.code === "23505"
      ? "That event name is already used by another workspace. Add your company or city, e.g. “Web Summit 2026 · Acme”."
      : error.message);
    setF({ name: "", city: "", start_date: "", end_date: "", url: "", terms: "" });
    reload();
  }
  const run = async (kind: string, payload: Record<string, unknown>) => {
    setRunErr("");
    try { await queue(ws, kind, payload); } catch (e) { setRunErr(`Could not start “${JOB_LABEL[kind] ?? kind}”: ${errText(e)}`); }
    reload();
  };
  // latest job per event, so each card shows live progress
  const lastJob = (name: string) => d.jobs.find((j) => j.payload?.event === name
    || (Array.isArray(j.payload?.events) && (j.payload.events as string[]).includes(name)));
  return (
    <div className="grid2 grid-events">
      <div className="stack">
        {runErr && <Notice kind="err">{runErr}</Notice>}
        {d.events.length === 0 && <div className="card empty"><p className="muted">No events yet. Add one to start.</p></div>}
        {d.events.map((ev) => {
          const n = d.attendees.filter((a) => a.event_name === ev.name).length;
          const leads = d.leads.filter((l) => l.event_name === ev.name).length;
          return (
            <div key={ev.id} className="card pad event">
              <div>
                <h3 className="h3">{ev.name}</h3>
                <p className="small">{[ev.city, ev.start_date && `${ev.start_date}${ev.end_date && ev.end_date !== ev.start_date ? ` – ${ev.end_date}` : ""}`].filter(Boolean).join(" · ") || "No date set"}</p>
                <p className="small">{n} people · {leads} leads</p>
                <JobLine job={lastJob(ev.name)} />
              </div>
              <div className="event-actions">
                <button className="btn btn-ember btn-sm" disabled={isBusy(lastJob(ev.name))}
                  onClick={() => run("attendee_search", { event: ev.name, limit: 10 })}>Find attendees</button>
                <button className="btn btn-line btn-sm" disabled={isBusy(lastJob(ev.name))}
                  onClick={() => run("pipeline", { events: [ev.name] })}>Enrich &amp; draft</button>
              </div>
            </div>
          );
        })}
        {d.events.length > 0 && (
          <button className="btn btn-line btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => run("sync", {})}>Sync status from Needle</button>
        )}
      </div>
      <form className="card pad stack" onSubmit={add}>
        <h3 className="h3">Add an event</h3>
        <label className="field"><span className="label">Name</span><input className="input" required maxLength={120} value={f.name} onChange={set("name")} placeholder="Web Summit 2026" /></label>
        <div className="row2">
          <label className="field"><span className="label">City</span><input className="input" value={f.city} onChange={set("city")} placeholder="Lisbon" /></label>
          <label className="field"><span className="label">Website</span><input className="input" type="url" value={f.url} onChange={set("url")} placeholder="https://" /></label>
        </div>
        <div className="row2">
          <label className="field"><span className="label">Starts</span><input className="input" type="date" value={f.start_date} onChange={set("start_date")} /></label>
          <label className="field"><span className="label">Ends</span><input className="input" type="date" value={f.end_date} onChange={set("end_date")} /></label>
        </div>
        <label className="field"><span className="label">Search terms (one per line, optional)</span>
          <textarea className="input" value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} placeholder={'"Web Summit" Lisbon see you\n#WebSummit2026'} /></label>
        {err && <div className="notice notice-err" role="alert">{err}</div>}
        <button className="btn btn-ember">Add event</button>
      </form>
    </div>
  );
}

function Attendees({ d }: { d: Data }) {
  const [f, setF] = useState("keep");
  const rows = d.attendees.filter((a) => f === "all" || a.decision === f);
  return (
    <>
      <p className="muted sub-note">People who said they are going. Kept = both AI scores 70+; dropped posts keep their reason.</p>
      <Tabs value={f} onChange={setF} items={[["keep", "Kept"], ["review", "Review"], ["discard", "Dropped"], ["all", "All"]]} label="Decision" />
      <Table empty="No attendees yet. Run “Find attendees” on an event." head={["Person", "Signal", "Scores", "Why", ""]}>
        {rows.map((a) => (
          <tr key={a.id}>
            <td><div className="cell-main">{a.person_name}</div><div className="small clamp">{a.headline}</div></td>
            <td><span className="tag">{a.signal}</span></td>
            <td className="num small">{a.event_score} / {a.attend_score}</td>
            <td className="small clamp2">{a.reason}</td>
            <td className="links">{safeUrl(a.linkedin_url) && <a className="link" href={safeUrl(a.linkedin_url)} target="_blank" rel="noreferrer">Profile</a>}
              {safeUrl(a.post_url) && <a className="link" href={safeUrl(a.post_url)} target="_blank" rel="noreferrer">Post</a>}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}

const LEAD_COLS = ["event_name", "company_name", "domain", "owner_name", "owner_title", "linkedin_url", "email", "email_status", "in_aiark", "stage", "needle_status"];

function Leads({ d }: { d: Data }) {
  return (
    <>
      <div className="sub-row">
        <p className="muted sub-note">Companies and the person to contact. Not checked means AI Ark could not be asked yet; it never counts as a ghost.</p>
        <button className="btn btn-line btn-sm" onClick={() => downloadCsv("ghost-leads.csv", LEAD_COLS, d.leads)} disabled={!d.leads.length}>Export CSV</button>
      </div>
      <Table empty="No leads yet." head={["Person", "Company", "AI Ark", "Email", "Stage"]}>
        {d.leads.map((l) => (
          <tr key={l.id}>
            <td><div className="cell-main">{safeUrl(l.linkedin_url) ? <a className="link" href={safeUrl(l.linkedin_url)} target="_blank" rel="noreferrer">{l.owner_name ?? "—"}</a> : l.owner_name ?? "—"}</div><div className="small clamp">{l.owner_title}</div></td>
            <td><div className="cell-main">{l.company_name}</div><div className="small">{l.domain} · {l.event_name}</div></td>
            <td><Badge l={l} /></td>
            <td className="small">{l.email ? <>{l.email} {l.email_status === "valid" && <span className="tag tag-ok">valid</span>}</> : "—"}</td>
            <td><span className="tag">{l.stage}</span></td>
          </tr>
        ))}
      </Table>
    </>
  );
}

function Messages({ d, ws, reload }: { d: Data; ws: Ws; reload: () => void }) {
  const drafted = d.leads.filter((l) => l.message);
  const [edit, setEdit] = useState<Record<number, string>>({});
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  /** Store the edited note. False (with the reason shown) when it was not saved. */
  async function store(l: Lead) {
    const { error } = await supabase.from("gl_leads").update({ message: edit[l.id] }).eq("id", l.id);
    if (error) setNote({ kind: "err", text: `Could not save the note for ${l.owner_name ?? l.company_name ?? "this lead"}: ${error.message}` });
    return !error;
  }
  async function save(l: Lead) {
    if (await store(l)) setNote({ kind: "ok", text: "Saved." });
    reload();
  }
  async function approve(l: Lead) {
    // the worker drafts from the stored text: if the edit is not saved, queueing would send the old note
    if (edit[l.id] !== undefined && edit[l.id] !== l.message && !(await store(l))) return;
    try {
      await queue(ws, "queue_drafts", { lead_ids: [{ event_name: l.event_name, domain: l.domain }] });
      setNote({ kind: "ok", text: `Queued for ${l.owner_name ?? l.company_name ?? "this lead"}. It lands in your Needle inbox; nothing sends until you approve it there.` });
    } catch (e) {
      setNote({ kind: "err", text: `Not queued: ${errText(e)}` });
    }
    reload();
  }
  return (
    <>
      <p className="muted sub-note">Edit any note, then approve it. Approved notes become drafts in your Needle inbox for a final review.</p>
      {note && <Notice kind={note.kind}>{note.text}</Notice>}
      {drafted.length === 0 && <div className="card empty"><p className="muted">No notes yet. Run “Enrich &amp; draft” on an event.</p></div>}
      <div className="stack">
        {drafted.map((l) => {
          const text = edit[l.id] ?? l.message ?? "";
          return (
            <div key={l.id} className="card pad msg">
              <div className="msg-head">
                <div><span className="cell-main">{l.owner_name}</span> <span className="small">· {l.owner_title ? `${l.owner_title}, ` : ""}{l.company_name}</span></div>
                <span className={`tag ${l.needle_status === "sent" ? "tag-ok" : ""}`}>{l.needle_status === "pending" ? l.stage : l.needle_status}</span>
              </div>
              <textarea className="input" aria-label={`Note for ${l.owner_name ?? l.company_name ?? "lead"}`} maxLength={300} value={text} onChange={(e) => setEdit({ ...edit, [l.id]: e.target.value })} />
              <div className="msg-foot">
                <span className={`small num ${text.length > 200 ? "warn" : ""}`}>{text.length}/200</span>
                <div className="event-actions">
                  <button className="btn btn-line btn-sm" disabled={edit[l.id] === undefined || edit[l.id] === l.message} onClick={() => save(l)}>Save</button>
                  <button className="btn btn-ember btn-sm" disabled={l.stage !== "drafted" || l.needle_status !== "pending" || text.length > 300} onClick={() => approve(l)}>Approve &amp; queue</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function EventSignals({ ws }: { ws: Ws }) {
  const { d, error, load } = useData(ws);
  const msgs = (d?.leads ?? []).filter((l) => l.stage === "drafted" && l.needle_status === "pending").length;
  const tabs: [string, string, number?][] = [["", "Pipeline"], ["manage", "Events"], ["attendees", "Attendees"], ["leads", "Leads"], ["messages", "Messages", msgs]];
  return (
    <>
      <PageHead title="Event signals" sub="Find who is attending a trade fair or conference and reach them before it starts. Runs are processed by your local Ghost Leads worker." />
      <nav className="subnav" aria-label="Event signals">
        {tabs.map(([p, l, n]) => (
          <NavLink key={l} end to={p ? `/app/events/${p}` : "/app/events"} className={({ isActive }) => `subnav-link ${isActive ? "on" : ""}`}>
            {l}{n ? <span className="side-count num">{n}</span> : null}
          </NavLink>
        ))}
      </nav>
      {error && <Notice kind="err">Could not load event data: {error}</Notice>}
      {!d ? (!error && <Loading />) : <Routes>
        <Route index element={<Pipeline d={d} />} />
        <Route path="manage" element={<Events d={d} ws={ws} reload={load} />} />
        <Route path="attendees" element={<Attendees d={d} />} />
        <Route path="leads" element={<Leads d={d} />} />
        <Route path="messages" element={<Messages d={d} ws={ws} reload={load} />} />
      </Routes>}
    </>
  );
}
