import { Link } from "react-router-dom";
import { ContactLink, DraftNotice, Ph, SitePage } from "./chrome";
import "../landing.css";

export default function Terms() {
  return (
    <SitePage path="/terms" title="Terms" description="The terms for using Ghost Leads, in plain language: what the product does, what you may use it for, and what stays your responsibility.">
      <article className="doc">
        <div className="frame doc-in">
          <header className="doc-head">
            <h1 className="doc-h">Terms of use</h1>
            <p className="hero-sub">The rules for using Ghost Leads, in plain language.</p>
            <DraftNotice>
              {" "}— have counsel review before launch. This is a working draft, not yet a binding agreement. Every value in [brackets] is a placeholder the owner must replace.
            </DraftNotice>
          </header>

          <section className="doc-sec" aria-labelledby="parties">
            <h2 id="parties" className="doc-h2">Who you are dealing with</h2>
            <p>Ghost Leads is provided by <Ph>legal entity name</Ph>, <Ph>registered address</Ph>, <Ph>company registration number</Ph>. By creating an account you agree to these terms.</p>
          </section>

          <section className="doc-sec" aria-labelledby="service">
            <h2 id="service" className="doc-h2">What the service does</h2>
            <p>
              Ghost Leads finds companies from public sources, reads each company's own public website for business contact details,
              turns list pages into tables, and writes draft messages for you to review. It does not send messages for you.
            </p>
          </section>

          <section className="doc-sec" aria-labelledby="account">
            <h2 id="account" className="doc-h2">Your account</h2>
            <ul className="ticks">
              <li>Sign up with an email address you can receive mail on, and keep your password to yourself.</li>
              <li>You are responsible for what is done through your account.</li>
              <li>Ghost Leads is meant for business use. <Ph>minimum age and who may open an account, to be set by counsel</Ph></li>
            </ul>
          </section>

          <section className="doc-sec" aria-labelledby="plans">
            <h2 id="plans" className="doc-h2">Plans and limits</h2>
            <p>
              The free plan has daily limits, listed on <Link to="/pricing" className="link">the pricing page</Link>. Paid plans are set up by email,
              and the price is agreed in writing with you first. There is no automatic billing. <Ph>payment, renewal and cancellation terms for paid plans</Ph>
            </p>
          </section>

          <section className="doc-sec" aria-labelledby="use">
            <h2 id="use" className="doc-h2">Using it fairly</h2>
            <ul className="ticks">
              <li>Use Ghost Leads to research businesses. Do not use it to build files on private individuals.</li>
              <li>Follow the laws that apply to you and to the people you contact, such as GDPR and local rules on unsolicited messages. That stays your responsibility.</li>
              <li>Read every draft before you send it, and respect anyone who asks you to stop contacting them.</li>
              <li>Do not try to get around the limits, overload the service, or use it to reach pages you have no right to read.</li>
            </ul>
          </section>

          <section className="doc-sec" aria-labelledby="data">
            <h2 id="data" className="doc-h2">The data you get</h2>
            <p>
              Ghost Leads collects what companies publish about themselves and shows you the page each value came from. Published information can be
              out of date, incomplete or wrong. The email status is a mail server check plus a note on where the address was found. It is not a promise
              that someone reads the inbox. Drafts are written by an AI model and can contain mistakes. Check anything that matters before you rely on it.
            </p>
          </section>

          <section className="doc-sec" aria-labelledby="yours">
            <h2 id="yours" className="doc-h2">Your lists</h2>
            <p>
              The lists and tables you build are yours. You can export them as CSV and delete them at any time. We use them only to run the service for you.{" "}
              <Link to="/privacy" className="link">The privacy page</Link> says what is stored and where.
            </p>
          </section>

          <section className="doc-sec" aria-labelledby="changes">
            <h2 id="changes" className="doc-h2">Changes, availability and ending</h2>
            <ul className="ticks">
              <li>The service is provided as it is. Features and limits can change, and there is no promise of uninterrupted availability.</li>
              <li>You can stop using Ghost Leads at any time and ask for your account to be deleted.</li>
              <li>We may suspend an account that breaks these terms.</li>
            </ul>
          </section>

          <section className="doc-sec" aria-labelledby="legal">
            <h2 id="legal" className="doc-h2">Liability and governing law</h2>
            <p><Ph>warranty disclaimer and limitation of liability, to be written by counsel</Ph></p>
            <p>These terms are governed by <Ph>governing law and courts</Ph>.</p>
            <p>Questions about these terms: <ContactLink subject="Terms" className="link" />.</p>
            <p className="fine">Last updated: <Ph>effective date</Ph></p>
          </section>
        </div>
      </article>
    </SitePage>
  );
}
