import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Logo } from "./Landing";
import { supabase } from "./lib";
import "./app.css";

export default function Auth({ mode }: { mode: "login" | "signup" }) {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);
  const signup = mode === "signup";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (signup) {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { data: { company }, emailRedirectTo: `${location.origin}/app` },
        });
        if (error) throw error;
        if (!data.session) {
          setMsg({ kind: "ok", text: "Check your inbox to confirm your email, then sign in. Your workspace is created on first sign-in." });
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      nav("/app");
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : "Something went wrong" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-side">
        <Link to="/"><Logo dark /></Link>
        <div>
          <h2 className="auth-quote">Walk into your next event with the guest list already qualified.</h2>
          <p className="foot-muted">Every lead links back to its source. Nothing sends without your approval.</p>
        </div>
        <span className="foot-muted small">Ghost Leads · GTM Hackathon Berlin 2026</span>
      </div>
      <main className="auth-main">
        <form className="auth-form" onSubmit={submit}>
          <h1 className="h2" style={{ fontSize: 32 }}>{signup ? "Create your workspace" : "Welcome back"}</h1>
          <p className="muted" style={{ margin: "8px 0 28px" }}>
            {signup ? "One workspace per company. Invite your team later." : "Sign in to your company workspace."}
          </p>
          {signup && (
            <label className="field">
              <span className="label">Company</span>
              <input className="input" required maxLength={120} value={company} onChange={(e) => setCompany(e.target.value)}
                placeholder="Acme GmbH" autoComplete="organization" />
            </label>
          )}
          <label className="field">
            <span className="label">Work email</span>
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com" autoComplete="email" />
          </label>
          <label className="field">
            <span className="label">Password</span>
            <input className="input" type="password" required minLength={8} value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters"
              autoComplete={signup ? "new-password" : "current-password"} />
          </label>
          {msg && <div className={`notice ${msg.kind === "err" ? "notice-err" : "notice-ok"}`} role="status">{msg.text}</div>}
          <button className="btn btn-ember" style={{ width: "100%", marginTop: 8 }} disabled={busy}>
            {busy ? "One moment…" : signup ? "Create workspace" : "Sign in"}
          </button>
          <p className="small" style={{ textAlign: "center", marginTop: 20 }}>
            {signup ? <>Already have an account? <Link to="/login" className="link">Sign in</Link></>
              : <>New to Ghost Leads? <Link to="/signup" className="link">Create a workspace</Link></>}
          </p>
        </form>
      </main>
    </div>
  );
}
