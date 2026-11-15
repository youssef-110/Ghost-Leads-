// LinkedIn people and posts, read from a search engine's index of public LinkedIn pages. Nothing here signs in to
// or requests linkedin.com: its robots.txt closes the site to crawlers, and this product respects robots.txt.
import type { DiscoverItem } from "../../shared/types.js";
import { clean } from "../html.js";
import { addWebsites } from "./hiring.js";
import { item } from "./item.js";
import { search, type Hit } from "./web.js";

const NOTE = "From a search engine's index of public LinkedIn pages. Ghost Leads does not sign in to or crawl LinkedIn. " +
  "Names and headlines come from the result titles and can be cut short or out of date.";

/** Result titles end in "| LinkedIn" or are cut with "..."; neither is part of the name or headline. */
const tidy = (s: string) => clean(s).replace(/\s*[|·]\s*LinkedIn\s*$/i, "").replace(/\s*(\.{3}|…)\s*$/, "").trim();

/** "Head of Sales at Acme GmbH", "VP Sales @acme", "Vertrieb bei Acme" -> "Acme GmbH". Null when the headline names no employer. */
function employer(headline: string): string | null {
  const m = /(?:\s(?:at|bei|chez|en)\s+|\s?@\s?)([^|·,]{2,60})/i.exec(headline);
  return m ? clean(m[1]) : null;
}

/** "Jane Doe – Head of Sales at Acme | LinkedIn" on linkedin.com/in/jane-doe -> one person. */
export function parseProfile(hit: Hit): DiscoverItem | null {
  const m = /^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([^/?#]+)/i.exec(hit.link);
  if (!m) return null;
  const [name, ...rest] = tidy(hit.title).split(/\s+[-–—]\s+/);
  if (!name || /linkedin/i.test(name) || name.length > 80) return null;
  const headline = tidy(rest.join(" - ")) || null;
  const profile = `https://www.linkedin.com/in/${m[1]}`;
  return item("linkedin", (headline && employer(headline)) || name, {
    person: { name, title: headline, email: null, linkedin: profile, source_url: profile },
    description: clean(hit.snippet) || null, source_url: profile,
  });
}

/** A public post: "Jane Doe's Post" or "Jane Doe on LinkedIn: ..." names the author; other titles are the post's own headline. */
export function parsePost(hit: Hit): DiscoverItem | null {
  if (!/^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/posts\//i.test(hit.link)) return null;
  const title = tidy(hit.title);
  const author = /^(.{2,80}?)(?:['’]s Post| on LinkedIn\b| auf LinkedIn\b)/i.exec(title)?.[1] ?? /^(.{2,60}?)\s+[-–—]\s+/.exec(title)?.[1];
  const text = clean(hit.snippet).replace(/^(\.{3}|…)\s*/, "");
  if (!title && !text) return null;
  return item("linkedin", clean(author ?? title).slice(0, 120), {
    person: author ? { name: clean(author), title: null, email: null, linkedin: null, source_url: hit.link } : null,
    description: text || null, source_url: hit.link,
    signals: [{ kind: "other", label: `LinkedIn post: ${text || title}`.slice(0, 160), url: hit.link }],
  });
}

export async function linkedin(mode: "people" | "posts", query: string, location: string | undefined, limit: number): Promise<{ items: DiscoverItem[]; note: string | null }> {
  const people = mode === "people";
  const hits = await search(`site:linkedin.com/${people ? "in" : "posts"} ${query} ${location ?? ""}`.trim(), Math.min(limit * 2, 100));
  const seen = new Set<string>();
  const items = hits.flatMap((h) => (people ? parseProfile(h) : parsePost(h)) ?? [])
    .filter((i) => !seen.has(i.source_url!) && Boolean(seen.add(i.source_url!)))
    .slice(0, limit);
  // only people whose headline names an employer: looking up a person's own name would attach a stranger's website
  if (people) await addWebsites(items.filter((i) => i.company_name !== i.person?.name));
  return { items, note: items.length ? NOTE : `No public LinkedIn ${people ? "profiles" : "posts"} matched. Try fewer or broader words.` };
}
