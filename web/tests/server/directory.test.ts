import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHtml } from "../../server/html.js";
import { companiesOnPage, nextPage } from "../../server/sources/directory.js";

const PAGE = "https://expo.test/exhibitors";
const companies = (html: string) => companiesOnPage(parseHtml(html), PAGE).map((i) => [i.company_name, i.domain, i.website]);

test("exhibitor cards: name from the card heading, website from the outbound link", () => {
  const html = `
    <nav><a href="https://sponsor-in-nav.test">Nav sponsor</a></nav>
    <div class="list">
      <div class="card"><h3>Acme GmbH</h3><p>Industrial widgets since 1950, Hall 2</p><a class="web" href="https://www.acme-widgets.de/de/">Website</a>
        <a href="https://www.linkedin.com/company/acme">LinkedIn</a></div>
      <div class="card"><h3>Globex AG</h3><a class="web" href="http://globex.test">Zur Website</a></div>
      <div class="card"><h3>Initech</h3><a class="web" href="https://initech.io/?utm_source=expo">www.initech.io</a></div>
      <div class="card"><h3>No Website Corp</h3><a class="web" href="/exhibitors/no-website">Details</a></div>
    </div>
    <footer><a href="https://agency.test">Made by Agency</a><a href="https://host.test">Hosting</a><a href="https://legal.test">Legal</a></footer>`;
  assert.deepEqual(companies(html), [
    ["Acme GmbH", "acme-widgets.de", "https://www.acme-widgets.de/de/"],
    ["Globex AG", "globex.test", "http://globex.test/"],
    ["Initech", "initech.io", "https://initech.io/?utm_source=expo"],
  ]);
  const first = companiesOnPage(parseHtml(html), PAGE)[0];
  assert.equal(first.description, "Industrial widgets since 1950, Hall 2 Website LinkedIn");
  assert.equal(first.source, "directory");
  assert.equal(first.source_url, PAGE);
});

test("plain link lists and logo grids", () => {
  assert.deepEqual(companies(`<ul>
    <li><a href="https://alpha.test">Alpha Tools</a> - fast builds</li>
    <li><a href="https://beta.test/docs">Beta Cloud</a></li>
    <li><a href="https://gamma.test">Gamma</a></li></ul>`).map((c) => c[0]), ["Alpha Tools", "Beta Cloud", "Gamma"]);
  assert.deepEqual(companies(`<div class="logos">
    <a href="https://sentry.test"><img alt="Logo of company Sentry" src="s.png"></a>
    <a href="https://jet.test"><img alt="JetBrains logo" src="j.png"></a>
    <a href="https://kraken.test"><img alt="Kraken Tech" src="k.png"></a></div>`).map((c) => c[0]), ["Sentry", "JetBrains", "Kraken Tech"]);
});

test("table rows with a name cell and a website cell", () => {
  assert.deepEqual(companies(`<table>
    <tr><th>Member</th><th>Web</th></tr>
    <tr><td>Nordwind e.K.</td><td><a href="https://nordwind.test">nordwind.test</a></td></tr>
    <tr><td>Südstern GmbH</td><td><a href="https://suedstern.test">suedstern.test</a></td></tr>
    <tr><td>Ostwerk AG</td><td><a href="https://ostwerk.test">ostwerk.test</a></td></tr></table>`), [
    ["Nordwind e.K.", "nordwind.test", "https://nordwind.test/"],
    ["Südstern GmbH", "suedstern.test", "https://suedstern.test/"],
    ["Ostwerk AG", "ostwerk.test", "https://ostwerk.test/"],
  ]);
});

test("template text shared by several companies is not used as a name", () => {
  assert.deepEqual(companies(`<div>
    <a href="https://one.test"><img alt="Transistor" src="1.svg"></a>
    <a href="https://two.test"><img alt="Transistor" src="2.svg"></a>
    <a href="https://three.test"><img alt="Transistor" src="3.svg"></a></div>`).map((c) => c[0]), ["one.test", "two.test", "three.test"]);
});

test("JSON-LD organizations; socials, own-site links and stray single links are not companies", () => {
  const html = `<script type="application/ld+json">[
      {"@type":"Organization","name":"Partner One","url":"https://partner-one.test","description":"Does things"},
      {"@type":"LocalBusiness","name":"Only Social","sameAs":["https://www.facebook.com/onlysocial"]},
      {"@type":"Organization","name":"The Host","url":"https://expo.test"}]</script>
    <p>Read <a href="https://random-blog.test/post">this post</a> and follow us on <a href="https://twitter.com/expo">Twitter</a>.</p>
    <a href="https://expo.test/tickets">Tickets</a>`;
  assert.deepEqual(companies(html), [["Partner One", "partner-one.test", "https://partner-one.test"]]);
});

test("one row per company domain", () => {
  assert.equal(companies(`<ul>
    <li><a href="https://acme.test">Acme</a></li><li><a href="https://www.acme.test/jobs">Acme Jobs</a></li>
    <li><a href="https://beta.test">Beta</a></li><li><a href="https://gamma.test">Gamma</a></li></ul>`).length, 3);
});

test("nextPage: rel=next, a labelled link, same site only", () => {
  const next = (html: string) => nextPage(parseHtml(html), PAGE);
  assert.equal(next('<a rel="next" href="?page=2">2</a>'), "https://expo.test/exhibitors?page=2");
  assert.equal(next('<head><link rel="next" href="/exhibitors/page/2/"></head>'), "https://expo.test/exhibitors/page/2/");
  assert.equal(next('<a href="/exhibitors?p=3">Weiter</a>'), "https://expo.test/exhibitors?p=3");
  assert.equal(next('<a href="/exhibitors?p=3" aria-label="Next page"><svg></svg></a>'), "https://expo.test/exhibitors?p=3");
  assert.equal(next('<a rel="next" href="https://elsewhere.test/2">next</a>'), null);
  assert.equal(next('<a href="#">Next</a>'), null);
  assert.equal(next('<a href="/next-steps">Our next steps for 2027</a>'), null);
});
