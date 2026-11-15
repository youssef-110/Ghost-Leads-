// "Scrape any page into rows": JSON-LD items, HTML tables and repeated list/card structures, or AI extraction
// into caller-chosen columns when an OpenAI key is configured.
import type { Element } from "domhandler";
import type { ExtractResponse } from "../shared/types.js";
import { safeFetch } from "./fetch.js";
import { absolute, clean, jsonLd, ldTypes, parseHtml, visibleText, type CheerioAPI } from "./html.js";
import { aiConfigured, chatJson } from "./openai.js";

const MAX_ROWS = 500;
const MAX_CELL = 500;
type Row = Record<string, string | null>;
type Rows = { columns: string[]; rows: Row[] };

const cell = (v: unknown): string | null => {
  const s = typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? clean(String(v)) : "";
  return s ? s.slice(0, MAX_CELL) : null;
};

function finish(rows: Row[]): Rows {
  const columns: string[] = [];
  for (const row of rows) for (const key of Object.keys(row)) if (row[key] !== null && !columns.includes(key)) columns.push(key);
  return {
    columns,
    rows: rows.slice(0, MAX_ROWS).map((row) => Object.fromEntries(columns.map((c) => [c, row[c] ?? null]))),
  };
}

const LD_SKIP = new Set(["WebSite", "WebPage", "BreadcrumbList", "ListItem", "ItemList", "SearchAction", "ImageObject", "SiteNavigationElement"]);

/** The most frequent kind of JSON-LD item on the page (ItemList entries unwrapped), one row each. */
export function fromJsonLd($: CheerioAPI): Rows {
  const items: Record<string, unknown>[] = [];
  for (const node of jsonLd($)) {
    const list = node.itemListElement;
    if (Array.isArray(list)) {
      for (const entry of list) {
        const item = (entry as Record<string, unknown>)?.item ?? entry;
        if (item && typeof item === "object") items.push(item as Record<string, unknown>);
      }
    } else if (!ldTypes(node).some((t) => LD_SKIP.has(t)) && node["@type"]) items.push(node);
  }
  const byType = new Map<string, Record<string, unknown>[]>();
  for (const item of items) {
    const type = ldTypes(item)[0] ?? "Thing";
    byType.set(type, [...(byType.get(type) ?? []), item]);
  }
  const best = [...byType.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  return finish(best.map((item) => {
    const row: Row = {};
    for (const [key, value] of Object.entries(item)) {
      if (key.startsWith("@")) continue;
      if (value && typeof value === "object" && !Array.isArray(value)) { // one level of nesting: address.streetAddress
        for (const [k, v] of Object.entries(value)) if (!k.startsWith("@") && cell(v)) row[`${key}.${k}`] = cell(v);
      } else row[key] = cell(Array.isArray(value) ? value.filter((v) => typeof v !== "object").join(", ") : value);
    }
    return row;
  }));
}

/** Text of an element; logo-only items fall back to their image's alt text. */
const textOf = ($: CheerioAPI, el: Element): string => clean(visibleText($, el)) || clean($(el).find("img[alt]").first().attr("alt"));

/** The link that represents an element: itself, or its first descendant link that has a label (not a bare vote arrow). */
function mainLink($: CheerioAPI, el: Element): Element | undefined {
  if (el.tagName === "a") return el;
  const links = $(el).find("a[href]").toArray();
  return links.find((a) => textOf($, a)) ?? links[0];
}

/** The table with the most data rows. Header from <th> cells or the first row; a "link" column when rows link out. */
export function fromTables($: CheerioAPI, base: string): Rows {
  let best: Rows = { columns: [], rows: [] };
  $("table").each((_, table) => {
    const trs = $(table).find("tr").toArray().filter((tr) => $(tr).closest("table")[0] === table);
    if (trs.length < 2) return;
    const cells = (tr: Element) => $(tr).children("th, td").toArray();
    const hasHeader = $(trs[0]).children("th").length > 0;
    const header = hasHeader ? cells(trs[0]).map((c) => textOf($, c)) : [];
    const rows = trs.slice(hasHeader ? 1 : 0).map((tr) => {
      const row: Row = {};
      cells(tr).forEach((c, i) => { row[header[i] || `Column ${i + 1}`] = cell(textOf($, c)); });
      const link = mainLink($, tr);
      if (link) row.link = absolute($(link).attr("href"), base);
      return row;
    }).filter((row) => Object.values(row).some(Boolean));
    if (rows.length > best.rows.length) best = finish(rows);
  });
  return best;
}

/** The largest run of same-shaped siblings (cards, list items): title, remaining text and main link of each. */
export function fromLists($: CheerioAPI, base: string): Rows {
  let best: { items: Element[]; weight: number } = { items: [], weight: 0 };
  $("body *").each((_, parent) => {
    if ($(parent).closest("nav, header, footer, table, select, script, style").length) return;
    const groups = new Map<string, Element[]>();
    for (const child of $(parent).children().toArray()) {
      if (/^(script|style|br|option|link|meta)$/.test(child.tagName)) continue;
      const sig = child.tagName + "." + ($(child).attr("class") ?? "").split(" ").filter(Boolean).sort().join(".");
      groups.set(sig, [...(groups.get(sig) ?? []), child]);
    }
    for (const items of groups.values()) {
      if (items.length < 3) continue;
      const avg = items.reduce((n, i) => n + Math.min(textOf($, i).length, 200), 0) / items.length;
      const linked = items.filter((i) => mainLink($, i)).length;
      // many short linked items (a directory) should beat three long paragraphs (prose)
      const weight = avg < 3 ? 0 : items.length * Math.sqrt(avg) * (linked >= items.length * 0.7 ? 2 : 1);
      if (weight > best.weight) best = { items, weight };
    }
  });
  return finish(best.items.map((item) => {
    const text = textOf($, item);
    const link = mainLink($, item);
    const linkText = link ? textOf($, link) : "";
    // a heading names the item; a link does too when it is most of the item rather than a link inside a paragraph
    const title = clean($(item).find('h1, h2, h3, h4, h5, h6, strong, b, [class*="title" i], [class*="name" i]').first().text())
      || (linkText.length * 2 >= text.length ? linkText : "");
    return {
      title: cell(title), text: cell(title ? text.replace(title, "") : text),
      link: link ? absolute($(link).attr("href"), base) : null,
    };
  }).filter((row) => row.title || row.text));
}

/** Best non-AI reading of the page. JSON-LD and tables are explicit data, so they outrank guessed card lists. */
export function heuristicExtract($: CheerioAPI, base: string): Pick<ExtractResponse, "columns" | "rows" | "method"> {
  const table = fromTables($, base);
  const candidates = [
    { method: "jsonld" as const, weight: 2, ...fromJsonLd($) },
    // a wide table is the page's data; a longer footnote or link list must not outrank it
    { method: "table" as const, weight: table.columns.length >= 3 ? 4 : 1.5, ...table },
    { method: "list" as const, weight: 1, ...fromLists($, base) },
  ].filter((c) => c.rows.length >= 2).sort((a, b) => b.rows.length * b.weight - a.rows.length * a.weight);
  const best = candidates[0];
  return best ? { columns: best.columns, rows: best.rows, method: best.method } : { columns: [], rows: [], method: "list" };
}

const AI_SCHEMA = {
  type: "object", additionalProperties: false, required: ["columns", "rows"],
  properties: {
    columns: { type: "array", items: { type: "string" } },
    rows: { type: "array", items: { type: "array", items: { type: ["string", "null"] } } },
  },
};

/** Page text for the model. Link targets are inlined only when the request is about links, to keep the prompt small. */
function pageText($: CheerioAPI, base: string, withLinks: boolean): string {
  if (withLinks) {
    $("a[href]").each((_, a) => {
      const href = absolute($(a).attr("href"), base);
      if (href) $(a).append(` [${href}]`);
    });
  }
  return visibleText($).slice(0, 40_000);
}

async function aiExtract($: CheerioAPI, base: string, fields: string[], instructions: string | undefined): Promise<Rows> {
  const wanted = fields.length ? `Use exactly these columns, in this order: ${JSON.stringify(fields)}.` : "Choose short, clear column names.";
  const out = await chatJson<{ columns: string[]; rows: (string | null)[][] }>([
    { role: "system", content:
      "You turn the visible text of a web page into table rows. " + wanted + " One row per item the page lists. " +
      "Every row has one value per column, in column order. Copy values exactly as they appear on the page; use null " +
      "when the page does not state a value. Never guess, infer or invent values. Return no rows if the page lists nothing relevant." },
    { role: "user", content: `PAGE URL: ${base}\n${instructions ? `WHAT TO EXTRACT: ${instructions}\n` : ""}PAGE TEXT:\n` +
      pageText($, base, /url|link|web|site|href|homepage|e-?mail/i.test(fields.join(" ") + " " + (instructions ?? ""))) },
  ], "page_rows", AI_SCHEMA);
  const columns = fields.length ? fields : out.columns.map((c) => clean(c)).filter(Boolean);
  return {
    columns,
    rows: out.rows.slice(0, MAX_ROWS).map((r) => Object.fromEntries(columns.map((c, i) => [c, cell(r[i])]))),
  };
}

export async function extract(url: string, fields: string[], instructions?: string): Promise<ExtractResponse> {
  const page = await safeFetch(url);
  const $ = parseHtml(page.text);
  const wantsAi = fields.length > 0 || Boolean(instructions);
  let aiProblem = "is not configured on this server";
  if (wantsAi && aiConfigured()) {
    try {
      // its own copy of the page: link targets get inlined into the text
      const { columns, rows } = await aiExtract(parseHtml(page.text), page.url, fields, instructions);
      return { columns, rows, method: "ai", note: rows.length ? null : "The AI found nothing matching your request on this page." };
    } catch {
      aiProblem = "failed just now (the AI provider returned an error)"; // the page was read fine: still return what it holds
    }
  }
  const found = heuristicExtract($, page.url);
  const note = wantsAi
    ? `AI extraction ${aiProblem}, so your columns and instructions were not applied. These are the rows the page structure itself provides.`
    : found.rows.length ? null : "No table, list or structured data found on this page. It may render its content with JavaScript.";
  return { ...found, note };
}
