import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useCountUp, useReveal } from "./lib";
import "./landing.css";

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <span className="logo" style={{ color: dark ? "#fff" : "var(--ink)" }}>
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
        <rect width="22" height="22" rx="6" fill="var(--ember)" />
        <path d="M6 15.5V9.5a5 5 0 0 1 10 0v6l-1.7-1.3-1.6 1.3-1.7-1.3-1.7 1.3-1.6-1.3z" fill="#fff" />
        <circle cx="9.2" cy="10" r="1.1" fill="var(--ember)" />
        <circle cx="12.8" cy="10" r="1.1" fill="var(--ember)" />
      </svg>
      Ghost Leads
    </span>
  );
}

// Fictional examples of the UI, not recorded people, posts, scores, or notes.
const DEMO = [
  { who: "Head of Ops · logistics, 500 people", post: "Excited to be speaking at Web Summit Lisbon this November on AI in supply chains.", ev: 98, go: 96,
    note: "Hi Sara, saw you're speaking on AI in supply chains at Web Summit. Could we grab 15 minutes there?" },
  { who: "Founder · fintech startup", post: "Heading to Web Summit 2026 in Lisbon! Who else is going? Happy to meet.", ev: 100, go: 94,
    note: "Hi Tomás, saw you're heading to Web Summit and open to meeting. Coffee between sessions?" },
  { who: "Sales Director · IT services", post: "Our team is exhibiting at Web Summit, booth details soon. See you in Lisbon!", ev: 97, go: 92,
    note: "Hi Lena, congrats on exhibiting at Web Summit. Could we stop by your booth for 15 minutes?" },
];

function HeroVisual() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((x) => (x + 1) % DEMO.length), 4200);
    return () => clearInterval(t);
  }, []);
  const d = DEMO[i];
  return (
    <div className="hv" aria-label="Illustrative example: a fictional post becomes a lead with a drafted note">
      <div className="hv-grid" aria-hidden />
      <span className="small">Illustrative example · not a real lead</span>
      <div key={i} className="hv-stack">
        <div className="hv-card hv-1">
          <div className="hv-row">
            <span className="avatar" />
            <div><div className="hv-who">{d.who}</div><div className="small">Example post</div></div>
          </div>
          <p className="hv-post">“{d.post}”</p>
        </div>
        <div className="hv-card hv-2">
          <div className="hv-chips">
            <span className="tag">Right event <b className="num">{d.ev}</b></span>
            <span className="tag">Attending <b className="num">{d.go}</b></span>
            <span className="tag tag-ok"><span className="dot" />Kept</span>
          </div>
          <div className="hv-bar"><span style={{ width: `${d.go}%` }} /></div>
        </div>
        <div className="hv-card hv-3">
          <div className="hv-row hv-between">
            <span className="h3" style={{ fontSize: 15 }}>Drafted note</span>
            <span className="tag tag-ember">Example draft</span>
          </div>
          <p className="hv-note">{d.note}</p>
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  const { n, ref } = useCountUp(value);
  return (
    <div className="stat">
      <span ref={ref} className="stat-n num">{n}</span>
      <span className="muted">{label}</span>
    </div>
  );
}

const STEPS = [
  { t: "Pick an event", d: "Name a trade fair or conference. Ghost Leads turns it into searches for posts, hashtags and comments." },
  { t: "Find who is going", d: "Needle reads LinkedIn posts and “see you there” comments. AI keeps only people attending this edition." },
  { t: "Enrich and check", d: "Blitz can enrich contacts. AI Ark checks are needed before calling any company a ghost; blocked or unchecked results stay unconfirmed." },
  { t: "Review the draft", d: "Eligibility must be rechecked and the exact recipient and message reviewed by a person before any draft. Sending requires a separate human review in Needle." },
];

export default function Landing() {
  useReveal();

  return (
    <div className="landing">
      <div className="announce">
        Built at GTM Hackathon Berlin · first live run on Web Summit 2026 <a href="#numbers">See the numbers →</a>
      </div>

      <header className="nav wrap">
        <Link to="/"><Logo /></Link>
        <nav className="nav-links">
          <a href="#how">How it works</a>
          <a href="#proof">Proof</a>
          <a href="#numbers">Results</a>
        </nav>
        <div className="nav-cta">
          <Link to="/app" className="btn btn-ember btn-sm">Explore the run</Link>
        </div>
      </header>

      <section className="hero wrap">
        <div className="hero-copy">
          <span className="eyebrow reveal">Event-led pipeline for B2B teams</span>
          <h1 className="display reveal">Find event signals. Verify the gaps.</h1>
          <p className="lead reveal">
            Ghost Leads searches for people who say they are going to an event, qualifies their signals, and drafts notes
            for human review. Explore the recorded run from our local workbench.
          </p>
          <Link to="/app" className="btn btn-ember reveal hero-link">Explore the recorded run →</Link>
          <a href="#how" className="btn btn-ghost reveal play">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden><circle cx="9" cy="9" r="9" fill="var(--ember)" /><path d="M7.3 5.8v6.4L12.4 9z" fill="#fff" /></svg>
            See how it works
          </a>
        </div>
        <HeroVisual />
      </section>

      <section className="fog band">
        <div className="wrap band-inner">
          <span className="small">Runs on the tools your GTM team already trusts</span>
          <div className="logos">
            <span>Needle</span><span>Blitz</span><span>AI&nbsp;Ark</span><span>OpenAI</span><span>LinkedIn</span>
          </div>
        </div>
      </section>

      <section id="how" className="wrap section">
        <div className="section-head reveal">
          <span className="eyebrow">How it works</span>
          <h2 className="h2">From “see you in Lisbon” to a reviewed draft, in four steps.</h2>
        </div>
        <div className="steps">
          {STEPS.map((s, k) => (
            <div key={s.t} className="card step reveal" style={{ transitionDelay: `${k * 70}ms` }}>
              <span className="step-n num">0{k + 1}</span>
              <h3 className="h3">{s.t}</h3>
              <p className="muted">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="proof" className="wrap section split">
        <div className="reveal">
          <span className="eyebrow">Proof on every lead</span>
          <h2 className="h2">No guesswork. Every lead links back to what they said.</h2>
          <p className="lead" style={{ marginTop: 16 }}>
            Two AI scores per post: is it the right event, and is this person really going. Recaps of last year,
            “wish I could go” and ticket ads are dropped, with the reason logged.
          </p>
          <ul className="checks">
            <li>Keeps posts that score 70 or more on both</li>
            <li>Sends the uncertain middle to a person for review</li>
            <li>Does not count unchecked companies as ghosts</li>
          </ul>
        </div>
        <div className="card proof reveal" aria-label="Illustrative scoring examples, not recorded posts">
          <span className="small">Illustrative scoring examples</span>
          {[
            { q: "Speaking at #WebSummit2026 in Lisbon next week", e: 95, a: 95, r: "Kept" },
            { q: "See you there!", e: 90, a: 85, r: "Kept" },
            { q: "Anyone going to Web Summit?", e: 85, a: 50, r: "Review" },
            { q: "Great memories from Web Summit 2025", e: 20, a: 10, r: "Dropped" },
          ].map((p) => (
            <div key={p.q} className="proof-row">
              <span className="proof-q">“{p.q}”</span>
              <span className="num small">{p.e} / {p.a}</span>
              <span className={`tag ${p.r === "Kept" ? "tag-ok" : p.r === "Review" ? "tag-ember" : ""}`}>{p.r}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="wrap section split split-rev">
        <div className="card approve reveal">
          <div className="hv-row hv-between"><span className="h3" style={{ fontSize: 15 }}>Illustrative review UI</span><span className="small">Example only</span></div>
          {["Saw you're speaking on AI in supply chains…", "Congrats on exhibiting at Web Summit…", "Saw you're heading to Lisbon and open to…"].map((t, k) => (
            <div key={t} className="approve-row">
              <span className="avatar sm" />
              <span className="approve-t">{t}</span>
              <span className={`btn btn-sm ${k === 0 ? "btn-ember" : "btn-line"}`}>{k === 0 ? "Approve" : "Review"}</span>
            </div>
          ))}
        </div>
        <div className="reveal">
          <span className="eyebrow">You stay in control</span>
          <h2 className="h2">A person reviews before anything sends.</h2>
          <p className="lead" style={{ marginTop: 16 }}>
            Notes are short, honest and in the right language: formal German for DACH companies, English otherwise.
            The recorded run has 23 local draft references; remote queue state is not independently verified. 22 references involve AI Ark-unchecked rows and are not approved prospects. This website cannot create drafts, send notes, or book meetings.
          </p>
        </div>
      </section>

      <section id="numbers" className="fog section-band">
        <div className="wrap">
          <div className="section-head reveal">
            <span className="eyebrow">First live run · Web Summit 2026, Lisbon</span>
            <h2 className="h2">Real numbers from one afternoon.</h2>
          </div>
          <div className="stats reveal">
            <Stat value={67} label="people found, authors and commenters" />
            <Stat value={37} label="AI-filtered as likely attending" />
            <Stat value={21} label="attendees promoted to leads" />
            <Stat value={23} label="local draft references; 0 recorded sent" />
          </div>
        </div>
      </section>

      <section className="wrap section cta reveal">
        <h2 className="h2">See what the first run produced.</h2>
        <div className="cta-row">
          <Link to="/app" className="btn btn-ember">Explore the recorded run</Link>
        </div>
      </section>

      <footer className="footer">
        <div className="wrap footer-inner">
          <div>
            <Logo dark />
            <p className="foot-muted" style={{ maxWidth: 320, marginTop: 12 }}>
              Event-led pipeline for B2B teams. Built at GTM Hackathon Berlin, October 2026.
            </p>
          </div>
          <div className="foot-cols">
            <div><b>Product</b><a href="#how">How it works</a><a href="#proof">Proof</a><Link to="/app">Recorded run</Link></div>
            <div><b>Access</b><span>Local workbench; no website accounts yet</span></div>
            <div><b>Principles</b><span>Human approval on every send</span><span>Public professional data only</span></div>
          </div>
        </div>
      </footer>
    </div>
  );
}
