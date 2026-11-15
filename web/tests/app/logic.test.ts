import assert from "node:assert/strict";
import { test } from "node:test";
import type { FoundEmail, Person, Prospect } from "../../shared/types";
import {
  bestEmail, bestEmails, bestPerson, budgetText, codeForStatus, csvCell, enrichBudget, enrichmentPatch, failMessage, filterProspects,
  filtersFromQuery, filtersToQuery, importDomain, importItem, importNote, listNameFor, NO_FILTERS, normDomain, parseImport, planLimits,
  PROSPECT_COLS, prospectExportRow, prospectKey, slug, sortEmails, toCsv, toProspectRows,
} from "../../src/app/logic";

const email = (e: string, status: FoundEmail["status"], kind: FoundEmail["kind"] = "personal"): FoundEmail =>
  ({ email: e, status, kind, reason: null, source_url: null });
const person = (name: string, x: Partial<Person> = {}): Person => ({ name, title: null, email: null, linkedin: null, source_url: null, ...x });
const prospect = (x: Partial<Prospect>): Prospect => ({
  ...importItem("acme.com"), id: 1, workspace_id: "w", list_id: "l", key: "acme.com", emails: [], phones: [], socials: {},
  people: [], tech: [], signals: [], score: null, score_reasons: [], status: "new", error: null, message: null, notes: null,
  created_at: "", updated_at: "", ...x,
});

test("normDomain: urls, emails, www, case, junk", () => {
  assert.equal(normDomain("https://www.Acme.com/about?x=1"), "acme.com");
  assert.equal(normDomain("  WWW.acme.co.uk. "), "acme.co.uk");
  assert.equal(normDomain("jane@acme.io"), "acme.io");
  assert.equal(normDomain("mailto:jane@acme.io"), "acme.io");
  assert.equal(normDomain("http://user:pw@shop.acme.de:8080/x"), "shop.acme.de");
  assert.equal(normDomain("<acme.com>,"), "acme.com");
  assert.equal(normDomain("xn--mnchen-3ya.de"), "xn--mnchen-3ya.de");
  for (const bad of ["", "localhost", "192.168.1.1", "acme", "1.5", "-acme.com", "ac me.com", "javascript:alert(1)", "acme..com"])
    assert.equal(normDomain(bad), null, bad);
});

test("importDomain: registrable domain, or the reason it is not a company", () => {
  const ok = (raw: string, domain: string) => assert.deepEqual(importDomain(raw), { domain }, raw);
  ok("https://www.shop.example.co.uk/path", "example.co.uk");
  ok("http://user:pw@blog.Acme.de:8080/x?y=1", "acme.de");
  ok("jane@mail.acme.io", "acme.io");
  ok("acme.github.io", "acme.github.io");
  ok("xn--mnchen-3ya.de", "xn--mnchen-3ya.de");
  const no = (raw: string, skip: string) => assert.deepEqual(importDomain(raw), { skip }, raw);
  for (const free of ["joe@gmail.com", "outlook.com", "https://yahoo.com/", "x@yahoo.co.uk", "a@hotmail.fr", "b@googlemail.com"]) no(free, "freemail");
  for (const local of ["192.168.1.1", "http://10.0.0.5:3000/admin", "localhost", "localhost:5173", "app.localhost", "http://[::1]:8080/"]) no(local, "local");
  for (const junk of ["", "Company", "dr.smith", "co.uk", "1.5", "acme..com", "javascript:alert(1)"]) no(junk, "invalid");
});

test("parseImport: one company per domain, counted by line with the reason", () => {
  const r = parseImport([
    "Company,Website,Contact",
    '"Acme, Inc.",https://www.shop.acme.co.uk/about,jane@gmail.com',
    "Beta;www.beta.io",
    "acme.co.uk\tgamma.dev | BETA.IO",
    "",
    "blog.acme.co.uk",
    "sam@outlook.com",
    "http://127.0.0.1:8000",
    "not a domain",
  ].join("\r\n"));
  assert.deepEqual(r.domains, ["acme.co.uk", "beta.io", "gamma.dev"]);
  assert.deepEqual(r.skipped, { freemail: 1, local: 1, invalid: 2, duplicate: 1 });
  assert.equal(r.capped, false);
  assert.equal(importNote(r), "Skipped 5 lines: 1 free-mail (gmail.com and similar), 1 IP address or localhost, 2 not a domain, 1 already in this import.");
  assert.deepEqual(parseImport("").domains, []);
  assert.equal(importNote(parseImport("acme.com\nbeta.io")), null);
  assert.equal(importNote(parseImport("joe@gmail.com")), "Skipped 1 line: 1 free-mail (gmail.com and similar).");
});

test("parseImport caps at 1000 and says so", () => {
  const r = parseImport(Array.from({ length: 1200 }, (_, i) => `site${i}.com`).join("\n"));
  assert.equal(r.domains.length, 1000);
  assert.equal(r.capped, true);
  assert.equal(importNote(r), "Only the first 1,000 domains are kept per import.");
});

test("slug + prospectKey", () => {
  assert.equal(slug("  Café Müller & Söhne GmbH  "), "cafe-muller-sohne-gmbh");
  assert.equal(slug("東京ラーメン"), "東京ラーメン");
  assert.equal(prospectKey({ domain: "WWW.Acme.com", company_name: "Acme", city: null }), "acme.com");
  assert.equal(prospectKey({ domain: null, company_name: "Bäckerei Schmidt", city: "Berlin" }), "backerei-schmidt-berlin");
  assert.equal(prospectKey({ domain: null, company_name: "!!!", city: null }), "company");
});

test("toProspectRows drops in-batch duplicates and never stores an empty name", () => {
  const rows = toProspectRows([importItem("acme.com"), importItem("acme.com"), { ...importItem("b.io"), company_name: " " }], "w", "l");
  assert.deepEqual(rows.map((r) => r.key), ["acme.com", "b.io"]);
  assert.equal(rows[1].company_name, "b.io");
  assert.equal(rows[0].workspace_id, "w");
  assert.equal(rows[0].list_id, "l");
});

test("listNameFor", () => {
  assert.equal(listNameFor({ source: "maps", query: "dentists", location: "Lyon" }), "dentists in Lyon");
  assert.equal(listNameFor({ source: "startups", hiring: true, industry: "fintech" }), "fintech · hiring");
  assert.equal(listNameFor({ source: "startups" }), "Startups");
  assert.equal(listNameFor({ source: "directory", url: "https://www.expo.com/exhibitors" }), "Directory: expo.com");
  assert.equal(listNameFor({ source: "import" }, "2026-11-15"), "Import 2026-11-15");
  assert.equal(listNameFor({ source: "web", query: "x".repeat(300) }).length, 160);
});

test("bestEmail: deliverable beats risky, never an invalid one, falls back to the source email", () => {
  const emails = [email("bad@a.com", "invalid"), email("info@a.com", "valid", "role"), email("g@a.com", "risky", "guessed"), email("jo@a.com", "valid")];
  assert.deepEqual(sortEmails(emails).map((e) => e.email), ["jo@a.com", "info@a.com", "g@a.com", "bad@a.com"]);
  assert.equal(bestEmail({ emails, email: null })?.email, "jo@a.com");
  assert.equal(bestEmail({ emails: [email("bad@a.com", "invalid")], email: null }), null);
  assert.deepEqual(bestEmail({ emails: [], email: "hi@a.com" }), { email: "hi@a.com", status: "unknown", kind: null });
});

test("bestPerson: reachable first, then senior, then page order", () => {
  assert.equal(bestPerson([]), null);
  assert.equal(bestPerson(null), null);
  const people = [person("Intern"), person("Boss", { title: "Founder & CEO" }), person("Sales", { title: "Sales rep", email: "s@a.com" })];
  assert.equal(bestPerson(people)?.name, "Sales");
  assert.equal(bestPerson(people.slice(0, 2))?.name, "Boss");
  assert.equal(bestPerson([person("A"), person("B")])?.name, "A");
});

test("filterProspects", () => {
  const rows = [
    prospect({ id: 1, company_name: "Zeta", score: 40, status: "enriched", emails: [email("z@zeta.com", "valid")] }),
    prospect({ id: 2, company_name: "Alpha", score: 90, status: "enriched", people: [person("Ann Lee")] }),
    prospect({ id: 3, company_name: "Mid", domain: "mid.io", status: "failed" }),
  ];
  const ids = (f: Partial<typeof NO_FILTERS>) => filterProspects(rows, { ...NO_FILTERS, ...f }).map((p) => p.id);
  assert.deepEqual(ids({}), [2, 1, 3]);
  assert.deepEqual(ids({ sort: "name", dir: "asc" }), [2, 3, 1]);
  assert.deepEqual(ids({ sort: "name", dir: "desc" }), [1, 3, 2]);
  assert.deepEqual(ids({ sort: "added", dir: "asc" }), [1, 2, 3]);
  assert.deepEqual(ids({ sort: "score", dir: "asc" }), [3, 1, 2], "no score sorts below every score");
  assert.deepEqual(ids({ sort: "status", dir: "asc" }), [1, 2, 3], "new < enriching < enriched < failed, ties in input order");
  assert.deepEqual(ids({ sort: "status", dir: "desc" }), [3, 1, 2]);
  assert.deepEqual(ids({ hasEmail: true }), [1]);
  assert.deepEqual(ids({ hasPerson: true }), [2]);
  assert.deepEqual(ids({ status: "failed" }), [3]);
  assert.deepEqual(ids({ minScore: 50 }), [2]);
  assert.deepEqual(ids({ q: "ann" }), [2]);
  assert.deepEqual(ids({ q: "ZETA.COM" }), [1]);
  assert.equal(rows[0].id, 1, "input is not mutated");
});

test("filterProspects sorts by last updated, as instants not as text", () => {
  const rows = [
    prospect({ id: 1, updated_at: "2026-11-14T09:00:00+00:00" }),
    prospect({ id: 2, updated_at: "2026-11-15T08:30:00.5+00:00" }),
    prospect({ id: 3, updated_at: "2026-11-15T10:30:00+02:00" }),
  ];
  const ids = (dir: "asc" | "desc") => filterProspects(rows, { ...NO_FILTERS, sort: "updated", dir }).map((p) => p.id);
  assert.deepEqual(ids("desc"), [2, 3, 1]);
  assert.deepEqual(ids("asc"), [1, 3, 2]);
});

test("filters survive a round trip through the query string; defaults are left out", () => {
  assert.deepEqual(filtersToQuery(NO_FILTERS), {});
  const f = { q: "acme ", hasEmail: true, hasPerson: true, status: "failed" as const, minScore: 60, sort: "name" as const, dir: "desc" as const };
  const query = filtersToQuery(f);
  assert.deepEqual(query, { q: "acme ", email: "1", person: "1", status: "failed", min: "60", sort: "name", dir: "desc" });
  assert.deepEqual(filtersFromQuery(new URLSearchParams(query)), f);
  assert.deepEqual(filtersToQuery({ ...NO_FILTERS, sort: "updated", dir: "desc" }), { sort: "updated" }, "the natural direction of a column is implied");
  assert.deepEqual(filtersFromQuery(new URLSearchParams("sort=name")), { ...NO_FILTERS, sort: "name", dir: "asc" });
  assert.deepEqual(filtersFromQuery(new URLSearchParams("")), NO_FILTERS);
});

test("filtersFromQuery ignores values nobody could have picked", () => {
  const f = filtersFromQuery(new URLSearchParams("sort=constructor&dir=sideways&status=deleted&min=9000&email=yes&q=" + "x".repeat(500)));
  assert.deepEqual({ ...f, q: "" }, NO_FILTERS);
  assert.equal(f.q.length, 200);
  assert.equal(filtersFromQuery(new URLSearchParams("min=-5")).minScore, 0);
  assert.equal(filtersFromQuery(new URLSearchParams("min=abc")).minScore, 0);
});

test("bestEmails: one usable address per company, no repeats", () => {
  assert.deepEqual(bestEmails([
    prospect({ emails: [email("bad@a.com", "invalid"), email("jo@a.com", "valid")] }),
    prospect({ email: "hi@b.com" }), prospect({}), prospect({ emails: [email("jo@a.com", "risky")] }),
    prospect({ emails: [email("dead@c.com", "invalid")] }),
  ]), ["jo@a.com", "hi@b.com"]);
});

test("csv: quoting and formula injection", () => {
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell(null), '""');
  for (const evil of ["=1+1", "+1", "-1", "@SUM(A1)", "  =cmd|' /C calc'!A0", "\t=1", "+1 555 0100+cmd|' /C calc'!A0", "+SUM(1)", "+49 30 1234\t=1", "-49 30 123456"])
    assert.ok(csvCell(evil).startsWith(`"'`), evil);
  for (const phone of ["+1 555 0100", "+49 (0)30 1234-5678", "+33.1.23.45.67.89"]) assert.equal(csvCell(phone), `"${phone}"`, "a phone number reaches the CRM as typed");
  assert.equal(toCsv(["a", "b"], [{ a: 1, b: "x,y" }, { a: "=2" }]), '"a","b"\r\n"1","x,y"\r\n"\'=2",""');
});

test("prospectExportRow picks the best contact and flattens lists", () => {
  const r = prospectExportRow(prospect({
    emails: [email("info@acme.com", "valid", "role"), email("jo@acme.com", "valid")], phones: ["+1 555"],
    people: [person("Jo", { title: "CEO", linkedin: "https://linkedin.com/in/jo" })], tech: ["Shopify", "Stripe"],
    socials: { linkedin: "https://linkedin.com/company/acme" },
  }));
  assert.equal(r.email, "jo@acme.com");
  assert.equal(r.email_status, "valid");
  assert.equal(r.all_emails, "info@acme.com;jo@acme.com");
  assert.equal(r.contact_name, "Jo");
  assert.equal(r.contact_title, "CEO");
  assert.equal(r.phone, "+1 555");
  assert.equal(r.tech, "Shopify;Stripe");
  assert.equal(r.linkedin_company_url, "https://linkedin.com/company/acme");
  assert.equal(r.company, "acme.com");
});

test("export: only the CRM columns, and the email belongs to the named contact", () => {
  const p = prospect({
    company_name: "Acme", city: "Lyon", country: "FR", industry: "Bakery", score: 81, source_url: "https://maps.example/acme", notes: "=call", message: "Hi",
    email: "hello@acme.com", emails: [email("ann@acme.com", "valid"), email("bo@acme.com", "risky")],
    people: [person("Ann"), person("Bo", { title: "Owner", email: "bo@acme.com" })],
  });
  const r = prospectExportRow(p);
  assert.deepEqual(Object.keys(r), PROSPECT_COLS, "no internal column (id, workspace, raw json) leaks into the file");
  assert.deepEqual([r.contact_name, r.email, r.email_status], ["Bo", "bo@acme.com", "risky"]);
  assert.equal(r.all_emails, "ann@acme.com;bo@acme.com;hello@acme.com");
  assert.deepEqual([r.city, r.country, r.industry, r.score, r.source, r.source_url], ["Lyon", "FR", "Bakery", 81, "import", "https://maps.example/acme"]);
  assert.match(toCsv(PROSPECT_COLS, [r]), /"'=call","Hi"$/, "formula cells stay escaped in the export");
  // the contact's own address is known-bad: fall back to the best usable one
  const bad = prospectExportRow({ ...p, emails: [email("ann@acme.com", "valid"), email("bo@acme.com", "invalid")] });
  assert.deepEqual([bad.contact_name, bad.email, bad.email_status], ["Bo", "ann@acme.com", "valid"]);
  // a contact address the crawl never checked is exported as unknown, not as valid
  const unchecked = prospectExportRow({ ...p, emails: [] });
  assert.deepEqual([unchecked.email, unchecked.email_status], ["bo@acme.com", "unknown"]);
});

test("enrichBudget caps a run at what is left today", () => {
  assert.deepEqual(enrichBudget(37, 37, 200), { n: 37, remaining: 163, held: 0 });
  assert.deepEqual(enrichBudget(300, 37, 200), { n: 163, remaining: 163, held: 137 });
  assert.deepEqual(enrichBudget(5, 200, 200), { n: 0, remaining: 0, held: 5 });
  assert.deepEqual(enrichBudget(5, 250, 200), { n: 0, remaining: 0, held: 5 }, "over the limit is not negative");
  assert.equal(budgetText(enrichBudget(37, 37, 200)), "This will use 37 of your 163 remaining enrichments today.");
  assert.equal(budgetText(enrichBudget(6000, 1000, 5000)),
    "This will use 4,000 of your 4,000 remaining enrichments today. The other 2,000 stay pending until the limit resets at midnight UTC.");
  assert.match(budgetText(enrichBudget(5, 200, 200)), /^You have no enrichments left today/);
});

test("planLimits scales the free limits", () => {
  assert.equal(planLimits("free").enrich, 200);
  assert.equal(planLimits("pro").enrich, 5000);
  assert.equal(planLimits("team").discover, 4000);
  assert.equal(planLimits(undefined).draft, 60);
});

test("failMessage + codeForStatus", () => {
  assert.match(failMessage("quota", "enrich"), /^Daily limit reached for your plan/);
  assert.equal(failMessage("not_configured", "draft"), "AI drafting is not enabled on this deployment yet.");
  assert.notEqual(failMessage("not_configured", "extract"), failMessage("not_configured", "draft"));
  assert.match(failMessage("blocked", "extract", "robots.txt disallows"), /does not allow automated access \(robots\.txt disallows\)/);
  assert.equal(failMessage("bad_request", "discover", "location is required"), "location is required");
  assert.ok(failMessage("bad_request", "discover", "").length > 10);
  assert.deepEqual([401, 429, 422, 503, 502, 404, 400].map(codeForStatus),
    ["unauthorized", "quota", "blocked", "not_configured", "upstream", "unavailable", "bad_request"]);
});

test("enrichmentPatch keeps source facts, fills gaps, sorts emails", () => {
  const e = {
    domain: "acme.com", website: "https://acme.com", company_name: "Acme Inc", description: "Crawled", language: "en",
    emails: [email("x@acme.com", "invalid"), email("jo@acme.com", "valid")], phones: ["+1 555"], socials: {}, people: [], tech: ["Stripe"],
    address: "1 Main St", pages_crawled: 3, score: 72, score_reasons: ["named contact"],
  };
  const imported = enrichmentPatch({ company_name: "acme.com", domain: "acme.com", website: null, phone: null, address: null, description: null }, e);
  assert.equal(imported.company_name, "Acme Inc");
  assert.equal(imported.phone, "+1 555");
  assert.equal(imported.emails[0].email, "jo@acme.com");
  assert.equal(imported.status, "enriched");
  const sourced = enrichmentPatch({ company_name: "Acme Bakery", domain: "acme.com", website: "https://acme.com/de", phone: "030 1", address: "Berlin", description: "From maps" }, e);
  assert.deepEqual([sourced.company_name, sourced.website, sourced.phone, sourced.address, sourced.description],
    ["Acme Bakery", "https://acme.com/de", "030 1", "Berlin", "From maps"]);
});

test("re-enriching merges: contacts found earlier are never lost", () => {
  const before = {
    company_name: "Acme", domain: "acme.com", website: "https://acme.com", phone: "+1 555", address: "1 Main St", description: "Bakery",
    emails: [email("Jo@Acme.com", "valid"), email("old@acme.com", "risky", "role")], phones: ["+1 555", "+1 777"],
    socials: { linkedin: "https://linkedin.com/company/acme", twitter: "https://x.com/acme" },
    people: [person("Jo Müller", { title: "CEO", email: "jo@acme.com" }), person("Sam Old", { title: "CTO" })], tech: ["Shopify"],
  };
  // a thin second crawl: the team page was blocked, one address now bounces, one social changed
  const again = {
    domain: "acme.com", website: "https://acme.com", company_name: null, description: null, language: null, address: null,
    emails: [email("jo@acme.com", "invalid"), email("new@acme.com", "valid")], phones: ["+1 999", "+1 555"],
    socials: { twitter: "https://x.com/acmehq", facebook: "" }, tech: ["Stripe", "Shopify"],
    people: [person("jo muller", { linkedin: "https://linkedin.com/in/jo" }), person("Ann New")],
    pages_crawled: 1, score: 40, score_reasons: ["one page"],
  };
  const m = enrichmentPatch(before, again);
  assert.deepEqual(m.emails.map((e) => [e.email, e.status]), [["new@acme.com", "valid"], ["old@acme.com", "risky"], ["jo@acme.com", "invalid"]],
    "union on the lowercased address; the fresh check replaces the old record");
  assert.deepEqual(m.people, [
    { name: "jo muller", title: "CEO", email: "jo@acme.com", linkedin: "https://linkedin.com/in/jo", source_url: null },
    person("Sam Old", { title: "CTO" }), person("Ann New"),
  ], "same person by normalised name: new facts are added, empty ones never erase");
  assert.deepEqual(m.phones, ["+1 555", "+1 777", "+1 999"]);
  assert.deepEqual(m.tech, ["Shopify", "Stripe"]);
  assert.deepEqual(m.socials, { linkedin: "https://linkedin.com/company/acme", twitter: "https://x.com/acmehq" });
  assert.deepEqual([m.description, m.address, m.phone], ["Bakery", "1 Main St", "+1 555"]);
  assert.deepEqual([m.score, m.status], [40, "enriched"]);
  // an empty crawl changes nothing that was known
  const empty = enrichmentPatch(before, { ...again, emails: [], phones: [], socials: {}, people: [], tech: [] });
  assert.deepEqual([empty.emails.length, empty.people.length, empty.phones, empty.tech, empty.socials],
    [2, 2, before.phones, before.tech, before.socials]);
});
