import assert from "node:assert/strict";
import { test } from "node:test";
import { fromJsonLd, fromLists, fromTables, heuristicExtract } from "../../server/extract.js";
import { parseHtml } from "../../server/html.js";

const BASE = "https://list.test/page";

test("JSON-LD: ItemList entries and the most frequent item type become rows", () => {
  const $ = parseHtml(`<script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","itemListElement":[
    {"@type":"ListItem","position":1,"item":{"@type":"Product","name":"Widget","sku":"W-1","offers":{"@type":"Offer","price":"9.90","priceCurrency":"EUR"}}},
    {"@type":"ListItem","position":2,"item":{"@type":"Product","name":"Gadget","sku":"G-2","offers":{"@type":"Offer","price":12,"priceCurrency":"EUR"}}}
  ]}</script>
  <script type="application/ld+json">{"@type":"WebSite","name":"Shop"}</script>
  <script type="application/ld+json">[{"@type":"BreadcrumbList","itemListElement":[]}]</script>`);
  assert.deepEqual(fromJsonLd($), {
    columns: ["name", "sku", "offers.price", "offers.priceCurrency"],
    rows: [
      { name: "Widget", sku: "W-1", "offers.price": "9.90", "offers.priceCurrency": "EUR" },
      { name: "Gadget", sku: "G-2", "offers.price": "12", "offers.priceCurrency": "EUR" },
    ],
  });
});

test("tables: header row, data rows, link column, biggest table wins", () => {
  const $ = parseHtml(`
    <table><tr><td>layout</td></tr></table>
    <table>
      <thead><tr><th>Company</th><th>City</th><th>Booth</th></tr></thead>
      <tbody>
        <tr><td><a href="/vote?id=1"><span class="arrow"></span></a> <a href="https://acme.test/">Acme GmbH</a></td><td><a href="/city/berlin">Berlin</a></td><td>A1</td></tr>
        <tr><td>Globex</td><td> München </td><td></td></tr>
        <tr><td></td><td></td><td></td></tr>
      </tbody>
    </table>`);
  assert.deepEqual(fromTables($, BASE), {
    columns: ["Company", "City", "Booth", "link"],
    rows: [
      { Company: "Acme GmbH", City: "Berlin", Booth: "A1", link: "https://acme.test/" },
      { Company: "Globex", City: "München", Booth: null, link: null },
    ],
  });
  const noHeader = parseHtml("<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>");
  assert.deepEqual(fromTables(noHeader, BASE).columns, ["Column 1", "Column 2"]);
});

test("lists: repeated cards give title, text and link; navigation and prose lose", () => {
  const $ = parseHtml(`
    <nav><ul><li><a href="/a">Home</a></li><li><a href="/b">About</a></li><li><a href="/c">Blog</a></li><li><a href="/d">Jobs</a></li></ul></nav>
    <main>
      <p>${"A long introduction paragraph about this directory. ".repeat(4)}</p>
      <p>${"Another paragraph of prose with no links at all. ".repeat(4)}</p>
      <p>${"And a third one, because prose comes in threes. ".repeat(4)}</p>
      <div class="grid">
        <div class="card"><h3>Acme GmbH</h3><p>Industrial widgets</p><a href="/members/acme">Details</a></div>
        <div class="card"><h3>Globex AG</h3><p>Logistics software</p><a href="/members/globex">Details</a></div>
        <div class="card"><h3>Initech</h3><p>Consulting</p><a href="/members/initech">Details</a></div>
        <div class="card"><h3>Umbrella</h3><p>Pharma</p><a href="/members/umbrella">Details</a></div>
      </div>
    </main>`);
  const { columns, rows } = fromLists($, BASE);
  assert.deepEqual(columns, ["title", "text", "link"]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { title: "Acme GmbH", text: "Industrial widgets Details", link: "https://list.test/members/acme" });
});

test("lists: logo-only items are named by their alt text", () => {
  const $ = parseHtml(`<ul class="sponsors">
    <li><a href="https://acme.test"><img src="a.svg" alt="Acme"></a></li>
    <li><a href="https://globex.test"><img src="g.svg" alt="Globex"></a></li>
    <li><a href="https://initech.test"><img src="i.svg" alt="Initech"></a></li></ul>`);
  assert.deepEqual(fromLists($, BASE).rows, [
    { title: "Acme", link: "https://acme.test/" }, { title: "Globex", link: "https://globex.test/" }, { title: "Initech", link: "https://initech.test/" },
  ]);
});

test("heuristicExtract picks structured data over guessed lists, and reports nothing honestly", () => {
  const table = "<table><tr><th>Name</th></tr><tr><td>A</td></tr><tr><td>B</td></tr><tr><td>C</td></tr></table>";
  const list = "<ul><li><a href='/1'>One</a></li><li><a href='/2'>Two</a></li><li><a href='/3'>Three</a></li><li><a href='/4'>Four</a></li></ul>";
  assert.equal(heuristicExtract(parseHtml(table + list), BASE).method, "table");
  assert.equal(heuristicExtract(parseHtml(list), BASE).method, "list");
  assert.deepEqual(heuristicExtract(parseHtml("<p>Just one paragraph.</p>"), BASE), { columns: [], rows: [], method: "list" });
});

test("cells are trimmed and capped", () => {
  const $ = parseHtml(`<table><tr><th>Text</th></tr><tr><td>${"x".repeat(900)}</td></tr><tr><td>  spaced   out  </td></tr></table>`);
  const { rows } = fromTables($, BASE);
  assert.equal(rows[0].Text?.length, 500);
  assert.equal(rows[1].Text, "spaced out");
});

test("heuristicExtract keeps a wide data table over a longer footnote list", () => {
  const rows = Array.from({ length: 6 }, (_, i) => `<tr><td>Co ${i}</td><td>${i} bn</td><td>US</td></tr>`).join("");
  const notes = Array.from({ length: 20 }, (_, i) => `<li><a href="/ref${i}">Reference number ${i} with a long title</a></li>`).join("");
  const page = `<table><tr><th>Company</th><th>Revenue</th><th>Country</th></tr>${rows}</table><ol>${notes}</ol>`;
  assert.equal(heuristicExtract(parseHtml(page), BASE).method, "table");
});
