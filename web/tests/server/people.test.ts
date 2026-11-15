import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHtml, visibleText } from "../../server/html.js";
import { findPeople, fromImpressum, looksLikeTitle, personName } from "../../server/people.js";

const people = (html: string, homepage = false) => {
  const $ = parseHtml(html);
  return findPeople($, visibleText($), "https://firma.de/team", homepage).map((p) => [p.name, p.title, p.email, p.linkedin]);
};

test("personName accepts people and rejects headings, companies and phrases", () => {
  assert.equal(personName("Dr. Max Mustermann"), "Max Mustermann");
  assert.equal(personName("Prof. Dr. med. dent. Erika von Musterfrau"), "Erika von Musterfrau");
  assert.equal(personName("Dipl.-Ing. Jörg Müller-Lüdenscheidt"), "Jörg Müller-Lüdenscheidt");
  assert.equal(personName("John F. Kennedy"), "John F. Kennedy");
  assert.equal(personName("Tobias McNulty"), "Tobias McNulty");
  for (const no of [
    "Unser Team", "Contact Us", "Acme GmbH", "Privacy Policy", "Shameless CTA", "ABOUT US", "Max", "Read More", "Mustermann GmbH & Co. KG",
    "Max Mustermann 2024", "max mustermann", "Customer Success Stories", "Leadership Team", "San Francisco",
  ]) assert.equal(personName(no), null, no);
});

test("looksLikeTitle wants a short role, not a sentence", () => {
  for (const yes of ["CEO", "Co-founder & CTO", "Geschäftsführerin", "Head of Sales DACH", "Chief Financial Officer, CFO", "Leiter Vertrieb"]) {
    assert.equal(looksLikeTitle(yes), true, yes);
  }
  for (const no of ["", "Lorem ipsum", "If nothing else has sold you, these classic marketing tactics will.", "We love sales. We love marketing."]) {
    assert.equal(looksLikeTitle(no), false, no);
  }
});

test("schema.org Person and Organization.founder in JSON-LD", () => {
  const found = people(`<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
    {"@type":"Person","name":"Jane Doe","jobTitle":"Chief Executive Officer","email":"mailto:Jane@acme.com","sameAs":["https://twitter.com/jane","https://www.linkedin.com/in/janedoe/"]},
    {"@type":"Person","name":"Blog Author"},
    {"@type":"Organization","name":"Acme","founder":{"@type":"Person","name":"John Roe"}}
  ]}</script><script type="application/ld+json">{ broken json</script>`);
  assert.deepEqual(found, [
    ["Jane Doe", "Chief Executive Officer", "jane@acme.com", "https://www.linkedin.com/in/janedoe"],
    ["John Roe", "Founder", null, null],
  ]);
});

test("team cards: name in a heading, role next to it, contact links from the same card", () => {
  const found = people(`
    <section class="team">
      <div class="member"><h3>Anna Schmidt</h3><p class="position">Geschäftsführerin</p>
        <a href="mailto:anna.schmidt@firma.de">Mail</a><a href="https://www.linkedin.com/in/anna-schmidt-123/">in</a></div>
      <div class="member"><h3>Peter Müller</h3><p>Leiter Vertrieb</p></div>
      <div class="member"><h3>Unser Büro</h3><p>Head of nothing</p></div>
      <div class="member"><h3>Lisa Becker</h3><p>Seit 2019 bei uns und immer gut gelaunt.</p></div>
    </section>
    <ul><li><strong>Tom Weber</strong> – CTO</li></ul>`);
  assert.deepEqual(found, [
    ["Anna Schmidt", "Geschäftsführerin", "anna.schmidt@firma.de", "https://www.linkedin.com/in/anna-schmidt-123"],
    ["Peter Müller", "Leiter Vertrieb", null, null],
    ["Tom Weber", "– CTO", null, null],
  ]);
});

test("customer quotes are not staff", () => {
  const quote = '<blockquote><strong>Carla Kunde</strong><span>Head of IT</span></blockquote>' +
    '<div class="testimonial-card"><h4>Karl Käufer</h4><p>CEO</p></div>' +
    '<div class="card"><h4>Konrad Hecker</h4><p>Head of Data Privacy · Sanofi</p></div>' +
    '<div class="card"><h4>Rita Referenz</h4><p>Marketing Manager at Globex</p></div>' +
    '<div class="card"><h4>Karin Batz</h4><p>Chief Financial Officer, CFO</p></div>';
  assert.deepEqual(people(quote, true), [["Karin Batz", "Chief Financial Officer, CFO", null, null]]);
  // on a team page a trailing word is more likely a location or department, so only the explicit "at" form is dropped
  assert.deepEqual(people(quote, false).map((p) => p[0]), ["Konrad Hecker", "Karin Batz"]);
});

test("German Impressum: Geschäftsführer, Inhaber, Vertreten durch, Vorstand", () => {
  const text = [
    "Impressum", "Muster Software GmbH", "Musterstraße 1", "66111 Saarbrücken",
    "Geschäftsführer: Dr. Max Mustermann, Erika Musterfrau und Dipl.-Kfm. Jörg Weiß",
    "Registergericht: Amtsgericht Saarbrücken", "Verantwortlich für den Inhalt: Redaktion",
  ].join("\n");
  assert.deepEqual(fromImpressum(text).map((p) => [p.name, p.title]), [
    ["Max Mustermann", "Geschäftsführer"], ["Erika Musterfrau", "Geschäftsführer"], ["Jörg Weiß", "Geschäftsführer"],
  ]);
  assert.deepEqual(fromImpressum("Inhaber:\nMalte Schäfer\nFeldmannstraße 5").map((p) => [p.name, p.title]), [["Malte Schäfer", "Inhaber"]]);
  assert.deepEqual(fromImpressum("Vertreten durch: Sabine Klein").map((p) => [p.name, p.title]), [["Sabine Klein", "Vertretungsberechtigt"]]);
  assert.deepEqual(fromImpressum("Vertreten durch den Geschäftsführer Hans Groß").map((p) => [p.name, p.title]), [["Hans Groß", "Geschäftsführer"]]);
  assert.deepEqual(fromImpressum("Vorstand: Ute Lang (Vorsitzende), Ralf Kurz").map((p) => p.name), ["Ute Lang", "Ralf Kurz"]);
  assert.deepEqual(fromImpressum("Managing Directors: Jane Doe & John Roe").map((p) => [p.name, p.title]), [["Jane Doe", "Managing Director"], ["John Roe", "Managing Director"]]);
  assert.deepEqual(fromImpressum("Geschäftsführer: Muster Verwaltungs GmbH\nInhaber: siehe oben"), []);
});

test("every person carries the page it was found on, and duplicates collapse", () => {
  const $ = parseHtml('<h3>Anna Schmidt</h3><p>CEO</p><script type="application/ld+json">{"@type":"Person","name":"Anna Schmidt","jobTitle":"CEO"}</script>');
  const found = findPeople($, visibleText($), "https://firma.de/about");
  assert.equal(found.length, 1);
  assert.equal(found[0].source_url, "https://firma.de/about");
});
