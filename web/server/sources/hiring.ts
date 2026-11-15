// Companies with open roles, from two key-free public job APIs: Himalayas (remote roles, searchable, first 20
// matches) and Arbeitnow (Germany/Europe, newest 300 roles filtered here). Remotive's free feed now carries only
// ~16 jobs, so it is not used. Both boards ask for a link back to the job page: it is the signal URL.
import type { DiscoverItem, Signal } from "../../shared/types.js";
import { apiJson } from "../fetch.js";
import { clean } from "../html.js";
import { item } from "./item.js";

type Job = { company: string; title: string; url: string; location: string | null; tags: string[]; board: "Himalayas" | "Arbeitnow" };

async function himalayas(query: string, country?: string): Promise<Job[]> {
  const res = await apiJson<{ jobs: { companyName: string; title: string; guid: string; categories?: string[]; locationRestrictions?: string[] }[] }>(
    "https://himalayas.app/jobs/api/search?q=" + encodeURIComponent(query) + (country ? "&country=" + encodeURIComponent(country) : ""));
  return res.jobs.map((j) => ({
    company: j.companyName, title: j.title, url: j.guid, board: "Himalayas",
    location: j.locationRestrictions?.length === 1 ? j.locationRestrictions[0] : null,
    tags: (j.categories ?? []).map((c) => c.replace(/-/g, " ")),
  }));
}

async function arbeitnow(): Promise<Job[]> {
  const res = await apiJson<{ data: { company_name: string; title: string; url: string; location: string; tags: string[] }[] }>(
    "https://www.arbeitnow.com/api/job-board-api");
  return res.data.map((j) => ({ company: j.company_name, title: j.title, url: j.url, location: j.location || null, tags: j.tags ?? [], board: "Arbeitnow" }));
}

/** Jobs whose title or tags contain every word of the query (and the location, when given), grouped by company. */
export function groupJobs(jobs: Job[], query: string, location?: string): DiscoverItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const companies = new Map<string, DiscoverItem>();
  for (const job of jobs) {
    const text = (job.title + " " + job.tags.join(" ")).toLowerCase();
    if (!words.every((w) => text.includes(w))) continue;
    // Himalayas is filtered by country upstream; Arbeitnow's location is a city name
    if (location && job.board === "Arbeitnow" && !(job.location ?? "").toLowerCase().includes(location.toLowerCase())) continue;
    const name = clean(job.company);
    if (!name) continue;
    const title = clean(job.title);
    const signal: Signal = { kind: "hiring", label: `Hiring: ${title}${job.location ? ` (${job.location})` : ""}`.slice(0, 160), url: job.url };
    const existing = companies.get(name.toLowerCase());
    if (existing) {
      // the same role is often posted once per country
      if (existing.signals.length < 5 && !existing.signals.some((x) => x.label.startsWith(`Hiring: ${title}`))) existing.signals.push(signal);
    } else {
      // Arbeitnow's location is the workplace; Himalayas' is where candidates may live, which says nothing about the company
      companies.set(name.toLowerCase(), item("hiring", name, {
        city: job.board === "Arbeitnow" ? job.location : null, source_url: job.url, signals: [signal],
      }));
    }
  }
  return [...companies.values()];
}

export async function hiring(query: string, location: string | undefined, limit: number): Promise<{ items: DiscoverItem[]; note: string | null }> {
  // Himalayas only filters by country and rejects anything else ("Berlin"): then it simply has no matches
  const remote = himalayas(query, location).catch((e) => { if (location) return []; throw e; });
  const results = await Promise.allSettled([remote, arbeitnow()]);
  const jobs = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (results.every((r) => r.status === "rejected")) throw (results[0] as PromiseRejectedResult).reason;
  const items = groupJobs(jobs, query, location).sort((a, b) => b.signals.length - a.signals.length).slice(0, limit);
  const down = results.some((r) => r.status === "rejected") ? " One of the two job boards did not answer." : "";
  return {
    items,
    note: (items.length
      ? "Roles from Himalayas and Arbeitnow. Job boards do not publish company websites, so find each site before enriching."
      : "No open roles match. Job titles are matched literally: try one word, such as a skill or a job title.") + down,
  };
}
