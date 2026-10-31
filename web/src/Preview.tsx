import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Logo } from "./Landing";
import "./preview.css";

const stages = [
  { title: "Find attendees", detail: "Needle post search and comments surfaced 67 people for the Web Summit 2026 run. An AI attendance filter kept 37 based on their event signals.", metric: "37 kept / 67 found" },
  { title: "Qualify & enrich", detail: "21 attendees were promoted to leads. Contact enrichment and verification happen in the local workbench. An AI Ark check can be blocked by plan access; unchecked leads are not counted as ghosts.", metric: "21 promoted" },
  { title: "Draft & review", detail: "23 local draft references were recorded, but remote queue status is unverified; 22 involve AI Ark-unchecked rows and are not approved prospects. The local record shows zero sends. Any future outreach requires eligibility recheck and human review of the exact recipient and text; Needle approval and sending require a separate review.", metric: "23 local draft references / 0 recorded sent" },
] as const;

export default function Preview() {
  const [active, setActive] = useState(0);
  const { pathname } = useLocation();
  const accountPath = pathname === "/login" || pathname === "/signup";
  const step = stages[active];

  return (
    <div className="preview-page">
      <header className="preview-nav wrap">
        <Link to="/" aria-label="Ghost Leads home"><Logo /></Link>
        <Link className="btn btn-line btn-sm" to="/">Back to website</Link>
      </header>
      <main className="wrap preview-main">
        <span className="eyebrow">Recorded run · Web Summit 2026</span>
        <h1 className="display">Inside the pipeline.</h1>
        <p className="lead preview-intro">Explore how the local Ghost Leads workbench went from event signals to reviewed outreach drafts. This is a read-only website, not a connected dashboard.</p>
        {accountPath && (
          <div className="preview-notice" role="status">
            <strong>Accounts are not available on this website.</strong> There is no live sign-in or signup here. You can explore the recorded run below without entering any information.
          </div>
        )}
        <div className="preview-grid">
          <nav className="preview-stages" aria-label="Pipeline stages">
            {stages.map((stage, index) => (
              <button key={stage.title} className={`preview-stage ${index === active ? "is-active" : ""}`}
                type="button" onClick={() => setActive(index)} aria-current={index === active ? "step" : undefined}>
                <span className="num">0{index + 1}</span>
                <span>{stage.title}</span>
                <span aria-hidden="true">→</span>
              </button>
            ))}
          </nav>
          <section className="preview-detail card" aria-live="polite">
            <span className="eyebrow">Stage 0{active + 1}</span>
            <h2 className="h2">{step.title}</h2>
            <p className="lead">{step.detail}</p>
            <div className="preview-metric"><strong className="num">{step.metric}</strong><span>Recorded run, not live data</span></div>
          </section>
        </div>
        <aside className="preview-notice">
          <strong>What is live?</strong> This website and its interactive walkthrough. The working pipeline currently runs in a local Python/Streamlit workbench; this page does not connect to it, create accounts, run jobs, approve drafts, or send messages.
        </aside>
      </main>
      <footer className="preview-footer wrap"><Link to="/">← Back to Ghost Leads</Link><span>Human review before any outreach.</span></footer>
    </div>
  );
}
