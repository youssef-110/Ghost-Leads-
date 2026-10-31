import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { Logo } from "./Landing";
import { STAGES, safeUrl, supabase, type Attendee, type EventRow, type Job, type Lead } from "./lib";
import "./app.css";

type Ws = { id: string; name: string };
type Data = { leads: Lead[]; attendees: Attendee[]; events: EventRow[]; jobs: Job[] };
const EMPTY: Data = { leads: [], attendees: [], events: [], jobs: [] };

function useWorkspace(session: Session | null) {
  const [ws, setWs] = useState<Ws | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data } = await supabase.from("gl_workspaces").select("id,name").order("created_at").limit(1);
      if (data?.length) setWs(data[0]);
      else {
        // first sign-in: create the company workspace from the name given at sign-up
        const name = (session.user.user_metadata?.company as string | undefined)?.trim() || session.user.email?.split("@")[1] || "My company";
        const created = await supabase.from("gl_workspaces").insert({ name }).select("id,name").single();
        if (created.data) setWs(created.data);
      }
      setReady(true);
    })();
  }, [session]);
  return { ws, ready };
}

function useData(ws: Ws | null) {
  const [d, setD] = useState<Data>(EMPTY);
  const load = useCallback(async () => {
    if (!ws) return;
    const q = (t: string, order: string, asc = false) =>
      supabase.from(t).select("*").eq("workspace_id", ws.id).order(order, { ascending: asc }).limit(1000);
    const [l, a, e, j] = await Promise.all([q("gl_leads", "updated_at"), q("gl_attendees", "attend_score"),
      q("gl_events", "created_at"), supabase.from("gl_jobs").select("*").eq("workspace_id", ws.id)
        .order("created_at", { ascending: false }).limit(20)]);
    setD({ leads: (l.data ?? []) as Lead[], attendees: (a.data ?? []) as Attendee[],
      events: (e.data ?? []) as EventRow[], jobs: (j.data ?? []) as Job[] });
  }, [ws]);
  useEffect(() => { load(); }, [load]);
  const busy = d.jobs.some((j) => j.status === "queued" || j.status === "running");
  useEffect(() => {
    const t = setInterval(load, busy ? 4000 : 20000);
    return () => clearInterval(t);
  }, [load, busy]);
  return { d, load };
}

async function queue(ws: Ws, kind: string, payload: Record<string, unknown>) {
  const { data: u } = await supabase.auth.getUser();
  return supabase.from("gl_jobs").insert({ workspace_id: ws.id, kind, payload, created_by: u.user?.id });
}

const JOB_LABEL: Record<string, string> = {
  attendee_search: "Find attendees", pipeline: "Run pipeline", queue_drafts: "Queue in Needle", sync: "Sync Needle",
};

function Badge({ l }: { l: Lead }) {
  if (l.in_aiark === 0) return <span className="tag tag-ember">Not in AI Ark</span>;
  if (l.in_aiark === 1) return <span className="tag">In AI Ark</span>;
  return <span className="tag">Not checked</span>;
}

function Overview({ d, ws }: { d: Data; ws: Ws }) {
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
      <PageHead title={`${ws.name}`} sub="Your event pipeline at a glance. Every number comes from your workspace's rows." />
      {d.leads.length === 0 && d.attendees.length === 0 && (
        <div className="card empty">
          <h3 className="h3">Start with an event</h3>
          <p className="muted">Add the trade fair or conference your team is attending. Ghost Leads finds who else is going.</p>
          <NavLink to="/app/events" className="btn btn-ember">Add your first event</NavLink>
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
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function add(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    const search_terms = f.terms.split("\n").map((t) => t.trim()).filter(Boolean);
    const { error } = await supabase.from("gl_events").insert({
      workspace_id: ws.id, name: f.name.trim(), city: f.city || null, start_date: f.start_date || null,
      end_date: f.end_date || null, url: f.url || null,
      search_terms: search_terms.length ? search_terms : [`"${f.name.trim()}" see you`, `"${f.name.trim()}" attending`],
    });
    if (error) return setErr(error.message);
    setF({ name: "", city: "", start_date: "", end_date: "", url: "", terms: "" });
    reload();
  }
  const run = async (kind: string, payload: Record<string, unknown>) => { await queue(ws, kind, payload); reload(); };
  return (
    <>
      <PageHead title="Events" sub="Each event becomes LinkedIn searches. Runs are processed by your Ghost Leads worker." />
      <div className="grid2 grid-events">
        <div className="stack">
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
                </div>
                <div className="event-actions">
                  <button className="btn btn-ember btn-sm" onClick={() => run("attendee_search", { event: ev.name, limit: 10 })}>Find attendees</button>
                  <button className="btn btn-line btn-sm" onClick={() => run("pipeline", { events: [ev.name] })}>Enrich &amp; draft</button>
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
          {err && <div className="notice notice-err">{err}</div>}
          <button className="btn btn-ember">Add event</button>
        </form>
      </div>
    </>
  );
}

function Attendees({ d }: { d: Data }) {
  const [f, setF] = useState("keep");
  const rows = d.attendees.filter((a) => f === "all" || a.decision === f);
  return (
    <>
      <PageHead title="Attendees" sub="People who said they are going. Kept = both AI scores 70+; dropped posts keep their reason." />
      <Tabs value={f} onChange={setF} items={[["keep", "Kept"], ["review", "Review"], ["discard", "Dropped"], ["all", "All"]]} />
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

function Leads({ d }: { d: Data }) {
  const csv = () => {
    const cols: (keyof Lead)[] = ["event_name", "company_name", "domain", "owner_name", "owner_title", "linkedin_url", "email", "email_status", "in_aiark", "stage", "needle_status"];
    const cell = (v: unknown) => { let s = v == null ? "" : String(v); if (/^[\s]*[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
    const blob = new Blob([[cols.join(","), ...d.leads.map((l) => cols.map((c) => cell(l[c])).join(","))].join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "ghost-leads.csv"; a.click();
  };
  return (
    <>
      <PageHead title="Leads" sub="Companies and the person to contact. Not checked means AI Ark could not be asked yet; it never counts as a ghost."
        action={<button className="btn btn-line btn-sm" onClick={csv} disabled={!d.leads.length}>Export CSV</button>} />
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
  const [note, setNote] = useState("");
  async function save(l: Lead) {
    const { error } = await supabase.from("gl_leads").update({ message: edit[l.id] }).eq("id", l.id);
    setNote(error ? error.message : "Saved."); reload();
  }
  async function approve(l: Lead) {
    if (edit[l.id] !== undefined && edit[l.id] !== l.message) await supabase.from("gl_leads").update({ message: edit[l.id] }).eq("id", l.id);
    await queue(ws, "queue_drafts", { lead_ids: [{ event_name: l.event_name, domain: l.domain }] });
    setNote(`Queued for ${l.owner_name}. It lands in your Needle inbox; nothing sends until you approve it there.`);
    reload();
  }
  return (
    <>
      <PageHead title="Messages" sub="Edit any note, then approve it. Approved notes become drafts in your Needle inbox for a final review." />
      {note && <div className="notice notice-ok" role="status">{note}</div>}
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
              <textarea className="input" maxLength={300} value={text} onChange={(e) => setEdit({ ...edit, [l.id]: e.target.value })} />
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

function PageHead({ title, sub, action }: { title: string; sub: string; action?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div><h1 className="h2" style={{ fontSize: 30 }}>{title}</h1><p className="muted" style={{ margin: "6px 0 0" }}>{sub}</p></div>
      {action}
    </div>
  );
}
function Tabs({ value, onChange, items }: { value: string; onChange: (v: string) => void; items: [string, string][] }) {
  return <div className="tabs" role="tablist">{items.map(([v, l]) => <button key={v} role="tab" aria-selected={value === v} className={`tab ${value === v ? "on" : ""}`} onClick={() => onChange(v)}>{l}</button>)}</div>;
}
function Table({ head, children, empty }: { head: string[]; children: React.ReactNode[]; empty: string }) {
  if (!children.length) return <div className="card empty"><p className="muted">{empty}</p></div>;
  return <div className="card table-wrap"><table><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

export default function AppShell() {
  const nav = useNavigate();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  const { ws, ready } = useWorkspace(session ?? null);
  const { d, load } = useData(ws);
  const counts = useMemo(() => ({ msgs: d.leads.filter((l) => l.stage === "drafted" && l.needle_status === "pending").length }), [d]);

  if (session === undefined) return <div className="loading"><span className="spinner" /></div>;
  if (!session) return <Navigate to="/login" replace />;
  if (!ready || !ws) return <div className="loading"><span className="spinner" /><span className="small">Setting up your workspace…</span></div>;

  const links: [string, string, number?][] = [["", "Overview"], ["events", "Events"], ["attendees", "Attendees"], ["leads", "Leads"], ["messages", "Messages", counts.msgs]];
  return (
    <div className="shell">
      <aside className="side">
        <NavLink to="/" className="side-logo"><Logo /></NavLink>
        <div className="ws-chip"><span className="ws-dot">{ws.name.slice(0, 1).toUpperCase()}</span><span className="clamp">{ws.name}</span></div>
        <nav className="side-nav">
          {links.map(([p, l, n]) => (
            <NavLink key={l} end={p === ""} to={`/app/${p}`} className={({ isActive }) => `side-link ${isActive ? "on" : ""}`}>
              {l}{n ? <span className="side-count num">{n}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <span className="small clamp">{session.user.email}</span>
          <button className="btn btn-ghost btn-sm" onClick={async () => { await supabase.auth.signOut(); nav("/"); }}>Sign out</button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route index element={<Overview d={d} ws={ws} />} />
          <Route path="events" element={<Events d={d} ws={ws} reload={load} />} />
          <Route path="attendees" element={<Attendees d={d} />} />
          <Route path="leads" element={<Leads d={d} />} />
          <Route path="messages" element={<Messages d={d} ws={ws} reload={load} />} />
        </Routes>
      </main>
    </div>
  );
}
