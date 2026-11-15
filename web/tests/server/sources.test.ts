// Mapping and filtering logic of the discovery sources, on recorded response shapes. No network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { nameFromTitle } from "../../server/html.js";
import { groupJobs } from "../../server/sources/hiring.js";
import { companyDomain, dedupe, item, searchResultDomain } from "../../server/sources/item.js";
import { categoryTags, overpassQuery, toElement, toItem } from "../../server/sources/maps.js";
import { filterCompanies, toItem as startupItem } from "../../server/sources/startups.js";
import { parseDuckDuckGo, toItems } from "../../server/sources/web.js";

test("maps: search words map to OSM tags, English and German", () => {
  assert.deepEqual(categoryTags("Dentist"), [["amenity", "dentist"], ["healthcare", "dentist"]]);
  assert.deepEqual(categoryTags("Zahnarzt")?.[0], ["amenity", "dentist"]);
  assert.deepEqual(categoryTags("IT company")?.[0], ["office", "it"]);
  assert.deepEqual(categoryTags("marketing agency")?.[0], ["office", "advertising_agency"]);
  assert.deepEqual(categoryTags("travel agency")?.[0], ["shop", "travel_agency"]); // specific agency before generic
  assert.deepEqual(categoryTags("Steuerberater")?.[0], ["office", "accountant"]);
  assert.deepEqual(categoryTags("Rechtsanwalt")?.[0], ["office", "lawyer"]);
  assert.deepEqual(categoryTags("hotel")?.[0], ["tourism", "hotel"]);
  assert.deepEqual(categoryTags("gym")?.[0], ["leisure", "fitness_centre"]);
  assert.deepEqual(categoryTags("restaurants")?.[0], ["amenity", "restaurant"]);
  assert.equal(categoryTags("Müller & Söhne"), null);
});

test("maps: Overpass QL for a category and for a name, with regex characters escaped", () => {
  assert.equal(overpassQuery("lawyer", "1,2,3,4"),
    '[out:json][timeout:25];(nwr["office"="lawyer"](1,2,3,4);nwr["office"="notary"](1,2,3,4););out center tags 400;');
  assert.equal(overpassQuery('Pizza "Hut" (City)', "1,2,3,4"),
    '[out:json][timeout:25];(nwr["name"~"Pizza Hut \\\\(City\\\\)",i][~"^(office|shop|craft|amenity|healthcare|tourism|leisure)$"~"."](1,2,3,4););out center tags 400;');
});

test("maps: an OSM element becomes a lead with contact data and its OSM page as source", () => {
  const el = { type: "node", id: 42, tags: {
    name: "Zahnarztpraxis  Dr. Beispiel", amenity: "dentist", "contact:website": "www.praxis-beispiel.de", phone: "+49 681 12345;+49 681 99999",
    "contact:email": "Info@Praxis-Beispiel.de", "addr:street": "Bahnhofstraße", "addr:housenumber": "14", "addr:postcode": "66111", "addr:city": "Saarbrücken",
  } };
  assert.deepEqual(toItem(el, { name: "Saarbrücken", country: "Germany", countryCode: "de" }), {
    company_name: "Zahnarztpraxis Dr. Beispiel", website: "https://www.praxis-beispiel.de", domain: "praxis-beispiel.de", phone: "+4968112345",
    email: "info@praxis-beispiel.de", address: "Bahnhofstraße 14, 66111 Saarbrücken", city: "Saarbrücken", country: "Germany",
    industry: "dentist", description: null, source: "maps", source_url: "https://www.openstreetmap.org/node/42", signals: [],
  });
  assert.equal(toItem({ type: "way", id: 1, tags: { amenity: "dentist" } }, { name: "X", country: null }), null); // unnamed
  const us = toItem({ type: "way", id: 7, tags: { name: "Acme IT", office: "it", "addr:street": "Main Street", "addr:housenumber": "500" } }, { name: "Austin", country: "United States", countryCode: "us" });
  assert.equal(us?.address, "500 Main Street, Austin");
  // a Facebook page is a way to reach the business but not its domain
  const fb = toItem({ type: "node", id: 8, tags: { name: "Café Lisa", amenity: "cafe", website: "https://www.facebook.com/cafelisa" } }, { name: "X", country: null });
  assert.deepEqual([fb?.website, fb?.domain], ["https://www.facebook.com/cafelisa", null]);
});

test("maps: Nominatim hits convert to the same element shape", () => {
  const el = toElement({
    osm_type: "node", osm_id: 9, name: "Kanzlei Recht", category: "office", type: "lawyer", boundingbox: [],
    extratags: { website: "https://kanzlei-recht.de", "contact:phone": "+49 681 555" },
    address: { road: "Am Markt", house_number: "3", postcode: "66111", town: "Saarbrücken" },
  });
  assert.deepEqual(el, { type: "node", id: 9, tags: {
    website: "https://kanzlei-recht.de", "contact:phone": "+49 681 555", name: "Kanzlei Recht", office: "lawyer",
    "addr:street": "Am Markt", "addr:housenumber": "3", "addr:postcode": "66111", "addr:city": "Saarbrücken",
  } });
  assert.equal(toItem(el, { name: "Saarbrücken", country: "Germany", countryCode: "de" })?.industry, "lawyer");
});

test("company domains: platforms never count, search noise only in search results", () => {
  assert.equal(companyDomain("https://www.acme-widgets.co.uk/about"), "acme-widgets.co.uk");
  for (const url of ["https://www.linkedin.com/company/acme", "https://facebook.com/acme", "https://github.com/acme", "https://de.wikipedia.org/wiki/Acme", "http://10.0.0.1/", null]) {
    assert.equal(companyDomain(url), null, String(url));
  }
  assert.equal(companyDomain("https://aws.amazon.com/"), "amazon.com");       // a real member on a sponsor list
  assert.equal(searchResultDomain("https://www.amazon.com/dp/B0"), null);     // noise in search results
  assert.equal(searchResultDomain("https://www.yelp.com/biz/acme"), null);
  assert.equal(searchResultDomain("https://acme.com/"), "acme.com");
});

test("dedupe keeps the first item per domain, and per name without a domain", () => {
  const items = [
    item("web", "Acme", { website: "https://acme.com/" }), item("web", "Acme Blog", { website: "https://blog.acme.com/x" }),
    item("hiring", "No Site Ltd"), item("hiring", "no site ltd"), item("hiring", "Other Ltd"),
  ];
  assert.deepEqual(dedupe(items).map((i) => i.company_name), ["Acme", "No Site Ltd", "Other Ltd"]);
});

test("web: search hits become company sites; directories, socials and duplicates are dropped", () => {
  const items = toItems([
    { title: "Dentrix | Dental Practice Management Software", link: "https://www.dentrix.com/products/dentrix", snippet: "Run your practice." },
    { title: "Best Dental Software 2026 - Capterra", link: "https://www.capterra.com/dental-software/", snippet: "Compare" },
    { title: "Dentrix (@dentrix) on LinkedIn", link: "https://www.linkedin.com/company/dentrix", snippet: "" },
    { title: "Pricing - Dentrix", link: "https://www.dentrix.com/pricing", snippet: "dup" },
    { title: "Open Dental Software", link: "https://www.opendental.com/", snippet: "" },
  ]);
  assert.deepEqual(items.map((i) => [i.company_name, i.domain, i.website, i.source_url, i.description]), [
    ["Dentrix", "dentrix.com", "https://www.dentrix.com/", "https://www.dentrix.com/products/dentrix", "Run your practice."],
    ["Open Dental Software", "opendental.com", "https://www.opendental.com/", "https://www.opendental.com/", null],
  ]);
});

test("web: company name is the title part that matches the domain", () => {
  assert.equal(nameFromTitle("Family Dentist in Austin | Acme Dental", "acmedental.com"), "Acme Dental");
  assert.equal(nameFromTitle("Home - Müller & Söhne GmbH", "mueller-soehne.de"), "Müller & Söhne GmbH");
  assert.equal(nameFromTitle("", "acme.io"), "acme.io");
});

test("web: DuckDuckGo result page parsing, including its redirect links", () => {
  const hits = parseDuckDuckGo(`<div class="results">
    <div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Facme.com%2Fabout&amp;rut=abc">Acme - About</a><a class="result__snippet">We make widgets.</a></div>
    <div class="result"><a class="result__a" href="https://globex.test/">Globex</a></div>
    <div class="result result--ad"><a class="result__a" href="https://duckduckgo.com/y.js?ad_provider=x">Ad</a></div>
  </div>`);
  assert.deepEqual(hits, [
    { title: "Acme - About", link: "https://acme.com/about", snippet: "We make widgets." },
    { title: "Globex", link: "https://globex.test/", snippet: "" },
  ]);
  assert.deepEqual(parseDuckDuckGo("<html><body>Unfortunately, bots use DuckDuckGo too.</body></html>"), []);
});

const yc = (over: Record<string, unknown>) => ({
  name: "X", website: "https://x.test", all_locations: "Berlin, Germany", one_liner: "", long_description: "", team_size: 10,
  industry: "B2B", industries: ["B2B"], tags: [], regions: ["Germany", "Europe"], batch: "Winter 2024", status: "Active", isHiring: false,
  url: "https://www.ycombinator.com/companies/x", ...over,
}) as Parameters<typeof startupItem>[0];

test("startups: text, industry, location and hiring filters; dead companies are skipped", () => {
  const all = [
    yc({ name: "DentAI", one_liner: "AI receptionist for dental clinics", industry: "Healthcare", industries: ["Healthcare"], all_locations: "San Francisco, CA, USA", regions: ["United States of America"], isHiring: true }),
    yc({ name: "BigCo", long_description: "We also serve dental labs.", team_size: 900 }),
    yc({ name: "DeadDental", one_liner: "dental stuff", status: "Inactive" }),
    yc({ name: "NoSite Dental", one_liner: "dental", website: null }),
    yc({ name: "Taktile", one_liner: "Decision engine", industry: "Fintech", industries: ["Fintech", "B2B"], isHiring: true }),
  ];
  const names = (f: Parameters<typeof filterCompanies>[1]) => filterCompanies(all, f).map((c) => c.name);
  assert.deepEqual(names({ query: "dental" }), ["DentAI", "BigCo"]); // a hit in the one-liner outranks one in the long text
  assert.deepEqual(names({ query: "dental ai" }), ["DentAI"]);
  assert.deepEqual(names({ industry: "fintech" }), ["Taktile"]);
  assert.deepEqual(names({ location: "germany", hiring: true }), ["Taktile"]);
  assert.deepEqual(names({ query: "quantum" }), []);
});

test("startups: item mapping with signals", () => {
  const got = startupItem(yc({ name: "Taktile", website: "http://taktile.com", one_liner: " Decision  engine ", isHiring: true }));
  assert.deepEqual(got, {
    company_name: "Taktile", website: "http://taktile.com", domain: "taktile.com", phone: null, email: null, address: null, city: "Berlin",
    country: "Germany", industry: "B2B", description: "Decision engine", source: "startups", source_url: "https://www.ycombinator.com/companies/x",
    signals: [
      { kind: "hiring", label: "Hiring now (Y Combinator jobs)", url: "https://www.ycombinator.com/companies/x/jobs" },
      { kind: "funding", label: "Y Combinator Winter 2024", url: "https://www.ycombinator.com/companies/x" },
    ],
  });
});

test("hiring: jobs are matched on title and tags, grouped by company, with the job page as the signal", () => {
  const job = (company: string, title: string, board: "Himalayas" | "Arbeitnow", location: string | null = null, tags: string[] = []) =>
    ({ company, title, url: `https://jobs.test/${encodeURIComponent(title)}`, location, tags, board });
  const jobs = [
    job("Acme GmbH", "Senior React Developer (m/w/d)", "Arbeitnow", "Berlin"),
    job("acme gmbh ", "React Native Engineer", "Arbeitnow", "Berlin"),
    job("Acme GmbH", "Senior React Developer (m/w/d)", "Arbeitnow", "Munich"), // same role, second city
    job("Globex", "Frontend Engineer", "Himalayas", "Germany", ["React", "TypeScript"]),
    job("Initech", "Office Assistant", "Himalayas", null, ["Excel"]),
    job("Umbrella", "React Developer", "Arbeitnow", "Hamburg"),
  ];
  const items = groupJobs(jobs, "react");
  assert.deepEqual(items.map((i) => [i.company_name, i.city, i.signals.length]), [["Acme GmbH", "Berlin", 2], ["Globex", null, 1], ["Umbrella", "Hamburg", 1]]);
  assert.deepEqual(items[0].signals[0], { kind: "hiring", label: "Hiring: Senior React Developer (m/w/d) (Berlin)", url: "https://jobs.test/Senior%20React%20Developer%20(m%2Fw%2Fd)" });
  assert.equal(items[0].website, null); // job boards do not publish company sites, and none is invented
  assert.deepEqual(groupJobs(jobs, "react", "berlin").map((i) => i.company_name), ["Acme GmbH", "Globex"]); // Himalayas is filtered upstream
  assert.deepEqual(groupJobs(jobs, "react developer senior").map((i) => i.company_name), ["Acme GmbH"]);
});

test("hiring: a website is attached only on an exact company-name match", async () => {
  const { sameCompany } = await import("../../server/sources/hiring.js");
  assert.equal(sameCompany("Enpal GmbH", "enpal"), true);
  assert.equal(sameCompany("Purple Sales Solutions Inc.", "Purple Sales Solutions"), true);
  assert.equal(sameCompany("Enpal", "En Palabras"), false);
  assert.equal(sameCompany("GmbH", "Inc"), false);
});
