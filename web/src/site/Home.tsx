import { Fragment, useRef, useState } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { ContactLink, Faq, Plans, SitePage } from "./chrome";
import { HeroTable } from "./HeroTable";
import { Pipeline } from "./Pipeline";
import { SITE_URL } from "./meta";
import { dailyLimits } from "./plans";
import "../landing.css";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const HEADLINE = "Lead lists with a source for every cell.";

const SOURCES = [
  ["Local businesses", "A category and a city", "dentists, Lyon", "OpenStreetMap data"],
  ["Web search", "A description of who you want", "industrial 3D printing service Germany", "Company websites in web search results"],
  ["Startups", "An industry, a location, or who is hiring", "developer tools, hiring now", "The open Y Combinator dataset"],
  ["Hiring", "A role", "Head of RevOps", "Public job feeds, for companies with that role open"],
  ["Directory", "The address of any list page", "messe-beispiel.example/exhibitors", "Exhibitor lists, member directories, partner pages"],
];

const PRINCIPLES = [
  ["Every value links to its source", "Each email, phone number and name keeps the page it was found on, one click away."],
  ["Public business data only", "Ghost Leads reads what companies publish about themselves: contact pages, team pages, imprints."],
  ["Respects robots.txt", "When a site tells crawlers to stay out of a page, that page is not fetched."],
  ["Identifies itself", "Every request is sent as GhostLeadsBot/1.0, with a link that explains who is asking and why."],
  ["A person approves every message", "Drafts stay drafts until someone has read them. Nothing sends without human approval."],
  ["Your lists are yours", "Export any list or scraped table as CSV, at any time."],
];

// The free daily limits as a phrase ("N searches, N enrichments, ... and N email checks"), from the limits the product enforces.
const FREE_PARTS = dailyLimits("Free").map(([n, label]) => `${n} ${label}`);
const FREE_DAY = `${FREE_PARTS.slice(0, -1).join(", ")} and ${FREE_PARTS[FREE_PARTS.length - 1]}`;

// Structured data for search engines. Only what is true today: the product, what it is for, and the free plan.
const JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Ghost Leads",
  url: `${SITE_URL}/`,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description: "Finds companies from five public sources, reads each company's own website for business contact details, and keeps a link to the page every value came from. Also turns a list page into a table. Exports CSV.",
  offers: { "@type": "Offer", name: "Free", price: "0", priceCurrency: "EUR", description: `Each day: ${FREE_DAY}. No card needed.` },
});

const FAQ = [
  { q: "Where does the data come from?", a: <p>Company lists come from OpenStreetMap data, web search results, the open Y Combinator dataset, public job feeds, or a list page you point to. Contact details come from each company's own public website. Every value keeps a link to the page it was found on.</p> },
  { q: "What does the email status tell me?", a: <p>Each address gets a status. “MX ok” means the domain has a mail server and the company published the address itself. “Risky” means the address follows a guessed pattern or the domain could not be fully checked. It is a check you can see the reason for, not a promise that someone reads the inbox.</p> },
  { q: "Does Ghost Leads send messages for me?", a: <p>No message goes out on its own. Ghost Leads writes a draft from the facts on the record, and a person reads and approves it before anything is sent.</p> },
  { q: "What can I do on the free plan?", a: <p>Each day: {FREE_DAY}, with CSV export included. <Link to="/pricing">See the plans</Link>.</p> },
  { q: "Can I use this data for outreach where I work?", a: <p>Ghost Leads collects public business contact data and shows you where each value came from. Rules for contacting businesses differ by country, and following the ones that apply to you, such as GDPR and local rules on unsolicited messages, stays your responsibility.</p> },
  { q: "I run a website. How do I keep your crawler out?", a: <p>Add a rule for GhostLeadsBot to your robots.txt and it will stay away. <Link to="/bot">The crawler page</Link> has the exact lines and how to ask for data to be removed.</p> },
];

const SCRAPE_COLS = ["Company", "Booth", "Country", "Website", "Category"];
const SCRAPE_ROWS = [
  ["Muster Maschinenbau AG", "B2.114", "Germany", "muster-mb.example", "CNC"],
  ["Exempel Robotics", "B2.120", "Sweden", "exempel.example", "Cobots"],
  ["Fiktiva Sensors Oy", "B3.008", "Finland", "fiktiva.example", "Sensors"],
  ["Sample Dynamics Ltd", "B3.041", "Ireland", "sampledyn.example", "Motion"],
  ["Platzhalter Pneumatik", "B4.102", "Austria", "platzhalter.example", "Pneumatics"],
];

function ScrapeDemo() {
  const [on, setOn] = useState([true, true, true, true, false]);
  const toggle = (i: number) => setOn((cur) => {
    const next = cur.map((v, k) => (k === i ? !v : v));
    return next.some(Boolean) ? next : cur; // a table needs at least one column
  });
  const cols = SCRAPE_COLS.map((_, i) => i).filter((i) => on[i]);

  return (
    <figure className="scr" data-rise aria-label="Illustrative example of scraping a list page into a table. The exhibitors are not real.">
      <div className="scr-url">
        <span className="q-label">Page</span>
        <span className="mono">https://messe-beispiel.example/exhibitors</span>
      </div>
      <div className="scr-cols" role="group" aria-label="Columns to extract">
        <span className="q-label">Columns</span>
        {SCRAPE_COLS.map((c, i) => (
          <button key={c} type="button" className="chip" aria-pressed={on[i]} onClick={() => toggle(i)}>{c}</button>
        ))}
      </div>
      <div className="scr-table">
        <table>
          <caption className="sr">Rows extracted from the example page</caption>
          <thead><tr>{cols.map((i) => <th key={i} scope="col">{SCRAPE_COLS[i]}</th>)}</tr></thead>
          <tbody>
            {SCRAPE_ROWS.map((row) => (
              <tr key={row[0]}>{cols.map((i) => <td key={i} className={i === 1 || i === 3 ? "mono" : undefined}>{row[i]}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption className="win-foot">
        <span>Illustrative example · not a real lead</span>
        <span className="win-from">{SCRAPE_ROWS.length} rows, {cols.length} {cols.length === 1 ? "column" : "columns"}, ready as CSV</span>
      </figcaption>
    </figure>
  );
}

export default function Home() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP((context) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ease = "power3.out";

    // One entrance: headline words, then the side copy, then the product window.
    gsap.from(".hero-h .w", { yPercent: 70, opacity: 0, duration: 0.8, stagger: 0.045, ease });
    gsap.from(".hero-side > *", { y: 14, opacity: 0, duration: 0.7, stagger: 0.08, delay: 0.35, ease });
    gsap.from(".stage", { y: 28, opacity: 0, duration: 0.9, delay: 0.45, ease });

    // Below the fold, blocks settle in once as they are reached.
    const rise = context.selector?.("[data-rise]") ?? [];
    gsap.set(rise, { opacity: 0, y: 18 });
    ScrollTrigger.batch(rise, {
      start: "top 90%", once: true,
      onEnter: (els) => gsap.to(els, { opacity: 1, y: 0, duration: 0.7, stagger: 0.06, ease, overwrite: true, clearProps: "transform" }),
    });
  }, { scope: root });

  return (
    <SitePage path="/">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      <div ref={root}>
        <section className="hero">
          <div className="frame">
            <div className="hero-top">
              <h1 className="hero-h">
                {HEADLINE.split(" ").map((w, i) => <Fragment key={i}><span className="w">{w}</span>{" "}</Fragment>)}
              </h1>
              <div className="hero-side">
                <p className="hero-sub">
                  Ghost Leads finds companies from five public sources, then reads each company's own website for emails,
                  people, phone numbers and tech stack. Every value links to the page it was found on.
                </p>
                <div className="hero-actions">
                  <Link to="/signup" className="btn btn-ink">Start free</Link>
                  <Link to="/#pipeline" className="btn btn-line">See how it works</Link>
                </div>
                <p className="fine">Free plan with daily limits. No card needed.</p>
              </div>
            </div>
            <div className="stage"><HeroTable /></div>
          </div>
        </section>

        <section id="sources" className="sec">
          <div className="frame">
            <h2 className="statement">Five ways to start a list. <span>Pick a source, say who you are looking for, and get companies back with a link to where each one was listed.</span></h2>
            <table className="ledger">
              <thead><tr><th scope="col">Source</th><th scope="col">You give it</th><th scope="col">Companies come from</th></tr></thead>
              <tbody>
                {SOURCES.map(([name, give, example, from]) => (
                  <tr key={name} data-rise>
                    <th scope="row">{name}</th>
                    <td data-label="You give it">{give}<span className="eg mono">{example}</span></td>
                    <td data-label="Companies come from">{from}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="pipeline" className="sec sec-pipe">
          <div className="frame"><Pipeline /></div>
        </section>

        <section id="scrape" className="sec">
          <div className="frame split">
            <div className="split-copy">
              <h2 className="statement">Any page into a table. <span>Paste an address, name the columns you want, and get rows you can export as CSV.</span></h2>
              <p className="body">
                Works on the pages people usually copy by hand: exhibitor lists, member directories, partner pages, price lists.
                Switch the columns in the example to see the table change.
              </p>
            </div>
            <ScrapeDemo />
          </div>
        </section>

        <section id="principles" className="sec sec-dark">
          <div className="frame">
            <h2 className="statement">Built to be checked. <span>A lead list is only useful if you can see where it came from and trust how it was collected.</span></h2>
            <ul className="principles">
              {PRINCIPLES.map(([title, text]) => (
                <li key={title} data-rise><h3>{title}</h3><p>{text}</p></li>
              ))}
            </ul>
            <p className="principles-more"><Link to="/bot" className="link">How our crawler behaves, and how to opt out</Link></p>
          </div>
        </section>

        <section id="events" className="sec">
          <div className="frame split split-rev">
            <figure className="signal" data-rise aria-label="Illustrative example of an event signal becoming a LinkedIn draft. The person and the event are not real.">
              <div className="signal-post">
                <div className="cell-a">Erika Mustermann</div>
                <div className="cell-b">Head of Operations, Beispiel Logistik</div>
                <p>“Looking forward to Beispiel Expo in Lisbon next month. Who else is going?”</p>
              </div>
              <div className="signal-draft">
                <div className="rec-draft-top"><b>LinkedIn note</b><span className="tag tag-ember">Draft, waiting for your review</span></div>
                <p>Hi Erika, I saw your post about heading to Beispiel Expo. We will be there too. Would you have 15 minutes between sessions?</p>
              </div>
              <figcaption>Illustrative example · not a real lead</figcaption>
            </figure>
            <div className="split-copy">
              <h2 className="statement">Where it started: event signals. <span>Find the people who say in public that they are going to an event.</span></h2>
              <p className="body">
                Ghost Leads began as an event tool, and that still works. Name a trade fair or conference and it collects the people who posted about attending,
                then prepares a LinkedIn note for each one. Every note waits for a person to read and approve it.
              </p>
            </div>
          </div>
        </section>

        <section id="pricing" className="sec">
          <div className="frame">
            <h2 className="statement">Free to start. <span>Paid plans raise every daily limit. There is no checkout yet, so we set them up with you by email.</span></h2>
            <div data-rise><Plans /></div>
            <p className="fine"><Link to="/pricing" className="link">Compare the limits on each plan</Link></p>
          </div>
        </section>

        <section id="faq" className="sec">
          <div className="frame split split-faq">
            <h2 className="statement">Questions people ask first.</h2>
            <Faq items={FAQ} />
          </div>
        </section>

        <section className="sec cta">
          <div className="frame cta-in">
            <h2 className="cta-h">Start with one search.</h2>
            <p className="hero-sub">Pick a source, run it, and open any cell to see where the value came from.</p>
            <div className="hero-actions">
              <Link to="/signup" className="btn btn-ink">Start free</Link>
              <ContactLink subject="Ghost Leads" className="btn btn-line">Talk to us</ContactLink>
            </div>
          </div>
        </section>
      </div>
    </SitePage>
  );
}
