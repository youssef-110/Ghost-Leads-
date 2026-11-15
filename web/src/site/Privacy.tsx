import { Link } from "react-router-dom";
import { ContactLink, DraftNotice, Ph, SitePage } from "./chrome";
import "../landing.css";

export default function Privacy() {
  return (
    <SitePage path="/privacy" title="Privacy" description="What Ghost Leads keeps about the people who use it, what it collects from the public web, and how to ask for data to be removed.">
      <article className="doc">
        <div className="frame doc-in">
          <header className="doc-head">
            <h1 className="doc-h">Privacy</h1>
            <p className="hero-sub">What Ghost Leads keeps about the people who use it, what it collects from the public web, and how to ask for data to be removed.</p>
            <DraftNotice>
              {" "}— this page describes how the product works today. The owner must review it, replace every value in [brackets] and have counsel check it before launch.
            </DraftNotice>
          </header>

          <section className="doc-sec" aria-labelledby="who">
            <h2 id="who" className="doc-h2">Who is responsible</h2>
            <p>
              Ghost Leads is run by <Ph>legal entity name</Ph>, <Ph>registered address</Ph>. For anything on this page, write to{" "}
              <ContactLink subject="Privacy" className="link" /> <Ph>confirm this is the privacy inbox</Ph>.
            </p>
          </section>

          <section className="doc-sec" aria-labelledby="users">
            <h2 id="users" className="doc-h2">What we keep about you as a user</h2>
            <ul className="ticks">
              <li><b>Your account.</b> The email address you sign up with, and a password. Sign-in is handled by Supabase, which stores the password as a hash. Ghost Leads never has it in readable form.</li>
              <li><b>Your workspace.</b> The lists you build, the companies and contacts in them, event leads, the tables you scrape, and a daily count of searches, enrichments, page scrapes, AI drafts and email checks. This is stored in a Supabase database, and only members of your workspace can read it.</li>
              <li><b>In your browser.</b> Your sign-in session, and the short description of your offer that you type for drafts. Both stay in your browser's local storage.</li>
              <li><b>No trackers.</b> This site sets no advertising or analytics cookies.</li>
              <li><b>Fonts.</b> The typefaces are loaded from Google Fonts, so your browser contacts Google when a page opens.</li>
            </ul>
          </section>

          <section className="doc-sec" aria-labelledby="processors">
            <h2 id="processors" className="doc-h2">Other services involved</h2>
            <ul className="ticks">
              <li>Supabase stores accounts and workspace data.</li>
              <li>OpenAI writes the drafts. When you ask for one, the facts on that company record and your offer text are sent to it.</li>
              <li>The source you search receives your search terms: OpenStreetMap, a web search provider, or public job feeds.</li>
              <li><Ph>hosting provider</Ph> serves the site and may keep ordinary request logs.</li>
            </ul>
            <p><Ph>owner to confirm this list, where each provider stores data, and that a data processing agreement is in place with each</Ph></p>
          </section>

          <section className="doc-sec" aria-labelledby="web">
            <h2 id="web" className="doc-h2">What Ghost Leads collects from the web</h2>
            <p>
              When a user asks about a company, Ghost Leads reads that company's public website and keeps the business contact data the company
              has published about itself: its name and description, email addresses, phone numbers, links to social profiles, the tech the site runs on,
              and the names and job titles of people the company lists.
            </p>
            <ul className="ticks">
              <li>Every item is stored with the address of the page it was found on.</li>
              <li>Only pages that open without signing in are read, and pages closed by <code className="mono">robots.txt</code> are not fetched.</li>
              <li>The data sits in the workspace of the user who asked for it. Ghost Leads does not sell it or publish it.</li>
            </ul>
            <p><Link to="/bot" className="link">How the crawler behaves</Link></p>
          </section>

          <section className="doc-sec" aria-labelledby="removal">
            <h2 id="removal" className="doc-h2">How to have data removed</h2>
            <ul className="ticks">
              <li><b>You or your business appear in Ghost Leads.</b> Write to <ContactLink subject="Data removal" className="link" /> with the domain or the name, and we remove the matching records. <Ph>response time</Ph></li>
              <li><b>You want the crawler to stay away.</b> Add a rule for GhostLeadsBot to your robots.txt. <Link to="/bot#optout" className="link">The crawler page has the exact lines</Link>.</li>
              <li><b>You are a user.</b> You can delete any list yourself. To delete your account and workspace, write to the same address.</li>
            </ul>
          </section>

          <section className="doc-sec" aria-labelledby="rights">
            <h2 id="rights" className="doc-h2">How long, and your rights</h2>
            <p>Data is kept for <Ph>retention periods for accounts, workspace data and logs</Ph>.</p>
            <p>
              Depending on where you live, you may have the right to see, correct, export or delete the data held about you, and to object to its use.
              Write to the address above to use any of them. <Ph>legal basis for processing, supervisory authority and any required representative, to be added by counsel</Ph>
            </p>
            <p className="fine">Last updated: <Ph>effective date</Ph></p>
          </section>
        </div>
      </article>
    </SitePage>
  );
}
