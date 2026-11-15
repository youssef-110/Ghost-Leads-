// Company enrichment: crawl the homepage plus a few contact/about/team/imprint pages and report only what they publish.
import { parse } from "tldts";
import type { Enrichment, FoundEmail, Person } from "../shared/types.js";
import { dropGlued, findEmails, findPhones, findSocials, pickSocials } from "./contacts.js";
import { checkEmail, detectPattern, guessEmail, mxStatus, patternOf } from "./email.js";
import { safeFetch, type Page } from "./fetch.js";
import { absolute, clean, domainOf, jsonLd, nameFromTitle, parseHtml, visibleText, type CheerioAPI } from "./html.js";
import { ApiFail } from "./http.js";
import { findPeople } from "./people.js";
import { detectTech } from "./tech.js";

const MAX_SUBPAGES = 6;
const FREEMAIL = /@(gmail|googlemail|gmx|web|t-online|outlook|hotmail|yahoo|icloud|aol|posteo|mailbox|proton|protonmail|freenet|live|me)\.[a-z.]+$/;

/** "https://www.Example.com/about" -> "example.com". Throws bad_request for anything that is not a public hostname. */
export function normalizeDomain(raw: string): string {
  const host = raw.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/^www\./, "").replace(/\.$/, "");
  const p = parse(host);
  if (!p.domain || !p.isIcann || p.isIp || !/^[a-z0-9.-]+$/.test(host)) throw new ApiFail("bad_request", "Not a valid company domain");
  return host;
}

// What each kind of page is good for decides the order they are fetched in.
const WANTED: { kind: string; path: RegExp; guesses: string[] }[] = [
  { kind: "contact", path: /kontakt|contact|get-in-touch|reach-us/, guesses: ["/contact", "/kontakt"] },
  { kind: "imprint", path: /impressum|imprint|legal-notice|legal\/?$|rechtliches/, guesses: ["/impressum", "/imprint"] },
  { kind: "team", path: /team|people|leadership|management|staff|mitarbeiter|ansprechpartner|founders/, guesses: ["/team"] },
  { kind: "about", path: /about|ueber-uns|uber-uns|über-uns|ueberuns|unternehmen|company|who-we-are/, guesses: ["/about"] },
];

/** Up to MAX_SUBPAGES internal URLs: links found on the homepage first (two per kind), then common paths for kinds
 *  the homepage does not link to. */
export function pickPages($: CheerioAPI, homeUrl: string): string[] {
  const home = new URL(homeUrl);
  const site = domainOf(home.hostname);
  const links = new Map<string, string>(); // url -> lowercased path + link text
  $("a[href]").each((_, a) => {
    const href = absolute($(a).attr("href"), homeUrl);
    if (!href) return;
    const u = new URL(href);
    u.hash = "";
    if (domainOf(u.hostname) !== site || u.pathname === "/" || /\.(pdf|jpe?g|png|gif|zip|docx?|xlsx?|mp4)$/i.test(u.pathname)) return;
    let path = u.pathname.toLowerCase();
    try {
      path = decodeURIComponent(path);
    } catch { /* keep the raw path */ }
    if (/\/(blog|news|presse?|artikel|articles?|posts?|tags?|category|kategorie)\//.test(path)) return; // "/blog/contact-centers" is not the contact page
    if (!links.has(u.href)) links.set(u.href, path);
  });
  const picked: string[] = [];
  const missing: string[] = [];
  for (const { path, guesses } of WANTED) {
    const hits = [...links].filter(([, p]) => path.test(p)).sort((a, b) => a[1].length - b[1].length).slice(0, 2);
    for (const [url] of hits) if (!picked.includes(url)) picked.push(url);
    if (!hits.length) missing.push(...guesses.map((g) => home.origin + g));
  }
  return [...picked, ...missing].slice(0, MAX_SUBPAGES);
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? clean(v) : null);

export function findAddress($: CheerioAPI, text: string): string | null {
  for (const node of jsonLd($)) {
    const a = node.address as Record<string, unknown> | undefined;
    if (a && typeof a === "object" && str(a.streetAddress)) {
      const country = str(a.addressCountry) ?? str((a.addressCountry as Record<string, unknown> | undefined)?.name);
      // "Durham, NC 27701" where a region is given, "66111 Saarbrücken" otherwise
      const place = str(a.addressRegion)
        ? [str(a.addressLocality), [str(a.addressRegion), str(a.postalCode)].filter(Boolean).join(" ")]
        : [[str(a.postalCode), str(a.addressLocality)].filter(Boolean).join(" ")];
      return [str(a.streetAddress), ...place, country].filter(Boolean).join(", ");
    }
  }
  // German: "Musterstraße 12a" then "66111 Saarbrücken" (same line or next)
  const de = /^([\p{L}][\p{L}.\- ]{2,50}\s\d{1,4}\s?[a-zA-Z]?(?:\s?[-–]\s?\d{1,4})?)\s*[,\n]\s*(?:D-)?(\d{5})\s+(\p{Lu}[\p{L}.-]+(?: [\p{L}.-]+){0,3})/mu.exec(text);
  if (de) return `${clean(de[1])}, ${de[2]} ${clean(de[3]).replace(/ (Deutschland|Germany|Tel|Telefon|Fon|Fax|E-?Mail|Mail|Web|Mobil|Phone|Kontakt)\b.*$/i, "")}`;
  // US: "500 Main St, Suite 4" then "Springfield, IL 62701"
  const us = /(\d{1,6}\s[\p{L}0-9 .'#,-]{3,60}?)\s*[,\n]\s*([\p{L} .'-]{2,30}),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/u.exec(text);
  if (us) return `${clean(us[1])}, ${clean(us[2])}, ${us[3]} ${us[4]}`;
  const el = clean(visibleText($, $("address").first()[0] ?? { type: "none" }).replace(/\n/g, ", "));
  return el.length >= 10 && el.length <= 200 ? el : null;
}

function siteMeta($: CheerioAPI, domain: string) {
  const meta = (sel: string) => str($(sel).attr("content"));
  const org = jsonLd($).find((n) => /Organization|LocalBusiness|Corporation|Store|Dentist|LegalService/.test(String(n["@type"])));
  const lang = ($("html").attr("lang") ?? meta('meta[http-equiv="content-language" i]') ?? "").split(/[-_,]/)[0].trim().toLowerCase();
  return {
    name: meta('meta[property="og:site_name"]') ?? str(org?.name) ?? (str($("title").first().text()) && nameFromTitle(clean($("title").first().text()), domain)),
    description: (meta('meta[name="description" i]') ?? meta('meta[property="og:description"]') ?? str(org?.description))?.slice(0, 500) ?? null,
    language: /^[a-z]{2,3}$/.test(lang) ? lang : null,
  };
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

export function score(e: Pick<Enrichment, "emails" | "people" | "phones" | "socials" | "address" | "pages_crawled">, mx: string) {
  let total = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => { total += points; reasons.push(reason); };
  const published = e.emails.filter((m) => m.status === "valid");
  if (published.some((m) => m.kind === "personal")) add(35, "A person's own email address is published on the site");
  else if (published.length) add(22, "Only a shared inbox (such as info@) is published");
  else if (e.emails.some((m) => m.kind === "guessed")) add(8, "No email is published; the address shown is an unconfirmed pattern guess");
  else reasons.push("No email address found on the site");
  const named = e.people.filter((p) => p.title);
  if (named.length) add(25, `Named contact with a role: ${named[0].name} (${named[0].title})`);
  else reasons.push("No named contact person found");
  if (e.phones.length) add(15, "Phone number published");
  if (mx === "ok") add(10, "The domain accepts email");
  else if (mx === "none") reasons.push("The domain has no mail server, so email will bounce");
  if (e.socials.linkedin) add(5, "Company LinkedIn page linked");
  if (e.address) add(5, "Postal address published");
  if (e.pages_crawled > 1) add(5, `${e.pages_crawled} pages could be read`);
  return { score: total, score_reasons: reasons };
}

export async function enrich(domain: string, companyName?: string): Promise<Enrichment> {
  let home: Page;
  try {
    home = await safeFetch(`https://${domain}/`);
  } catch (e) {
    // some sites only answer on www; a robots.txt or address block is final
    if (!(e instanceof ApiFail) || e.code !== "upstream" || domain.startsWith("www.")) throw e;
    home = await safeFetch(`https://www.${domain}/`).catch(() => { throw e; });
  }
  const $home = parseHtml(home.text);
  const mxPromise = mxStatus(domain);
  const subpages = await pool(pickPages($home, home.url), 3, (url) => safeFetch(url, { timeoutMs: 7000 }).catch(() => null));
  const pages = [home, ...subpages.filter((p): p is Page => p !== null && /html/i.test(p.contentType || "html"))]
    .filter((p, i, all) => all.findIndex((q) => q.url === p.url) === i); // guesses can redirect to a page already read

  const emailSource = new Map<string, string>();
  const phones: string[] = [];
  const socialLinks: ReturnType<typeof findSocials>[] = [];
  const people: Person[] = [];
  let address: string | null = null;
  for (const page of pages) {
    const $ = page === home ? $home : parseHtml(page.text);
    const text = visibleText($);
    for (const email of findEmails($, text)) if (!emailSource.has(email)) emailSource.set(email, page.url);
    for (const phone of findPhones($, text)) if (!phones.some((p) => p.slice(-7) === phone.slice(-7))) phones.push(phone);
    socialLinks.push(findSocials($));
    for (const person of findPeople($, text, page.url, page === home)) if (!people.some((p) => p.name === person.name)) people.push(person);
    address ??= findAddress($, text);
  }

  // Addresses on the company's own domain or a freemail provider. Other domains are usually the web agency or an
  // external data-protection officer, so they only count when the company publishes nothing on its own domain.
  const site = domainOf(domain);
  const all = dropGlued([...emailSource.keys()]);
  const own = all.filter((m) => domainOf(m.split("@")[1]) === site);
  const kept = [...own, ...(own.length ? all.filter((m) => FREEMAIL.test(m)) : all.filter((m) => !own.includes(m)))].slice(0, 12);
  // decision makers first: they are who the caller wants to reach, and who gets an address guess
  const seniority = (p: Person) => (/ceo|chief executive|founder|gründer|geschäftsführ|inhaber|owner|managing director|president|vorstand/i.test(p.title ?? "") ? 0
    : /chief|\bc[a-z]o\b|\bvp\b|vice president|head|director|leiter|partner/i.test(p.title ?? "") ? 1 : 2);
  people.sort((a, b) => seniority(a) - seniority(b));
  const names = people.map((p) => p.name);
  const emails: FoundEmail[] = await Promise.all(kept.map((m) => checkEmail(m, emailSource.get(m)!, names)));

  // Tie published personal addresses to the people they belong to, then guess one address for the rest.
  const mx = await mxPromise;
  const pattern = detectPattern(names, own, domain);
  for (const person of people) person.email ??= own.find((m) => patternOf(person.name, m.split("@")[0])) ?? null;
  if (mx === "ok") {
    for (const person of people.filter((p) => !p.email).slice(0, 3)) {
      const guess = guessEmail(person.name, domain, pattern?.pattern);
      if (!guess || emails.some((m) => m.email === guess)) continue;
      emails.push({
        email: guess, kind: "guessed", status: "risky", source_url: null,
        reason: pattern
          ? `guess for ${person.name}, following the pattern of ${pattern.example}; not confirmed`
          : `guess for ${person.name} using the common first.last pattern; not confirmed by any published address`,
      });
    }
  }

  const meta = siteMeta($home, domain);
  const socials = pickSocials(socialLinks, domain);
  const result = {
    domain, website: home.url, company_name: meta.name ?? companyName ?? null, description: meta.description,
    language: meta.language, emails, phones: phones.slice(0, 5), socials, people: people.slice(0, 15),
    tech: detectTech(home.text, home.headers), address, pages_crawled: pages.length,
  };
  return { ...result, ...score(result, mx) };
}
