import { useEffect, useState, useSyncExternalStore } from "react";
import { Link, useLocation } from "react-router-dom";
import { Logo } from "./Logo";
import { usePageMeta } from "./meta";
import { dailyLimits, type PlanName } from "./plans";

// Placeholder address until the owner sets the real inbox.
const CONTACT = "hello@ghostleads.app";
const mailto = (subject: string) => `mailto:${CONTACT}?subject=${encodeURIComponent(subject)}`;

const NAV = [
  { to: "/#sources", label: "Sources" },
  { to: "/#pipeline", label: "How it works" },
  { to: "/#scrape", label: "Scraper" },
  { to: "/pricing", label: "Pricing" },
];

export function ContactLink({ subject, className, children }: { subject: string; className?: string; children?: React.ReactNode }) {
  return <a href={mailto(subject)} className={className}>{children ?? CONTACT}</a>;
}

// One public page is on screen at a time, so the last location can live outside React.
let last = { pathname: "", key: "", fresh: true };

/** Router navigation does not move the scroll position: go to the #target, or to the top of a new page. */
function useScrollToTarget() {
  const { pathname, hash, key } = useLocation();
  useEffect(() => {
    // A new page jumps; a link within the page scrolls (smoothly, unless the reader asked for less motion).
    // Remembered per location, so a repeated run of this effect for one navigation gives the same answer.
    const fresh = last.key === key ? last.fresh : last.pathname !== pathname;
    last = { pathname, key, fresh };
    const el = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
    // Newer browsers return a promise from scroll calls, and an effect may only return a clean-up: hence the braces.
    if (!el) { window.scrollTo({ top: 0, behavior: fresh ? "instant" : "auto" }); return; }
    if (!fresh) { el.scrollIntoView(); return; }

    // A page that has just loaded is still settling (web fonts, the pinned section's spacer),
    // so hold the target in place until the layout stops changing or the reader takes over.
    const jump = () => el.scrollIntoView({ behavior: "instant" });
    jump();
    const watch = new ResizeObserver(jump);
    watch.observe(document.body);
    const stop = () => watch.disconnect();
    const timer = setTimeout(stop, 2500);
    const takeover = ["wheel", "touchstart", "keydown", "pointerdown"];
    takeover.forEach((name) => window.addEventListener(name, stop, { once: true, passive: true }));
    return () => {
      stop();
      clearTimeout(timer);
      takeover.forEach((name) => window.removeEventListener(name, stop));
    };
  }, [pathname, hash, key]);
}

const onScroll = (notify: () => void) => {
  window.addEventListener("scroll", notify, { passive: true });
  return () => window.removeEventListener("scroll", notify);
};

function SiteNav() {
  const { key } = useLocation();
  // Storing the location the menu was opened on closes it on any navigation, without an effect.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === key;
  const scrolled = useSyncExternalStore(onScroll, () => window.scrollY > 4);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenAt(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="nav" data-scrolled={scrolled || undefined} data-open={open || undefined}>
      <div className="frame nav-in">
        <Link to="/" aria-label="Ghost Leads home"><Logo /></Link>
        <nav className="nav-links" aria-label="Main">
          {NAV.map((n) => <Link key={n.to} to={n.to}>{n.label}</Link>)}
        </nav>
        <div className="nav-cta">
          <Link to="/login" className="nav-signin">Sign in</Link>
          <Link to="/signup" className="btn btn-ink btn-sm">Start free</Link>
          <button
            type="button" className="nav-toggle" aria-expanded={open} aria-controls="nav-menu"
            aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpenAt(open ? null : key)}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
              <path className="bar bar-a" d="M2 6h14" /><path className="bar bar-b" d="M2 12h14" />
            </svg>
          </button>
        </div>
      </div>
      <nav id="nav-menu" className="nav-menu" aria-label="Mobile" hidden={!open}>
        {NAV.map((n) => <Link key={n.to} to={n.to}>{n.label}</Link>)}
        <Link to="/login">Sign in</Link>
      </nav>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="footer">
      <div className="frame footer-in">
        <div className="footer-brand">
          <Logo dark />
          <p className="foot-muted">Lead finding and web scraping for B2B teams. Every value links to the page it came from.</p>
        </div>
        <nav className="foot-cols" aria-label="Footer">
          <div>
            <h2>Product</h2>
            <Link to="/#sources">Sources</Link>
            <Link to="/#pipeline">How it works</Link>
            <Link to="/#scrape">Scraper</Link>
            <Link to="/pricing">Pricing</Link>
          </div>
          <div>
            <h2>Account</h2>
            <Link to="/login">Sign in</Link>
            <Link to="/signup">Start free</Link>
          </div>
          <div>
            <h2>Trust</h2>
            <Link to="/#principles">Principles</Link>
            <Link to="/bot">About our crawler</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <a href={mailto("Ghost Leads")}>{CONTACT}</a>
          </div>
        </nav>
      </div>
      <div className="frame footer-base">
        <span>© {new Date().getFullYear()} Ghost Leads</span>
        <span>Public business data only. Nothing sends without human approval.</span>
      </div>
    </footer>
  );
}

/** Page shell shared by every public page. Without a title and description the page keeps the ones in index.html. */
export function SitePage({ path, title, description, children }: { path: string; title?: string; description?: string; children: React.ReactNode }) {
  useScrollToTarget();
  usePageMeta(path, title, description);
  return (
    <div className="site">
      <a href="#main" className="skip">Skip to content</a>
      <SiteNav />
      <main id="main">{children}</main>
      <SiteFooter />
    </div>
  );
}

/** A value only the owner can supply. Shown in brackets so nobody mistakes it for a fact. */
export function Ph({ children }: { children: React.ReactNode }) {
  return <mark className="ph">[{children}]</mark>;
}

/** Banner for a legal page that nobody qualified has signed off yet. */
export function DraftNotice({ children }: { children: React.ReactNode }) {
  return <p className="notice" role="note"><b>Draft</b>{children}</p>;
}

const PLANS: { name: PlanName; price: string; note: string; cta: React.ReactNode }[] = [
  { name: "Free", price: "€0", note: "Daily limits, no card.", cta: <Link to="/signup" className="btn btn-ink">Start free</Link> },
  { name: "Pro", price: "Custom", note: "For people building lists every day.", cta: <a href={mailto("Ghost Leads Pro")} className="btn btn-line">Talk to us</a> },
  { name: "Team", price: "Custom", note: "For teams that share the work.", cta: <a href={mailto("Ghost Leads Team")} className="btn btn-line">Talk to us</a> },
];

/** The three plan cards. `as` is the heading level that fits the page they sit on. */
export function Plans({ as: Name = "h3" }: { as?: "h2" | "h3" }) {
  return (
    <div className="plans">
      {PLANS.map((p) => (
        <section key={p.name} className="plan" aria-label={`${p.name} plan`}>
          <Name className="plan-name">{p.name}</Name>
          <p className="plan-price num">{p.price}</p>
          <p className="plan-note">{p.note}</p>
          <ul className="ticks">
            {dailyLimits(p.name).map(([n, label]) => <li key={label}><span className="num">{n}</span> {label} a day</li>)}
            <li>CSV export</li>
          </ul>
          {p.cta}
        </section>
      ))}
    </div>
  );
}

export function Faq({ items }: { items: { q: string; a: React.ReactNode }[] }) {
  return (
    <div className="faq">
      {items.map((f) => (
        <details key={f.q}>
          <summary>{f.q}<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M7 1v12M1 7h12" /></svg></summary>
          <div className="faq-a">{f.a}</div>
        </details>
      ))}
    </div>
  );
}
