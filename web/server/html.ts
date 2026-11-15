// Small HTML helpers shared by the extractors.
import { load, type CheerioAPI } from "cheerio";
import { getDomain } from "tldts";

export type { CheerioAPI };
export const parseHtml = (html: string): CheerioAPI => load(html);

type Node = { type: string; name?: string; data?: string; children?: Node[] };
const SKIP = new Set(["script", "style", "noscript", "svg", "template", "head", "iframe"]);
const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt", "figcaption", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table", "td",
  "th", "tr", "ul",
]);

/** Visible text with one line per block element, so "label: value" pairs stay on one line. */
export function visibleText($: CheerioAPI, root: unknown = $.root()[0]): string {
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.type === "text") out.push(node.data ?? "");
    else if (node.children && !(node.name && SKIP.has(node.name))) {
      const block = node.name !== undefined && BLOCK.has(node.name);
      if (block) out.push("\n");
      node.children.forEach(walk);
      if (block) out.push("\n");
    }
  };
  walk(root as Node);
  return out.join("").replace(/[^\S\n]+/g, " ").split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
}

export const clean = (s: string | undefined | null): string => (s ?? "").replace(/\s+/g, " ").trim();

/** Every JSON-LD node on the page, with @graph and nested arrays flattened one level. */
export function jsonLd($: CheerioAPI): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const add = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      nodes.push(o);
      if (o["@graph"]) add(o["@graph"]);
    }
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      add(JSON.parse($(el).text()));
    } catch { /* malformed JSON-LD is common; skip it */ }
  });
  return nodes;
}

export function ldTypes(node: Record<string, unknown>): string[] {
  const t = node["@type"];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string");
}

/** Absolute http(s) URL for an href, or null. */
export function absolute(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(href.trim(), base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Registrable domain ("sub.example.co.uk" -> "example.co.uk"), or null for IPs and unknown suffixes. */
export function domainOf(urlOrHost: string | null | undefined): string | null {
  return urlOrHost ? getDomain(urlOrHost) : null;
}

/** "Acme Dental | Family Dentist in Austin" -> "Acme Dental": the title segment that best matches the domain name. */
export function nameFromTitle(title: string, domain: string): string {
  const label = domain.split(".")[0].replace(/-/g, "");
  const parts = title.split(/\s+[|–—·:»-]\s+|\s*\|\s*/).map(clean)
    .filter((p) => p && !/^(home|homepage|startseite|start|willkommen|welcome)$/i.test(p));
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return parts.find((p) => squash(p).includes(label) || label.includes(squash(p))) ?? parts[0] ?? domain;
}
