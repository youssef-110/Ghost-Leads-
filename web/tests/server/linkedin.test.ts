// LinkedIn results come from a search engine's index, so the parsers work on result titles and links only.
// Fixtures are fictional people in the title shapes search engines really return.
import assert from "node:assert/strict";
import { test } from "node:test";
import { templateDraft } from "../../server/draft.js";
import { parsePost, parseProfile } from "../../server/sources/linkedin.js";

const hit = (link: string, title: string, snippet = "") => ({ link, title, snippet });

test("profile: name, headline and a normalised profile link", () => {
  const p = parseProfile(hit("https://de.linkedin.com/in/erika-mustermann-12ab34/en", "Erika Mustermann – Head of Sales | Commercial Growth ...", "Erika Mustermann. Head of Sales."))!;
  assert.equal(p.person!.name, "Erika Mustermann");
  assert.equal(p.person!.title, "Head of Sales | Commercial Growth");
  assert.equal(p.person!.linkedin, "https://www.linkedin.com/in/erika-mustermann-12ab34");
  assert.equal(p.source, "linkedin");
  assert.equal(p.company_name, "Erika Mustermann", "no employer in the headline: the person is the lead");
  assert.equal(p.domain, null);
});

test("profile: the employer is read from 'at', '@' and 'bei' headlines", () => {
  assert.equal(parseProfile(hit("https://www.linkedin.com/in/max-beispiel", "Max Beispiel - VP Sales @beispielsolutions"))!.company_name, "beispielsolutions");
  assert.equal(parseProfile(hit("https://www.linkedin.com/in/jo-sample", "Jo Sample – Head of Supply Chain at Muster Logistik GmbH | LinkedIn"))!.company_name, "Muster Logistik GmbH");
  assert.equal(parseProfile(hit("https://www.linkedin.com/in/ana-exemplo", "Ana Exemplo – Vertriebsleiterin bei Beispiel AG"))!.company_name, "Beispiel AG");
});

test("profile: anything that is not a /in/ page is ignored", () => {
  assert.equal(parseProfile(hit("https://www.linkedin.com/company/beispiel", "Beispiel AG | LinkedIn")), null);
  assert.equal(parseProfile(hit("https://example.com/in/erika", "Erika – Sales")), null);
  assert.equal(parseProfile(hit("https://www.linkedin.com/in/x", "LinkedIn")), null);
});

test("post: the author comes from \"'s Post\" and \"on LinkedIn\" titles; the post is the signal", () => {
  const a = parsePost(hit("https://www.linkedin.com/posts/erika-mustermann-12ab34_websummit-activity-7-AbCd", "Erika Mustermann's Post", "... See you in Lisbon! Web Summit has kicked off."))!;
  assert.equal(a.person!.name, "Erika Mustermann");
  assert.equal(a.person!.linkedin, null, "a post link does not prove which profile wrote it");
  assert.equal(a.signals[0].url, a.source_url);
  assert.match(a.signals[0].label, /^LinkedIn post: See you in Lisbon!/);
  assert.equal(parsePost(hit("https://www.linkedin.com/posts/max_x-activity-1-a", "Max Beispiel on LinkedIn: Heading to the fair next week"))!.person!.name, "Max Beispiel");
});

test("post: a headline-style title is kept as the row name without inventing an author", () => {
  const p = parsePost(hit("https://www.linkedin.com/posts/someone_x-activity-1-a", "Finding Calm Before the Storm", "drop me a line"))!;
  assert.equal(p.person, null);
  assert.equal(p.company_name, "Finding Calm Before the Storm");
  assert.equal(parsePost(hit("https://www.linkedin.com/in/someone", "Someone's Post")), null);
});

test("template draft: built only from the given facts, inside the channel limits", () => {
  const prospect = {
    company_name: "Muster Logistik GmbH", description: null, industry: null, city: "Hamburg",
    signals: [{ kind: "hiring" as const, label: "Hiring: Sales Manager (Hamburg)", url: null }],
    person: { name: "Erika Mustermann", title: "Head of Sales", email: null, linkedin: null, source_url: null },
  };
  const email = templateDraft("email", "We run outbound for logistics firms", prospect);
  assert.equal(email.subject, "Quick question for Muster Logistik GmbH");
  assert.match(email.message, /^Hi Erika,\n\nI saw Muster Logistik GmbH is hiring for Sales Manager \(Hamburg\)\. We run outbound for logistics firms\.\n\nWould a short call be useful\?$/);

  const note = templateDraft("linkedin", "x".repeat(600), { ...prospect, signals: [] });
  assert.equal(note.subject, null);
  assert.ok(note.message.length <= 280, `${note.message.length} characters`);
  assert.match(note.message, /^Hi Erika, I am writing to you as Head of Sales at Muster Logistik GmbH\./);
  assert.match(note.message, /Would a short call be useful\?$/);

  const bare = templateDraft("email", "We sell widgets", { company_name: "Acme", description: null, industry: null, city: null, signals: [] });
  assert.match(bare.message, /^Hi Acme team,\n\nI came across Acme\. We sell widgets\./);
});
