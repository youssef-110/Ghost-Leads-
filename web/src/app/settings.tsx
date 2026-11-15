import { useEffect, useState } from "react";
import { supabase } from "../lib";
import type { Health } from "../../shared/types";
import { api } from "./api";
import { errText, type Ws } from "./data";
import { Notice, PageHead, UsageMeters } from "./ui";

type Props = { ws: Ws; email: string; onRename: (name: string) => void; onSignOut: () => void };

export default function Settings({ ws, email, onRename, onSignOut }: Props) {
  const [name, setName] = useState(ws.name);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [health, setHealth] = useState<Health | string | null>(null);

  useEffect(() => {
    let live = true;
    api.health().then((h) => live && setHealth(h), (e) => live && setHealth(errText(e)));
    return () => { live = false; };
  }, []);

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setMsg(null);
    const next = name.trim();
    const { data, error } = await supabase.from("gl_workspaces").update({ name: next }).eq("id", ws.id).select("id");
    setSaving(false);
    if (error || !data?.length) return setMsg({ kind: "err", text: `Could not rename: ${error?.message ?? "you do not have access to this workspace."}` });
    onRename(next); setName(next);
    setMsg({ kind: "ok", text: "Workspace renamed." });
  }

  return (
    <>
      <PageHead title="Settings" sub="Your workspace, plan and what this deployment can do." />
      <div className="settings">
        <form className="card pad stack" onSubmit={rename}>
          <h2 className="h4">Workspace</h2>
          <label className="field"><span className="label">Name</span>
            <input className="input" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
          {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
          <div><button className="btn btn-ember btn-sm" disabled={saving || !name.trim() || name.trim() === ws.name}>{saving ? "Saving…" : "Save name"}</button></div>
        </form>

        <section className="card pad stack" aria-labelledby="set-plan">
          <div className="card-head"><h2 className="h4" id="set-plan">Plan and usage</h2><span className="tag tag-ember">{ws.plan} plan</span></div>
          <p className="small">Daily limits for the whole workspace. They reset at midnight UTC.</p>
          <UsageMeters ws={ws} />
        </section>

        <section className="card pad stack" aria-labelledby="set-cap">
          <h2 className="h4" id="set-cap">Capabilities</h2>
          {health === null ? <p className="small" role="status">Checking…</p>
            : typeof health === "string" ? <Notice kind="info">Status is not available: {health}</Notice> : (
              <dl className="kv">
                <dt>AI drafting and extraction</dt><dd><span className={`tag ${health.ai ? "tag-ok" : ""}`}>{health.ai ? "On" : "Off"}</span></dd>
                <dt>Search provider</dt><dd>{health.search === "serper" ? "Serper (Google results)" : "Not set up: web search needs SERPER_API_KEY on the server"}</dd>
                <dt>Engine version</dt><dd className="num">{health.version}</dd>
              </dl>
            )}
        </section>

        <section className="card pad stack" aria-labelledby="set-acct">
          <h2 className="h4" id="set-acct">Account</h2>
          <p className="small">Signed in as {email}</p>
          <div><button className="btn btn-line btn-sm" onClick={onSignOut}>Sign out</button></div>
        </section>
      </div>
    </>
  );
}
