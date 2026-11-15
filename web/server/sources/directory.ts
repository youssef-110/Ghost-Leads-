// Companies listed on any page: exhibitor lists, member directories, partner pages, "awesome" lists.
// Generalises the single-event scraper in src/ghostleads/scraping/adapter.py: structure first, AI only as a fallback,
// and every row cites the page it was read from.
import type { Element } from "domhandler";
import type { DiscoverItem } from "../../shared/types.js";
import { safeFetch } from "../fetch.js";
import { absolute, clean, domainOf, jsonLd, ldTypes, parseHtml, visibleText, type CheerioAPI } from "../html.js";
import { aiConfigured, chatJson } from "../openai.js";
import { companyDomain, dedupe, item } from "./item.js";

const MAX_PAGES = 5;
const GENERIC_LINK_TEXT = /^(?:(?:zur |visit |go to |open |view )?(?:web ?site|webseite|homepage|web|site|link|url|page|profile?|shop|store)|more|mehr|learn more|read more|details?|info|visit|here|hier|www|click here|→|»|›|>)$/i;
const NAME_SELECTOR = 'h1, h2, h3, h4, h5, h6, strong, b, dt, th, [class*="name" i], [class*="title" i], [class*="company" i]';

/** Structural position of a link: tag.class of the link and its three nearest ancestors. Links in repeated cards share it. */
function signature($: CheerioAPI, a: Element): string {
  const parts: string[] = [];
  for (let el: Element | null = a, depth = 0; el && depth < 4; el = el.parent as Element | null, depth++) {
    if (!el.tagName) break;
    parts.push(el.tagName + "." + ($(el).attr("class") ?? "").split(/\s+/).filter((c) => c && !/\d/.test(c)).sort().join("."));
  }
  return parts.join("<");
}

/** The card around a link: the largest ancestor that holds no other company's link. */
function cardOf($: CheerioAPI, a: Element, pageDomain: string | null): Element {
  const own = companyDomain($(a).attr("href"));
  let card = a;
  for (let el = a.parent as Element | null, depth = 0; el && el.tagName && depth < 5; el = el.parent as Element | null, depth++) {
    const others = $(el).find("a[href]").toArray().some((other) => {
      const d = companyDomain($(other).attr("href"));
      return d && d !== own && d !== pageDomain;
    });
    if (others || /^(body|main|html)$/.test(el.tagName)) break;
    card = el;
  }
  return card;
}

/** "Logo of company Sentry" -> "Sentry". */
const altName = (alt: string | undefined): string =>
  (alt ?? "").replace(/\b(?:(?:company|firmen)\s*)?(?:logos?|icon|image|bild|banner)\b(?:\s+(?:of|von|for|der|des)\b(?:\s+(?:the\s+)?(?:company|firma)\b)?)?/gi, " ");

function nameOf($: CheerioAPI, a: Element, card: Element, domain: string): string {
  const candidates = [
    $(a).text(),
    altName($(a).find("img[alt]").attr("alt")),
    $(card).find(NAME_SELECTOR).first().text(),
    altName($(card).find("img[alt]").first().attr("alt")),
    // table rows and bare "name | website" pairs: the first part of the card that is not the link itself
    $(card).children().toArray().filter((el) => el !== a && !$(el).find(a).length).map((el) => $(el).text()).find((t) => t.trim()),
    $(a).attr("title"), $(a).attr("aria-label"),
  ].map(clean);
  const name = candidates.find((c) => c.length >= 2 && c.length <= 80 && !GENERIC_LINK_TEXT.test(c) && !/^(https?:\/\/|www\.)|\.[a-z]{2,}(\/|$)/i.test(c));
  return name ?? domain; // a bare domain is still true; a made-up name would not be
}

function fromJsonLd($: CheerioAPI, pageUrl: string, pageDomain: string | null): DiscoverItem[] {
  return jsonLd($).flatMap((node) => {
    if (!ldTypes(node).some((t) => /Organization|Business|Corporation|Store$/.test(t)) || typeof node.name !== "string") return [];
    const url = [node.url, ...(Array.isArray(node.sameAs) ? node.sameAs : [node.sameAs])]
      .find((u): u is string => typeof u === "string" && Boolean(companyDomain(u)) && domainOf(u) !== pageDomain);
    return url ? [item("directory", clean(node.name), {
      website: url, description: typeof node.description === "string" ? clean(node.description).slice(0, 300) : null, source_url: pageUrl,
    })] : [];
  });
}

/** Companies on one page: JSON-LD organizations plus outbound company links that repeat in the same structure. */
export function companiesOnPage($: CheerioAPI, pageUrl: string): DiscoverItem[] {
  const pageDomain = domainOf(pageUrl);
  const groups = new Map<string, { a: Element; domain: string; href: string }[]>();
  $("a[href]").each((_, a) => {
    const href = absolute($(a).attr("href"), pageUrl);
    const domain = companyDomain(href);
    if (!href || !domain || domain === pageDomain || $(a).closest("nav, footer").length) return;
    const sig = signature($, a);
    groups.set(sig, [...(groups.get(sig) ?? []), { a, domain, href }]);
  });
  const distinct = (links: { domain: string }[]) => new Set(links.map((l) => l.domain)).size;
  const sized = [...groups.values()].map((links) => ({ links, n: distinct(links) })).sort((x, y) => y.n - x.n);
  const largest = sized[0]?.n ?? 0;
  // the main list, plus other repeated structures of comparable size (a second table, a sponsors grid)
  const lists = sized.filter((g) => g.n >= 3 && g.n >= largest * 0.3);
  const items = lists.flatMap((g) => g.links.map(({ a, domain, href }) => {
    const card = cardOf($, a, pageDomain);
    const name = nameOf($, a, card, domain);
    const about = clean(visibleText($, card).replace(/\n/g, " ")).replace(name, "").replace(/^[\s\-–—:·|]+/, "");
    return item("directory", name, {
      website: href, description: about.length >= 20 && about.length <= 400 ? about : null, source_url: pageUrl,
    });
  }));
  // one name on several companies is template text (a shared alt attribute, a section heading), not a name
  const uses = new Map<string, Set<string>>();
  for (const i of items) uses.set(i.company_name, (uses.get(i.company_name) ?? new Set()).add(i.domain!));
  for (const i of items) if (uses.get(i.company_name)!.size > 1) i.company_name = i.domain!;
  return dedupe([...fromJsonLd($, pageUrl, pageDomain), ...items]);
}

/** Next page of a paginated list, same site only. */
export function nextPage($: CheerioAPI, pageUrl: string): string | null {
  const explicit = $('a[rel~="next"], link[rel~="next"]').first().attr("href");
  const labelled = $("a[href]").toArray().find((a) =>
    /^(next|next page|weiter|nächste(?: seite)?|older|›|»|→|>)$/i.test(clean($(a).text()) || clean($(a).attr("aria-label") ?? "")));
  const href = absolute(explicit ?? (labelled && $(labelled).attr("href")) ?? undefined, pageUrl);
  return href && href.split("#")[0] !== pageUrl.split("#")[0] && domainOf(href) === domainOf(pageUrl) ? href : null;
}

const AI_SCHEMA = {
  type: "object", additionalProperties: false, required: ["companies"],
  properties: {
    companies: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["company_name", "website_url"],
        properties: { company_name: { type: "string" }, website_url: { type: ["string", "null"] } },
      },
    },
  },
};

/** AI reading of a page the heuristics could not parse. Names must appear on the page; URLs must be links on the page. */
async function aiCompanies($: CheerioAPI, pageUrl: string): Promise<DiscoverItem[]> {
  const text = visibleText($).slice(0, 40_000);
  const links = $("a[href]").toArray()
    .map((a) => ({ label: clean($(a).text()).slice(0, 120), url: absolute($(a).attr("href"), pageUrl) }))
    .filter((l): l is { label: string; url: string } => l.url !== null && domainOf(l.url) !== domainOf(pageUrl)).slice(0, 600);
  const out = await chatJson<{ companies: { company_name: string; website_url: string | null }[] }>([
    { role: "system", content:
      "Extract the companies this public page explicitly lists (exhibitors, members, partners, sponsors, customers). " +
      "Do not infer or invent companies. Use only URLs from the provided link list as website_url, and only a company's " +
      "own official website, not social media or directory links. If no clearly associated website exists, use null. " +
      "Return an empty list when the page lists no companies." },
    { role: "user", content: `PAGE URL: ${pageUrl}\nVISIBLE PAGE TEXT:\n${text}\nLINKS (JSON):\n${JSON.stringify(links)}` },
  ], "listed_companies", AI_SCHEMA);
  const allowed = new Set(links.map((l) => l.url));
  const haystack = text.toLowerCase();
  return dedupe(out.companies.flatMap((c) => {
    const name = clean(c.company_name);
    if (!name || !haystack.includes(name.toLowerCase())) return [];
    return [item("directory", name, { website: c.website_url && allowed.has(c.website_url) ? c.website_url : null, source_url: pageUrl })];
  }));
}

export async function directory(url: string, limit: number): Promise<{ items: DiscoverItem[]; note: string | null }> {
  const first = await safeFetch(url); // user-supplied: robots.txt and address blocks surface as errors
  let $ = parseHtml(first.text);
  let pageUrl = first.url;
  let items = companiesOnPage($, pageUrl);
  let note: string | null = null;
  if (items.length < 3 && aiConfigured()) {
    const ai = await aiCompanies($, pageUrl).catch(() => []);
    if (ai.length > items.length) {
      items = ai;
      note = "This page has no regular list structure, so the companies were read by AI. Check them against the page.";
    }
  } else {
    for (let page = 2; page <= MAX_PAGES && items.length < limit; page++) {
      const next = nextPage($, pageUrl);
      if (!next) break;
      const res = await safeFetch(next).catch(() => null); // crawled pages: blocked or broken ones end the walk quietly
      if (!res) break;
      $ = parseHtml(res.text);
      pageUrl = res.url;
      const before = items.length;
      items = dedupe([...items, ...companiesOnPage($, pageUrl)]);
      if (items.length === before) break;
    }
  }
  if (!items.length) {
    note = "No companies with a website link were found on this page. It may load its list with JavaScript" +
      (aiConfigured() ? "." : ", or need AI extraction, which is not configured.");
  }
  return { items: items.slice(0, limit), note };
}
