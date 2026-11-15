import assert from "node:assert/strict";
import { test } from "node:test";
import { findAddress, normalizeDomain, pickPages, score } from "../../server/enrich.js";
import { parseHtml, visibleText } from "../../server/html.js";
import { detectTech } from "../../server/tech.js";

test("normalizeDomain accepts domains and URLs, refuses everything else", () => {
  assert.equal(normalizeDomain("https://www.Example.com/about?x=1"), "example.com");
  assert.equal(normalizeDomain(" shop.example.co.uk. "), "shop.example.co.uk");
  for (const bad of ["localhost", "127.0.0.1", "http://[::1]/", "intranet", "exa mple.com", "example.invalidtld", "", "a@b.com", "printer.local"]) {
    assert.throws(() => normalizeDomain(bad), { code: "bad_request" }, bad);
  }
});

test("pickPages takes contact, imprint, team and about links from the homepage, then guesses what is missing", () => {
  const $ = parseHtml(`
    <a href="/">Home</a> <a href="/produkte">Produkte</a> <a href="/blog/contact-centers-in-2026">Blog post</a>
    <a href="/kontakt">Kontakt</a> <a href="/Impressum/">Impressum</a> <a href="https://firma.de/unternehmen/team#lead">Team</a>
    <a href="/ueber-uns">Über uns</a> <a href="/agb.pdf">AGB</a> <a href="https://other.test/contact">Elsewhere</a>
    <a href="mailto:info@firma.de">Mail</a>`);
  assert.deepEqual(pickPages($, "https://firma.de/"), [
    "https://firma.de/kontakt", "https://firma.de/Impressum/", "https://firma.de/unternehmen/team", "https://firma.de/ueber-uns",
  ]);
  // nothing linked: fall back to common paths, six at most
  assert.deepEqual(pickPages(parseHtml("<p>Single page site</p>"), "https://acme.com/"), [
    "https://acme.com/contact", "https://acme.com/kontakt", "https://acme.com/impressum", "https://acme.com/imprint", "https://acme.com/team", "https://acme.com/about",
  ]);
});

const address = (html: string) => {
  const $ = parseHtml(html);
  return findAddress($, visibleText($));
};

test("postal address from JSON-LD, German and US text, or an <address> element", () => {
  assert.equal(address(`<script type="application/ld+json">{"@type":"LocalBusiness","name":"X","address":{"@type":"PostalAddress",
    "streetAddress":"Im Rudert 15","postalCode":"35043","addressLocality":"Marburg","addressCountry":"DE"}}</script>`), "Im Rudert 15, 35043 Marburg, DE");
  assert.equal(address(`<script type="application/ld+json">{"@type":"Organization","address":{"streetAddress":"108 Morris St","postalCode":"27701",
    "addressLocality":"Durham","addressRegion":"NC","addressCountry":{"@type":"Country","name":"US"}}}</script>`), "108 Morris St, Durham, NC 27701, US");
  assert.equal(address("<p>Muster GmbH<br>Feldmannstraße 5<br>66119 Saarbrücken Deutschland<br>Tel. 0681 1234</p>"), "Feldmannstraße 5, 66119 Saarbrücken");
  assert.equal(address("<p>Unter den Linden 12a, D-10117 Berlin</p>"), "Unter den Linden 12a, 10117 Berlin");
  assert.equal(address("<p>Bad Homburg Office: Kaiser-Friedrich-Promenade 8-10, 61348 Bad Homburg vor der Höhe</p>"), null); // text before the street on the same line: not guessed
  assert.equal(address("<div>Acme Inc.</div><div>500 Main St, Suite 4</div><div>Springfield, IL 62701</div>"), "500 Main St, Suite 4, Springfield, IL 62701");
  assert.equal(address("<address>Rue de la Loi 16<br>1000 Bruxelles</address>"), "Rue de la Loi 16, 1000 Bruxelles");
  assert.equal(address("<p>We were founded in 2019 and have 12000 customers.</p>"), null);
});

test("score explains itself in plain words", () => {
  const base = { emails: [], people: [], phones: [], socials: {}, address: null, pages_crawled: 1 };
  assert.deepEqual(score(base, "none"), {
    score: 0, score_reasons: ["No email address found on the site", "No named contact person found", "The domain has no mail server, so email will bounce"],
  });
  const full = score({
    emails: [{ email: "max.muster@firma.de", kind: "personal", status: "valid", reason: null, source_url: "https://firma.de/team" }],
    people: [{ name: "Max Muster", title: "Geschäftsführer", email: "max.muster@firma.de", linkedin: null, source_url: "https://firma.de/team" }],
    phones: ["+4968112345"], socials: { linkedin: "https://www.linkedin.com/company/firma" }, address: "Musterstraße 1, 66111 Saarbrücken", pages_crawled: 5,
  }, "ok");
  assert.equal(full.score, 100);
  assert.ok(full.score_reasons.includes("Named contact with a role: Max Muster (Geschäftsführer)"));
  const guessOnly = score({ ...base, emails: [{ email: "max.muster@firma.de", kind: "guessed", status: "risky", reason: "guess", source_url: null }] }, "ok");
  assert.equal(guessOnly.score, 18);
  assert.match(guessOnly.score_reasons[0], /unconfirmed pattern guess/);
  const roleOnly = score({ ...base, emails: [{ email: "info@firma.de", kind: "role", status: "valid", reason: null, source_url: "https://firma.de/" }] }, "ok");
  assert.equal(roleOnly.score, 32);
});

test("tech stack from markup and response headers", () => {
  const html = `<html><head><meta name="generator" content="WordPress 6.5">
    <link rel="stylesheet" href="/wp-content/plugins/woocommerce/assets/css/woocommerce.css">
    <script src="https://www.googletagmanager.com/gtm.js?id=GTM-XXXX"></script>
    <script src="https://js.hs-scripts.com/123.js"></script><script src="https://js.stripe.com/v3/"></script>
    <script src="/wp-includes/js/jquery/jquery.min.js"></script><script src="https://consent.cookiebot.com/uc.js"></script></head></html>`;
  assert.deepEqual(detectTech(html, { server: "cloudflare", "x-powered-by": "PHP/8.2" }),
    ["WordPress", "WooCommerce", "Google Tag Manager", "HubSpot", "Stripe", "Cookiebot", "jQuery", "Cloudflare"]);
  assert.deepEqual(detectTech('<div id="__next"></div><script id="__NEXT_DATA__" type="application/json">{}</script>', { server: "Vercel" }), ["Next.js", "Vercel"]);
  assert.deepEqual(detectTech('<script src="https://cdn.shopify.com/s/files/1/theme.js"></script><script src="https://static.klaviyo.com/onsite/js/klaviyo.js"></script>'), ["Shopify", "Klaviyo"]);
  assert.deepEqual(detectTech("<p>We wrote a blog post about WordPress, Shopify and React.</p>"), []); // mentions are not usage
});
