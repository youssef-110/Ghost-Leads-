// Y Combinator companies from the open yc-oss dataset (https://github.com/yc-oss/api), refreshed daily upstream.
import type { DiscoverItem } from "../../shared/types.js";
import { apiJson } from "../fetch.js";
import { clean } from "../html.js";
import { dedupe, item } from "./item.js";

type Company = {
  name: string; website: string | null; all_locations: string | null; one_liner: string | null; long_description: string | null;
  team_size: number | null; industry: string | null; industries: string[]; tags: string[]; regions: string[];
  batch: string | null; status: string; isHiring: boolean; url: string;
};

const BASE = "https://yc-oss.github.io/api/";
const cache = new Map<string, { at: number; data: Company[] }>();

async function load(path: string): Promise<Company[]> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < 6 * 3_600_000) return hit.data;
  const data = await apiJson<Company[]>(BASE + path, {}, 25_000);
  cache.clear(); // one dataset in memory at a time: all.json is 11 MB
  cache.set(path, { at: Date.now(), data });
  return data;
}

const slug = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const has = (haystack: string, needle: string) => haystack.toLowerCase().includes(needle.toLowerCase());

export function filterCompanies(
  all: Company[], f: { query?: string; industry?: string; location?: string; hiring?: boolean },
): Company[] {
  const words = (f.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const short = (c: Company) => [c.name, c.one_liner, c.industry, ...c.tags].join(" ").toLowerCase();
  const matches = all.filter((c) => {
    if (!c.website || c.status === "Inactive") return false;
    if (f.hiring && !c.isHiring) return false;
    if (f.industry && ![c.industry ?? "", ...c.industries, ...c.tags].some((i) => has(i, f.industry!))) return false;
    if (f.location && !has([c.all_locations ?? "", ...c.regions].join(" "), f.location)) return false;
    const text = short(c) + " " + (c.long_description ?? "").toLowerCase();
    return words.every((w) => text.includes(w));
  });
  // a hit in the name, one-liner or tags is a stronger match than one buried in the long description
  const strength = (c: Company) => (words.length && words.every((w) => short(c).includes(w)) ? 1 : 0);
  return matches.sort((a, b) => strength(b) - strength(a) || (b.team_size ?? 0) - (a.team_size ?? 0));
}

export function toItem(c: Company): DiscoverItem {
  const [city, ...rest] = (c.all_locations ?? "").split(";")[0].split(",").map((s) => s.trim()).filter(Boolean);
  return item("startups", c.name, {
    website: c.website, city: city ?? null, country: rest.length ? rest[rest.length - 1] : null, industry: c.industry,
    description: clean(c.one_liner || c.long_description || "").slice(0, 300) || null, source_url: c.url,
    signals: [
      ...(c.isHiring ? [{ kind: "hiring" as const, label: "Hiring now (Y Combinator jobs)", url: c.url + "/jobs" }] : []),
      ...(c.batch ? [{ kind: "funding" as const, label: `Y Combinator ${c.batch}`, url: c.url }] : []),
    ],
  });
}

export async function startups(
  f: { query?: string; industry?: string; location?: string; hiring?: boolean }, limit: number,
): Promise<{ items: DiscoverItem[]; note: string | null }> {
  // smallest file that can answer the request: hiring.json (2.6 MB), one industry (<6 MB), else everything (11 MB)
  let all: Company[];
  if (f.hiring) all = await load("companies/hiring.json");
  else if (f.industry) all = await load(`industries/${slug(f.industry)}.json`).catch(() => load("companies/all.json"));
  else all = await load("companies/all.json");
  const items = dedupe(filterCompanies(all, f).slice(0, limit * 2).map(toItem)).slice(0, limit);
  return { items, note: items.length ? null : "No Y Combinator company matches these filters. Try fewer or broader words." };
}
