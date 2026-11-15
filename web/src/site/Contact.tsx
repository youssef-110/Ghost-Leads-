import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib";
import { SitePage } from "./chrome";
import "../landing.css";

const TOPICS = ["General", "Ghost Leads Pro", "Ghost Leads Team", "GhostLeadsBot opt-out", "Data removal", "Privacy", "Terms"];

export default function Contact() {
  const [params] = useSearchParams();
  const asked = params.get("topic") ?? "";
  const [f, setF] = useState({ email: "", topic: TOPICS.includes(asked) ? asked : "General", message: "", website: "" });
  const [state, setState] = useState<"idle" | "busy" | "sent" | string>("idle");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (f.website) return setState("sent"); // honeypot field: people never see it, form-filling bots do
    setState("busy");
    // shortcut: no rate limit on this public form, add a captcha or an edge limit if spam shows up
    const { error } = await supabase.from("gl_contact").insert({ email: f.email.trim(), topic: f.topic, message: f.message.trim() });
    setState(error ? "That did not send. Check the email address and try again." : "sent");
  }

  return (
    <SitePage path="/contact" title="Contact Ghost Leads" description="Ask about Pro and Team plans, opt a website out of GhostLeadsBot, or request removal of your business data.">
      <article className="doc">
        <div className="frame doc-in">
          <header className="doc-head">
            <h1 className="doc-h">Contact us</h1>
            <p className="hero-sub">Plans, crawler opt-outs and data removal requests all land in the same inbox. We reply to the address you give.</p>
          </header>
          {state === "sent" ? (
            <p className="hero-sub" role="status">Thanks. Your message is in, and we will reply by email.</p>
          ) : (
            <form className="contact-form" onSubmit={send}>
              <label><span className="label">Your email</span>
                <input className="input" type="email" required maxLength={200} autoComplete="email" value={f.email}
                  onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="name@company.example" /></label>
              <label><span className="label">Topic</span>
                <select className="input" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })}>
                  {TOPICS.map((t) => <option key={t}>{t}</option>)}
                </select></label>
              <label><span className="label">Message</span>
                <textarea className="input" required maxLength={4000} rows={6} value={f.message}
                  onChange={(e) => setF({ ...f, message: e.target.value })}
                  placeholder="For an opt-out or removal request, include the website domain." /></label>
              <input className="contact-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website}
                onChange={(e) => setF({ ...f, website: e.target.value })} />
              {state !== "idle" && state !== "busy" && <p className="contact-err" role="alert">{state}</p>}
              <button className="btn btn-ink" disabled={state === "busy"}>{state === "busy" ? "Sending…" : "Send message"}</button>
            </form>
          )}
        </div>
      </article>
    </SitePage>
  );
}
