import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { Logo } from "./Landing";
import { supabase } from "./lib";
import type { Ws } from "./app/data";
import EventSignals from "./app/events";
import Find from "./app/find";
import { ListDetail, Lists } from "./app/lists";
import Overview from "./app/overview";
import Scraper from "./app/scraper";
import Settings from "./app/settings";
import "./app.css";

function useWorkspace(session: Session | null) {
  const [ws, setWs] = useState<Ws | null>(null);
  const [error, setError] = useState("");
  // keyed on the user, not the session object: a token refresh hands out a new session for the same person
  const user = session?.user, uid = user?.id;
  const name = (user?.user_metadata?.company as string | undefined)?.trim() || user?.email?.split("@")[1] || "My company";
  useEffect(() => {
    if (!uid) return;
    let live = true;
    // find-or-create in one server-side call, so two tabs or a re-run can never make a second workspace
    supabase.rpc("gl_my_workspace", { p_name: name }).then(({ data, error }) => {
      if (!live) return;
      const row = (Array.isArray(data) ? data[0] : data) as Ws | null | undefined;
      if (error || !row?.id) setError(error?.message || "No workspace was returned for your account.");
      else { setWs({ id: row.id, name: row.name, plan: row.plan }); setError(""); }
    });
    return () => { live = false; };
  }, [uid, name]);
  return { ws, setWs, error };
}

const ICONS: Record<string, string> = {
  overview: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  find: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
  lists: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  scraper: "M4 5h16v14H4zM4 10h16M10 5v14",
  events: "M5 6h14v14H5zM5 10h14M9 3v5M15 3v5",
  settings: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
};
const LINKS: [path: string, label: string, short: string, icon: string][] = [
  ["", "Overview", "Overview", "overview"], ["find", "Find leads", "Find", "find"], ["lists", "Lists", "Lists", "lists"],
  ["scraper", "Scraper", "Scraper", "scraper"], ["events", "Event signals", "Events", "events"], ["settings", "Settings", "Settings", "settings"],
];

export default function AppShell() {
  const nav = useNavigate();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  const { ws, setWs, error } = useWorkspace(session ?? null);
  const signOut = async () => { await supabase.auth.signOut(); nav("/"); };

  if (session === undefined) return <div className="loading" role="status"><span className="spinner" /></div>;
  if (!session) return <Navigate to="/login" replace />;
  if (error) return (
    <div className="loading">
      <div className="notice notice-err" role="alert">Could not load your workspace: {error}</div>
      <button className="btn btn-line btn-sm" onClick={() => location.reload()}>Try again</button>
      <button className="btn btn-ghost btn-sm" onClick={signOut}>Sign out</button>
    </div>
  );
  if (!ws) return <div className="loading" role="status"><span className="spinner" /><span className="small">Setting up your workspace…</span></div>;

  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to content</a>
      <aside className="side">
        <NavLink to="/" className="side-logo" aria-label="Ghost Leads home"><Logo /></NavLink>
        <div className="ws-chip" title={ws.name}><span className="ws-dot" aria-hidden="true">{ws.name.slice(0, 1).toUpperCase()}</span><span className="clamp">{ws.name}</span></div>
        <nav className="side-nav" aria-label="Product">
          {LINKS.map(([p, label, short, icon]) => (
            <NavLink key={p} end={p === ""} to={p ? `/app/${p}` : "/app"} className={({ isActive }) => `side-link ${isActive ? "on" : ""}`}>
              <svg className="side-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[icon]} /></svg>
              <span className="side-label">{label}</span><span className="side-short">{short}</span>
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <span className="small clamp" title={session.user.email}>{session.user.email}</span>
          <button className="btn btn-ghost btn-sm" onClick={signOut}>Sign out</button>
        </div>
      </aside>
      {/* one polite live region for the whole app; announce() in app/data.ts writes to it */}
      <div id="gl-live" className="sr" role="status" aria-live="polite" />
      <main className="main" id="main">
        <Routes>
          <Route index element={<Overview ws={ws} />} />
          <Route path="find" element={<Find ws={ws} />} />
          <Route path="lists" element={<Lists ws={ws} />} />
          <Route path="lists/:id" element={<ListDetail ws={ws} />} />
          <Route path="scraper" element={<Scraper ws={ws} />} />
          <Route path="events/*" element={<EventSignals ws={ws} />} />
          <Route path="settings" element={<Settings ws={ws} email={session.user.email ?? ""} onRename={(name) => setWs({ ...ws, name })} onSignOut={signOut} />} />
          {/* links from before the event pipeline moved under Event signals */}
          {["attendees", "leads", "messages"].map((p) => <Route key={p} path={p} element={<Navigate to={`/app/events/${p}`} replace />} />)}
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </main>
    </div>
  );
}
