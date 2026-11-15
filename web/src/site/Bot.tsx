import { Link } from "react-router-dom";
import { ContactLink, SitePage } from "./chrome";
import "../landing.css";

const FACTS = [
  ["What it is", <>GhostLeadsBot is the crawler behind Ghost Leads, a lead research product for B2B teams. It sends plain web requests under the name <code className="mono">GhostLeadsBot/1.0</code>, with a link back to this site.</>],
  ["When it visits", <>Only when a Ghost Leads user asks for it: to read a company's public website for business contact details, or to turn one list page into a table. It does not crawl the web on a schedule.</>],
  ["What it reads", <>Public pages that a browser can open without signing in, such as a home page, contact page, team page or imprint. It reads HTML and similar text formats, up to 3 MB per page, and gives up after ten seconds.</>],
  ["What it collects", <>Business contact data that the company has published itself: company name and description, email addresses, phone numbers, social profile links, named people with their job titles, and the tech the site runs on. Each value is stored with the page it was found on.</>],
  ["What it does not do", <>It does not sign in, fill in forms, get around CAPTCHAs or paywalls, or request pages that robots.txt closes to it. It only talks to public internet addresses over http and https.</>],
] as const;

export default function Bot() {
  return (
    <SitePage path="/bot" title="About GhostLeadsBot" description="GhostLeadsBot is the crawler behind Ghost Leads. What it reads, what it collects, how it follows robots.txt, and the two lines that keep it off your site.">
      <article className="doc">
        <div className="frame doc-in">
          <header className="doc-head">
            <h1 className="doc-h">About GhostLeadsBot</h1>
            <p className="hero-sub">If you found this name in your server logs, this page explains what visited your site, what it was looking for, and how to turn it away.</p>
          </header>

          <dl className="botfacts">
            {FACTS.map(([term, text]) => (
              <div key={term}><dt>{term}</dt><dd>{text}</dd></div>
            ))}
          </dl>

          <section className="doc-sec" aria-labelledby="robots">
            <h2 id="robots" className="doc-h2">How it follows robots.txt</h2>
            <p>
              Before fetching a page, GhostLeadsBot reads your <code className="mono">robots.txt</code> and follows it the way RFC 9309 describes.
              If the file has a group for <code className="mono">GhostLeadsBot</code>, those rules apply. Otherwise the rules for
              <code className="mono"> *</code> apply. The most specific matching rule wins.
            </p>
            <ul className="ticks">
              <li>No robots.txt at all means there are no restrictions.</li>
              <li>If robots.txt cannot be reached because of a server or network error, the bot stays out.</li>
              <li>Rules are cached for up to an hour, so a change takes effect within the hour.</li>
            </ul>
          </section>

          <section className="doc-sec" aria-labelledby="optout">
            <h2 id="optout" className="doc-h2">How to opt out</h2>
            <p>To keep GhostLeadsBot away from your whole site, add these two lines to <code className="mono">robots.txt</code> at the root of your domain:</p>
            <pre className="code mono"><code>{"User-agent: GhostLeadsBot\nDisallow: /"}</code></pre>
            <p>To close only part of the site, name the path instead:</p>
            <pre className="code mono"><code>{"User-agent: GhostLeadsBot\nDisallow: /team/"}</code></pre>
            <p>
              To have data about your business removed from Ghost Leads, or to report a problem with the crawler, write to{" "}
              <ContactLink subject="GhostLeadsBot" className="link" /> and include your domain.
            </p>
            <p><Link to="/privacy" className="link">The privacy page</Link> says what Ghost Leads keeps and how removal works.</p>
          </section>

          <p className="fine"><Link to="/#principles" className="link">The principles Ghost Leads works by</Link></p>
        </div>
      </article>
    </SitePage>
  );
}
