import { Link } from "react-router-dom";
import { ContactLink, Faq, Plans, SitePage } from "./chrome";
import { dailyLimits, LIMIT_LABELS, PLAN_NAMES, PLAN_X } from "./plans";
import "../landing.css";

const FAQ = [
  { q: "How do I get Pro or Team?", a: <p>There is no self-serve checkout yet. Write to <ContactLink subject="Ghost Leads plans" className="link" />, tell us roughly how many companies you work through in a day, and we set the plan up with you.</p> },
  { q: "Why are there no prices for the paid plans?", a: <p>Because we have not fixed them. We would rather agree a price with you for what you use than print a number we might change.</p> },
  { q: "What counts against a limit?", a: <p>A search is one run of a source. An enrichment is one company website read. A page scrape is one page turned into a table. An AI draft is one opener written. An email check is one address checked for a mail server. Limits reset every day.</p> },
  { q: "Can I export on the free plan?", a: <p>Yes. CSV export is part of every plan.</p> },
];

export default function Pricing() {
  return (
    <SitePage path="/pricing" title="Pricing" description="Ghost Leads is free to start, with daily limits on searches, enrichments, page scrapes, AI drafts and email checks. Pro and Team raise every limit and are set up by email.">
      <section className="doc">
        <div className="frame doc-in doc-wide">
          <header className="doc-head">
            <h1 className="doc-h">Free to start. Talk to us when you need more.</h1>
            <p className="hero-sub">The free plan is the whole product with daily limits. Pro has {PLAN_X.Pro} times those limits and Team {PLAN_X.Team} times.</p>
          </header>

          <Plans as="h2" />

          <section className="doc-sec" aria-labelledby="limits">
            <h2 id="limits" className="doc-h2">Daily limits</h2>
            <div className="limits-wrap">
              <table className="limits">
                <thead><tr><th scope="col"><span className="sr">Limit</span></th>{PLAN_NAMES.map((p) => <th key={p} scope="col">{p}</th>)}</tr></thead>
                <tbody>
                  {LIMIT_LABELS.map(([kind, label], row) => (
                    <tr key={kind}>
                      <th scope="row">{label[0].toUpperCase() + label.slice(1)} a day</th>
                      {PLAN_NAMES.map((p) => <td key={p} className="num">{dailyLimits(p)[row][0]}</td>)}
                    </tr>
                  ))}
                  <tr><th scope="row">CSV export</th><td>Included</td><td>Included</td><td>Included</td></tr>
                  <tr><th scope="row">Source link on every value</th><td>Included</td><td>Included</td><td>Included</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="doc-sec" aria-labelledby="pricing-faq">
            <h2 id="pricing-faq" className="doc-h2">Plan questions</h2>
            <Faq items={FAQ} />
          </section>

          <div className="hero-actions">
            <Link to="/signup" className="btn btn-ink">Start free</Link>
            <ContactLink subject="Ghost Leads plans" className="btn btn-line">Talk to us</ContactLink>
          </div>
        </div>
      </section>
    </SitePage>
  );
}
