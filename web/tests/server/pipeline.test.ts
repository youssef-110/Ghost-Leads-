// End-to-end runs of the engine against canned pages: enrichment crawl, directory walk, extraction and drafting.
// The web, DNS and OpenAI are all stubbed; nothing here touches the network.
import assert from "node:assert/strict";
import { Resolver } from "node:dns/promises";
import { afterEach, beforeEach, mock, test } from "node:test";
import { draft } from "../../server/draft.js";
import { enrich } from "../../server/enrich.js";
import { extract } from "../../server/extract.js";
import { directory } from "../../server/sources/directory.js";
import { HTML, cannedFetch, cannedHttps, completion } from "./helpers.js";

const page = (body: string) => ({ status: 200, headers: HTML, body });
let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  // every domain "accepts mail", except those under nomail.test
  mock.method(Resolver.prototype, "resolveMx", async (domain: string) => {
    if (domain.endsWith("nomail.test")) throw Object.assign(new Error("no data"), { code: "ENODATA" });
    return [{ exchange: "mx." + domain, priority: 10 }];
  });
});
afterEach(() => {
  mock.restoreAll();
  if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey;
});

test("enrich crawls the homepage and its contact, imprint and team pages and reports only what they publish", async () => {
  const requested = cannedHttps({
    "https://muster-software.de/": page(`<html lang="de-DE"><head><title>Start | Muster Software GmbH</title>
      <meta name="description" content="Software für den Mittelstand."><meta name="generator" content="WordPress 6.5">
      <script src="https://js.hs-scripts.com/1.js"></script></head><body>
      <a href="/kontakt">Kontakt</a><a href="/impressum">Impressum</a><a href="/team">Team</a><a href="/blog/team-event">Blog</a>
      <footer><a href="https://www.linkedin.com/company/muster-software">LinkedIn</a><a href="mailto:info@muster-software.de">info@muster-software.de</a>
      <span>Webdesign: <a href="mailto:hallo@agentur.test">Agentur</a></span></footer></body></html>`),
    "https://muster-software.de/kontakt": page(`<p>Telefon: +49 681 123456</p><p>Fax: +49 681 123457</p>
      <p>E-Mail: erika.musterfrau [at] muster-software [dot] de</p>
      <footer><a href="https://www.linkedin.com/company/muster-software">LinkedIn</a></footer>`),
    "https://muster-software.de/impressum": page(`<h1>Impressum</h1><p>Muster Software GmbH<br>Musterstraße 12<br>66111 Saarbrücken</p>
      <p>Geschäftsführer: Dr. Max Mustermann</p><p>Registergericht: Amtsgericht Saarbrücken, HRB 12345</p>`),
    "https://muster-software.de/team": page(`<div class="member"><h3>Erika Musterfrau</h3><p>Leiterin Vertrieb</p></div>
      <div class="member"><h3>Max Mustermann</h3><p>Geschäftsführer</p></div>
      <div class="member"><h3>Jörg Weiß</h3><p>Head of Engineering</p><a href="https://www.linkedin.com/in/joerg-weiss">in</a></div>`),
  });
  const r = await enrich("muster-software.de");

  // the three linked pages, plus a guess for the "about" page the homepage does not link (a 404 here); never the blog
  assert.deepEqual(requested.filter((u) => !u.endsWith("/robots.txt")).sort(), [
    "https://muster-software.de/", "https://muster-software.de/about", "https://muster-software.de/impressum",
    "https://muster-software.de/kontakt", "https://muster-software.de/team",
  ]);
  assert.equal(r.website, "https://muster-software.de/");
  assert.equal(r.company_name, "Muster Software GmbH");
  assert.equal(r.description, "Software für den Mittelstand.");
  assert.equal(r.language, "de");
  assert.equal(r.pages_crawled, 4);
  assert.deepEqual(r.phones, ["+49681123456"]); // the fax number is not a phone
  assert.equal(r.address, "Musterstraße 12, 66111 Saarbrücken");
  assert.deepEqual(r.socials, { linkedin: "https://www.linkedin.com/company/muster-software" });
  assert.deepEqual(r.tech, ["WordPress", "HubSpot"]);

  // decision maker first; each person cites the page that names them
  assert.deepEqual(r.people.map((p) => [p.name, p.title, p.email, p.source_url]), [
    ["Max Mustermann", "Geschäftsführer", null, "https://muster-software.de/impressum"],
    ["Erika Musterfrau", "Leiterin Vertrieb", "erika.musterfrau@muster-software.de", "https://muster-software.de/team"],
    ["Jörg Weiß", "Head of Engineering", null, "https://muster-software.de/team"],
  ]);
  assert.equal(r.people[2].linkedin, "https://www.linkedin.com/in/joerg-weiss");

  // published addresses are "valid" with their source; the agency's address is dropped; guesses follow the
  // pattern Erika's address reveals and are labelled as guesses
  assert.deepEqual(r.emails.map((m) => [m.email, m.kind, m.status, m.source_url]), [
    ["info@muster-software.de", "role", "valid", "https://muster-software.de/"],
    ["erika.musterfrau@muster-software.de", "personal", "valid", "https://muster-software.de/kontakt"],
    ["max.mustermann@muster-software.de", "guessed", "risky", null],
    ["joerg.weiss@muster-software.de", "guessed", "risky", null],
  ]);
  assert.match(r.emails[0].reason!, /not SMTP-tested/);
  assert.match(r.emails[2].reason!, /guess for Max Mustermann, following the pattern of erika\.musterfrau@muster-software\.de; not confirmed/);
  assert.equal(r.score, 100);
});

test("enrich: no MX means published addresses are invalid and nothing is guessed; www fallback; blocked homepage", async () => {
  cannedHttps({
    "https://www.nomail.test/": page('<title>No Mail Inc</title><a href="mailto:info@nomail.test">Mail</a><h3>Jane Doe</h3><p>CEO</p>'),
    "https://closed.test/robots.txt": { status: 200, headers: { "content-type": "text/plain" }, body: "User-agent: *\nDisallow: /" },
  });
  const r = await enrich("nomail.test"); // apex answers 404, www works
  assert.equal(r.website, "https://www.nomail.test/");
  assert.deepEqual(r.emails.map((m) => [m.email, m.status, m.reason]), [["info@nomail.test", "invalid", "no MX record: this domain cannot receive mail"]]);
  assert.deepEqual(r.people.map((p) => p.name), ["Jane Doe"]);
  assert.ok(r.score_reasons.includes("The domain has no mail server, so email will bounce"));
  await assert.rejects(enrich("closed.test"), { code: "blocked" });
});

test("directory follows pagination and stops at the limit", async () => {
  const list = (names: string[], next?: string) => page(`<ul>${names.map((n) => `<li><a href="https://${n}.test/">${n} GmbH</a></li>`).join("")}</ul>` +
    (next ? `<a rel="next" href="${next}">Weiter</a>` : ""));
  const requested = cannedHttps({
    "https://expo.test/aussteller": list(["alpha", "beta", "gamma"], "/aussteller?seite=2"),
    "https://expo.test/aussteller?seite=2": list(["delta", "epsilon", "zeta"], "/aussteller?seite=3"),
    "https://expo.test/aussteller?seite=3": list(["eta", "theta", "iota"]),
  });
  const all = await directory("https://expo.test/aussteller", 50);
  assert.deepEqual(all.items.map((i) => i.domain), ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota"].map((n) => n + ".test"));
  assert.equal(all.items[4].source_url, "https://expo.test/aussteller?seite=2");
  assert.equal(all.note, null);
  assert.equal(requested.filter((u) => u.includes("aussteller")).length, 3);

  const few = await directory("https://expo.test/aussteller", 4);
  assert.equal(few.items.length, 4);
});

test("directory without structure: an honest empty result, or AI reading that cannot invent names or links", async () => {
  cannedHttps({
    "https://club.test/members": page(`<h1>Our members</h1><p>Nordwind e.K., Südstern GmbH and Ostwerk AG are members.</p>
      <p>See <a href="https://nordwind.test/">nordwind.test</a>.</p>`),
  });
  const none = await directory("https://club.test/members", 20);
  assert.deepEqual(none.items, []);
  assert.match(none.note!, /AI extraction, which is not configured/);

  process.env.OPENAI_API_KEY = "test-key";
  const calls = cannedFetch(() => completion({ companies: [
    { company_name: "Nordwind e.K.", website_url: "https://nordwind.test/" },
    { company_name: "Südstern GmbH", website_url: "https://made-up.test/" }, // not a link on the page
    { company_name: "Westfabrik SE", website_url: null },                    // not named on the page
  ] }));
  const ai = await directory("https://club.test/members", 20);
  assert.deepEqual(ai.items.map((i) => [i.company_name, i.website, i.source_url]), [
    ["Nordwind e.K.", "https://nordwind.test/", "https://club.test/members"], ["Südstern GmbH", null, "https://club.test/members"],
  ]);
  assert.match(ai.note!, /read by AI/);
  assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(calls[0].headers.authorization, "Bearer test-key");
});

test("extract: structure without a key (with a note when columns were asked for), AI with exactly the requested columns", async () => {
  cannedHttps({
    "https://shop.test/list": page("<table><tr><th>Name</th><th>Price</th></tr><tr><td>Widget</td><td>9,90 €</td></tr><tr><td>Gadget</td><td>12 €</td></tr></table>"),
  });
  const plain = await extract("https://shop.test/list", []);
  assert.deepEqual([plain.method, plain.columns, plain.rows.length, plain.note], ["table", ["Name", "Price"], 2, null]);
  const wanted = await extract("https://shop.test/list", ["Product", "Cost"]);
  assert.equal(wanted.method, "table");
  assert.match(wanted.note!, /AI extraction is not configured/);

  process.env.OPENAI_API_KEY = "test-key";
  const calls = cannedFetch(() => completion({ columns: ["ignored"], rows: [["Widget", "9,90 €", "extra"], ["Gadget"]] }));
  const ai = await extract("https://shop.test/list", ["Product", "Cost"], "all products");
  assert.deepEqual(ai, { columns: ["Product", "Cost"], rows: [{ Product: "Widget", Cost: "9,90 €" }, { Product: "Gadget", Cost: null }], method: "ai", note: null });
  const sent = calls[0].body as { model: string; response_format: { type: string; json_schema: { strict: boolean } }; messages: { content: string }[] };
  assert.equal(sent.model, "gpt-4.1-mini");
  assert.deepEqual([sent.response_format.type, sent.response_format.json_schema.strict], ["json_schema", true]);
  assert.match(sent.messages[0].content, /Never guess, infer or invent/);
  assert.match(sent.messages[1].content, /Widget\n9,90 €/);

  cannedFetch(() => ({ error: { code: "expired_secret_key" } }), 401); // a dead key must not cost the user the page
  const fallback = await extract("https://shop.test/list", ["Product", "Cost"]);
  assert.deepEqual([fallback.method, fallback.rows.length], ["table", 2]);
  assert.match(fallback.note!, /AI extraction failed just now/);
});

test("draft: honesty rules in the prompt, facts only from the request, length limits enforced by retry", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const prospect = { company_name: "Acme GmbH", description: "Industrial widgets", industry: "Manufacturing", city: "Berlin",
    signals: [{ kind: "hiring" as const, label: "Hiring: Sales Manager", url: null }], person: { name: "Anna Schmidt", title: "CEO", email: null, linkedin: null, source_url: null } };
  const answers = [{ subject: null, message: "x".repeat(400) }, { subject: null, message: "Hi Anna,\nsaw Acme is hiring a Sales Manager.\nOpen to a short chat?" }];
  const calls = cannedFetch(() => completion(answers.shift()));
  const note = await draft("linkedin", "We book meetings from events.", prospect);
  assert.deepEqual(note, { subject: null, message: "Hi Anna,\nsaw Acme is hiring a Sales Manager.\nOpen to a short chat?" });
  assert.equal(calls.length, 2);
  const first = calls[0].body as { messages: { role: string; content: string }[] };
  assert.match(first.messages[0].content, /Never invent numbers/);
  assert.match(first.messages[0].content, /Never claim you met/);
  assert.match(first.messages[1].content, /OFFER: We book meetings from events\./);
  assert.match(first.messages[1].content, /"signals":\["Hiring: Sales Manager"\]/);
  assert.match((calls[1].body as typeof first).messages.at(-1)!.content, /That is 400 characters/);

  cannedFetch(() => completion({ subject: " Widgets and events ", message: "Hello Anna, short and true." }));
  assert.deepEqual(await draft("email", "We book meetings from events.", prospect), { subject: "Widgets and events", message: "Hello Anna, short and true." });

  cannedFetch(() => completion({ subject: "s", message: "word ".repeat(200) }));
  await assert.rejects(draft("email", "offer", prospect), { code: "upstream" });

  cannedFetch(() => ({ error: { message: "expired" } }), 401);
  await assert.rejects(draft("email", "offer", prospect), { code: "upstream" });
});
