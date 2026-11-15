// Web search -> company websites. Serper (Google results) when SERPER_API_KEY is set, otherwise DuckDuckGo's HTML
// endpoint, which often refuses automated clients: that case is reported, not worked around.
import type { DiscoverItem } from "../../shared/types.js";
import { USER_AGENT, apiJson } from "../fetch.js";
import { clean, nameFromTitle, parseHtml } from "../html.js";
import { ApiFail } from "../http.js";
import { dedupe, item, searchResultDomain } from "./item.js";

type Hit = { title: string; link: string; snippet: string };

async function serper(query: string, count: number): Promise<Hit[]> {
  const res = await apiJson<{ organic?: Hit[] }>("https://google.serper.dev/search", {
    method: "POST",
    headers: { "x-api-key": process.env.SERPER_API_KEY!, "content-type": "application/json" },
    body: JSON.stringify({ q: query, num: count }),
  });
  return res.organic ?? [];
}

export function parseDuckDuckGo(html: string): Hit[] {
  const $ = parseHtml(html);
  return $(".result").toArray().map((el) => {
    const a = $(el).find("a.result__a").first();
    let link = a.attr("href") ?? "";
    const redirect = /[?&]uddg=([^&]+)/.exec(link); // results link through /l/?uddg=<encoded target>
    if (redirect) link = decodeURIComponent(redirect[1]);
    return { title: clean(a.text()), link, snippet: clean($(el).find(".result__snippet").text()) };
  }).filter((h) => /^https?:\/\//.test(h.link) && !h.link.includes("duckduckgo.com/y.js"));
}

async function duckduckgo(query: string): Promise<Hit[]> {
  let res: Response;
  try {
    res = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: { "user-agent": USER_AGENT, "content-type": "application/x-www-form-urlencoded" },
      body: "q=" + encodeURIComponent(query),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiFail("upstream", "DuckDuckGo did not answer");
  }
  const hits = res.status === 200 ? parseDuckDuckGo(await res.text()) : [];
  // DuckDuckGo answers automated clients with a bot challenge (HTTP 202). That is its decision to respect, so the
  // feature counts as needing a search provider key.
  if (!hits.length) throw new ApiFail("not_configured", "Web search needs a Serper API key on the server: DuckDuckGo refuses automated searches.");
  return hits;
}

export function toItems(hits: Hit[]): DiscoverItem[] {
  return dedupe(hits.flatMap((h) => {
    const domain = searchResultDomain(h.link);
    if (!domain) return [];
    return [item("web", nameFromTitle(h.title, domain), {
      website: new URL(h.link).origin + "/", description: h.snippet || null, source_url: h.link,
    })];
  }));
}

export async function web(query: string, limit: number): Promise<{ items: DiscoverItem[]; note: string | null }> {
  // ask for extra results: directories, social profiles and duplicates are dropped
  const hits = process.env.SERPER_API_KEY ? await serper(query, Math.min(limit * 2, 100)) : await duckduckgo(query);
  const items = toItems(hits).slice(0, limit);
  return { items, note: items.length ? null : "The search only returned directories and social profiles. Try naming the kind of company and a place." };
}
