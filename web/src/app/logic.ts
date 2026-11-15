// Pure logic for the signed-in app: no React, no Supabase, no DOM. Unit-tested in tests/app.
import { parse } from "tldts";
import { FREE_LIMITS } from "../../shared/types";
import type {
  ApiError, DiscoverItem, DiscoverParams, EmailStatus, Enrichment, FoundEmail, Person, Prospect, Usage,
} from "../../shared/types";

/* ---------- domains + import ---------- */

const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,24}|xn--[a-z0-9-]{2,59})$/;
export const IMPORT_MAX = 1000;

/** URL, email or bare host -> lowercase host without scheme, credentials, port, path or www. Not validated. */
function hostOf(raw: string): string {
  let s = raw.trim().toLowerCase().replace(/^["'<(]+|["'>),.;]+$/g, "");
  if (s.includes("@") && !s.includes("/")) s = s.slice(s.lastIndexOf("@") + 1);
  return s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^[^/@]*@/, "").split(/[/?#:]/)[0].replace(/^www\./, "");
}

/** Host as typed, subdomains kept (prospect keys are built from it). Null when it does not look like a domain. */
export function normDomain(raw: string): string | null {
  const s = hostOf(raw);
  return s.length <= 253 && DOMAIN.test(s) ? s : null;
}

const FREE_MAIL = new Set(("gmail.com googlemail.com outlook.com live.com msn.com ymail.com icloud.com me.com mac.com aol.com proton.me "
  + "protonmail.com pm.me gmx.com gmx.de gmx.net web.de mail.com zoho.com yandex.com yandex.ru mail.ru qq.com 163.com t-online.de "
  + "orange.fr free.fr laposte.net hey.com fastmail.com tutanota.com").split(" "));
const FREE_MAIL_ANY_TLD = /^(yahoo|hotmail)\./; // yahoo.co.uk, hotmail.fr

export type SkipReason = "freemail" | "local" | "invalid" | "duplicate";
/** One pasted value -> the company's registrable domain (shop.example.co.uk -> example.co.uk), or why it is not one. */
export function importDomain(raw: string): { domain: string } | { skip: Exclude<SkipReason, "duplicate"> } {
  const host = hostOf(raw);
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.startsWith("[") || host === "localhost" || host.endsWith(".localhost")) return { skip: "local" };
  // private suffixes count: acme.github.io and acme.myshopify.com are companies, github.io is not
  const p = host.length <= 253 && DOMAIN.test(host) ? parse(host, { allowPrivateDomains: true }) : null;
  if (!p?.domain || !(p.isIcann || p.isPrivate)) return { skip: "invalid" };
  return FREE_MAIL.has(p.domain) || FREE_MAIL_ANY_TLD.test(p.domain) ? { skip: "freemail" } : { domain: p.domain };
}

export type ImportResult = { domains: string[]; skipped: Record<SkipReason, number>; capped: boolean };
/** Pasted text or a CSV file -> unique company domains in first-seen order. Every cell of a line is tried;
 *  a line that adds nothing is counted once, under the most specific reason. */
export function parseImport(text: string): ImportResult {
  const seen = new Set<string>();
  const skipped: Record<SkipReason, number> = { freemail: 0, local: 0, invalid: 0, duplicate: 0 };
  for (const line of text.split(/\r?\n/)) {
    const tokens = line.split(/[\s,;|"']+/).filter(Boolean);
    if (!tokens.length) continue;
    let found = false, fresh = false, why: SkipReason = "invalid";
    for (const t of tokens) {
      const r = importDomain(t);
      if ("skip" in r) { if (r.skip === "freemail" || why === "invalid") why = r.skip; continue; }
      found = true;
      if (!seen.has(r.domain)) { seen.add(r.domain); fresh = true; }
    }
    if (!fresh) skipped[found ? "duplicate" : why]++;
  }
  const all = [...seen];
  return { domains: all.slice(0, IMPORT_MAX), skipped, capped: all.length > IMPORT_MAX };
}

/** What was left out of an import and why, in one line. Null when nothing was. */
export function importNote(r: ImportResult): string | null {
  const s = r.skipped, n = s.freemail + s.local + s.invalid + s.duplicate;
  const why = [s.freemail && `${s.freemail} free-mail (gmail.com and similar)`, s.local && `${s.local} IP address or localhost`,
    s.invalid && `${s.invalid} not a domain`, s.duplicate && `${s.duplicate} already in this import`].filter(Boolean).join(", ");
  return [n > 0 && `Skipped ${n} ${n === 1 ? "line" : "lines"}: ${why}.`,
    r.capped && `Only the first ${IMPORT_MAX.toLocaleString("en")} domains are kept per import.`].filter(Boolean).join(" ") || null;
}

export const importItem = (domain: string): DiscoverItem => ({
  company_name: domain, website: `https://${domain}`, domain, phone: null, email: null, address: null, city: null,
  country: null, industry: null, description: null, source: "import", source_url: null, signals: [],
});

/* ---------- prospect keys + rows ---------- */

export const slug = (s: string) =>
  s.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80);

/** Identity of a company inside one list: its domain, else a slug of name + city. */
export const prospectKey = (i: Pick<DiscoverItem, "domain" | "company_name" | "city">) =>
  (i.domain && normDomain(i.domain)) || slug(`${i.company_name} ${i.city ?? ""}`) || "company";

/** Rows for a gl_prospects upsert on (list_id, key); duplicates inside the batch are dropped.
 *  Columns are picked one by one: an unexpected field in a server response must not break the insert. */
export function toProspectRows(items: DiscoverItem[], workspace_id: string, list_id: string) {
  const seen = new Set<string>();
  return items.flatMap((i) => {
    const key = prospectKey(i);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      workspace_id, list_id, key, company_name: i.company_name?.trim() || i.domain || "Unnamed company",
      domain: i.domain ?? null, website: i.website ?? null, phone: i.phone ?? null, email: i.email ?? null,
      address: i.address ?? null, city: i.city ?? null, country: i.country ?? null, industry: i.industry ?? null,
      description: i.description ?? null, source: i.source, source_url: i.source_url ?? null, signals: i.signals ?? [],
    }];
  });
}

export function listNameFor(p: DiscoverParams | { source: "import" }, today = new Date().toISOString().slice(0, 10)): string {
  const join = (...parts: (string | undefined | false)[]) => parts.map((x) => (x || "").trim()).filter(Boolean);
  let name = "";
  if (p.source === "maps") name = join(p.query, p.location).join(" in ");
  else if (p.source === "web") name = p.query.trim();
  else if (p.source === "startups") name = join(p.query, p.industry, p.location, p.hiring && "hiring").join(" · ") || "Startups";
  else if (p.source === "hiring") name = join(`Hiring: ${p.query.trim()}`, p.location).join(" · ");
  else if (p.source === "directory") name = normDomain(p.url) ? `Directory: ${normDomain(p.url)}` : "Directory";
  else name = `Import ${today}`;
  return name.slice(0, 160) || "New list";
}

/* ---------- best contact pickers ---------- */

const STATUS_RANK: Record<EmailStatus, number> = { valid: 0, risky: 10, unknown: 20, invalid: 90 };
const KIND_RANK: Record<FoundEmail["kind"], number> = { personal: 0, role: 1, guessed: 2 };
const emailRank = (e: FoundEmail) => (STATUS_RANK[e.status] ?? 20) + (KIND_RANK[e.kind] ?? 2);

/** Most usable first: deliverability, then a person's address over a role inbox over a guess. */
export const sortEmails = (emails: FoundEmail[]) => [...emails].sort((a, b) => emailRank(a) - emailRank(b));

export type BestEmail = { email: string; status: EmailStatus; kind: FoundEmail["kind"] | null };
/** Best address that is not known-bad; falls back to the one the discovery source listed. */
export function bestEmail(p: Pick<Prospect, "emails" | "email">): BestEmail | null {
  const e = sortEmails(p.emails ?? []).find((x) => x.status !== "invalid");
  if (e) return { email: e.email, status: e.status, kind: e.kind };
  return p.email ? { email: p.email, status: "unknown", kind: null } : null;
}

/** The best address of each company, no repeats: what "Copy emails" puts on the clipboard. */
export const bestEmails = (rows: Pick<Prospect, "emails" | "email">[]) => [...new Set(rows.flatMap((p) => bestEmail(p)?.email ?? []))];

const SENIOR = /\b(founder|owner|ceo|chief|president|partner|managing|director|head|vp|vice president|geschäftsführer|inhaber)\b/i;
/** Someone reachable beats someone senior; ties keep page order. */
export function bestPerson(people: Person[] | null | undefined): Person | null {
  const rank = (x: Person) => (x.email ? 0 : 2) + (x.title && SENIOR.test(x.title) ? 0 : 1);
  return (people ?? []).reduce<Person | null>((best, x) => (!best || rank(x) < rank(best) ? x : best), null);
}

/* ---------- list filtering ---------- */

export type SortKey = "score" | "name" | "status" | "updated" | "added";
export type Filters = {
  q: string; hasEmail: boolean; hasPerson: boolean; status: "" | Prospect["status"]; minScore: number; sort: SortKey; dir: "asc" | "desc";
};
/** The direction a column starts in when it is picked. */
export const SORT_DIR: Record<SortKey, Filters["dir"]> = { score: "desc", name: "asc", status: "asc", updated: "desc", added: "asc" };
export const NO_FILTERS: Filters = { q: "", hasEmail: false, hasPerson: false, status: "", minScore: 0, sort: "score", dir: "desc" };
export const isFiltered = (f: Filters) => !!(f.q.trim() || f.hasEmail || f.hasPerson || f.status || f.minScore > 0);

const STATUSES: Prospect["status"][] = ["new", "enriching", "enriched", "failed"];
const SORTERS: Record<SortKey, (a: Prospect, b: Prospect) => number> = {
  score: (a, b) => (a.score ?? -1) - (b.score ?? -1),
  name: (a, b) => a.company_name.localeCompare(b.company_name),
  status: (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status),
  updated: (a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at),
  added: (a, b) => a.id - b.id,
};

export function filterProspects(rows: Prospect[], f: Filters): Prospect[] {
  const q = f.q.trim().toLowerCase();
  const out = rows.filter((p) => {
    if (f.status && p.status !== f.status) return false;
    if (f.hasEmail && !bestEmail(p)) return false;
    if (f.hasPerson && !(p.people ?? []).length) return false;
    if (f.minScore > 0 && (p.score ?? -1) < f.minScore) return false;
    if (!q) return true;
    return [p.company_name, p.domain, p.city, p.industry, p.email, ...(p.people ?? []).map((x) => x.name), ...(p.emails ?? []).map((e) => e.email)]
      .some((v) => v?.toLowerCase().includes(q));
  });
  // stable: ties keep the order the rows came in
  return out.sort((a, b) => SORTERS[f.sort](a, b) * (f.dir === "desc" ? -1 : 1));
}

/** The view as a query string, defaults left out, so a refresh or a shared link shows the same rows. */
export function filtersToQuery(f: Filters): Record<string, string> {
  const o: Record<string, string> = {};
  if (f.q) o.q = f.q;
  if (f.hasEmail) o.email = "1";
  if (f.hasPerson) o.person = "1";
  if (f.status) o.status = f.status;
  if (f.minScore > 0) o.min = String(f.minScore);
  if (f.sort !== NO_FILTERS.sort) o.sort = f.sort;
  if (f.dir !== SORT_DIR[f.sort]) o.dir = f.dir;
  return o;
}
/** The reverse. Anyone can type a query string: every value is checked, anything odd falls back to the default. */
export function filtersFromQuery(p: { get(key: string): string | null }): Filters {
  const sort = Object.keys(SORT_DIR).includes(p.get("sort") ?? "") ? (p.get("sort") as SortKey) : NO_FILTERS.sort;
  const dir = p.get("dir"), status = p.get("status") as Prospect["status"], min = Number(p.get("min"));
  return {
    q: (p.get("q") ?? "").slice(0, 200), hasEmail: p.get("email") === "1", hasPerson: p.get("person") === "1",
    status: STATUSES.includes(status) ? status : "", minScore: min > 0 && min <= 100 ? Math.round(min) : 0,
    sort, dir: dir === "asc" || dir === "desc" ? dir : SORT_DIR[sort],
  };
}

/* ---------- CSV ---------- */

/** Quote every cell; prefix cells a spreadsheet would run as a formula.
 *  An international phone number (+ then digits and separators only) cannot call anything, and a CRM would import the prefix as part of it. */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[\s]*[=+\-@\t\r]/.test(s) && !/^\+\d[\d ().-]{4,24}$/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
export const toCsv = (cols: string[], rows: Record<string, unknown>[]) =>
  [cols.map(csvCell).join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\r\n");

/** Flat columns a CRM import understands; lists are joined with ";". */
export const PROSPECT_COLS = ["company", "domain", "website", "contact_name", "contact_title", "email", "email_status", "all_emails",
  "phone", "city", "country", "industry", "linkedin_company_url", "tech", "score", "source", "source_url", "notes", "message"];
export function prospectExportRow(p: Prospect): Record<string, unknown> {
  const person = bestPerson(p.people), emails = p.emails ?? [];
  const own = person?.email ? emails.find((e) => e.email === person.email) : undefined;
  // the named contact's own address when it is usable, so name and email belong to the same person
  const email = person?.email && own?.status !== "invalid" ? { email: person.email, status: own?.status ?? "unknown" } : bestEmail(p);
  return {
    company: p.company_name, domain: p.domain, website: p.website, contact_name: person?.name, contact_title: person?.title,
    email: email?.email, email_status: email?.status,
    all_emails: [...new Set([...emails.map((e) => e.email), p.email].filter(Boolean))].join(";"),
    phone: p.phone ?? p.phones?.[0], city: p.city, country: p.country, industry: p.industry,
    linkedin_company_url: p.socials?.linkedin, tech: (p.tech ?? []).join(";"), score: p.score, source: p.source,
    source_url: p.source_url, notes: p.notes, message: p.message,
  };
}

/* ---------- usage ---------- */

export const USAGE_KINDS = Object.keys(FREE_LIMITS) as Usage["kind"][];
export function planLimits(plan: string | null | undefined): Record<Usage["kind"], number> {
  const x = plan === "pro" ? 25 : plan === "team" ? 100 : 1;
  return Object.fromEntries(USAGE_KINDS.map((k) => [k, FREE_LIMITS[k] * x])) as Record<Usage["kind"], number>;
}

export type Budget = { n: number; remaining: number; held: number };
/** How much of an enrichment run fits in what is left of today's limit: `n` run now, `held` wait. */
export function enrichBudget(wanted: number, used: number, limit: number): Budget {
  const remaining = Math.max(0, limit - used), n = Math.min(wanted, remaining);
  return { n, remaining, held: wanted - n };
}
export function budgetText(b: Budget): string {
  const num = (x: number) => x.toLocaleString("en");
  if (!b.remaining) return "You have no enrichments left today. The limit resets at midnight UTC.";
  return `This will use ${num(b.n)} of your ${num(b.remaining)} remaining enrichments today.`
    + (b.held ? ` The other ${num(b.held)} stay pending until the limit resets at midnight UTC.` : "");
}

/* ---------- API errors ---------- */

export type FailCode = ApiError["code"] | "network" | "unavailable";
/** One clear sentence per failure. `detail` is the server's own text, shown only where it adds something. */
export function failMessage(code: FailCode, endpoint: string, detail?: string | null): string {
  const d = detail?.trim().slice(0, 160);
  switch (code) {
    case "quota": return "Daily limit reached for your plan. It resets at midnight UTC.";
    case "unauthorized": return "Your session has expired. Sign in again to continue.";
    case "not_configured": return d || (endpoint === "draft" ? "AI drafting is not enabled on this deployment yet."
      : "This feature is not enabled on this deployment yet.");
    case "blocked": return `That site does not allow automated access${d ? ` (${d})` : ""}.`;
    case "upstream": return `The source did not answer. Try again in a moment${d ? ` (${d})` : ""}.`;
    case "bad_request": return d || "That request was not valid. Check the fields and try again.";
    case "network": return "Could not reach Ghost Leads. Check your connection and try again.";
    default: return "The lead engine is not available on this deployment yet.";
  }
}
export function codeForStatus(status: number): FailCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "quota";
  if (status === 400) return "bad_request";
  if (status === 422) return "blocked";
  if (status === 503) return "not_configured";
  return status >= 500 ? "upstream" : "unavailable";
}

/* ---------- enrichment ---------- */

/** Rows a plain Enrich run picks up: never tried, or left in `enriching` by a closed tab.
 *  Failed rows are not retried on their own: every attempt counts against the daily limit. */
export const needsEnrich = (p: Pick<Prospect, "domain" | "status">) => !!p.domain && (p.status === "new" || p.status === "enriching");
/** Rows the explicit "Retry failed" action picks up. */
export const canRetry = (p: Pick<Prospect, "domain" | "status">) => !!p.domain && p.status === "failed";

/** The row as it is before an enrichment: the facts the source gave, plus whatever an earlier crawl already found. */
export type EnrichRow = Pick<Prospect, "id" | "company_name" | "domain" | "website" | "phone" | "address" | "description">
  & Partial<Pick<Prospect, "emails" | "phones" | "socials" | "people" | "tech" | "status" | "error">>;

const present = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== "")) as Partial<T>;

/** What an enrichment writes back. Facts from the discovery source win over the crawl where both exist, and a
 *  re-crawl only adds: a contact found earlier stays even when the page that listed it is gone or blocked this time.
 *  Emails match on the lowercased address and people on the name; for a match, the newer non-empty fields win. */
export function enrichmentPatch(p: Omit<EnrichRow, "id">, e: Enrichment) {
  const emails = new Map([...(p.emails ?? []), ...e.emails].map((x) => [x.email.toLowerCase(), x]));
  const people = new Map<string, Person>();
  for (const x of [...(p.people ?? []), ...e.people]) {
    const key = slug(x.name) || x.name;
    people.set(key, { ...(people.get(key) ?? x), ...present(x) });
  }
  return {
    company_name: p.company_name === p.domain && e.company_name ? e.company_name : p.company_name,
    website: p.website ?? e.website, phone: p.phone ?? e.phones[0] ?? null, address: p.address ?? e.address,
    description: p.description ?? e.description,
    emails: sortEmails([...emails.values()]), phones: [...new Set([...(p.phones ?? []), ...e.phones])],
    socials: { ...p.socials, ...present(e.socials) }, people: [...people.values()], tech: [...new Set([...(p.tech ?? []), ...e.tech])],
    score: e.score, score_reasons: e.score_reasons, status: "enriched" as const, error: null,
  };
}
export type RunProgress = { total: number; done: number; failed: number; skipped: number };
/** Failures that would repeat for every row: out of quota, signed out, or the API itself is unreachable. */
const FATAL = ["quota", "unauthorized", "unavailable", "network"] as const;
export type RunResult = RunProgress & { stopped: null | "user" | (typeof FATAL)[number] };

/** Enrich rows with a small worker pool. Each row goes enriching -> enriched | failed through `save`.
 *  Stops taking new rows on user stop or a fatal failure; the row that hit it goes back to the status it had. */
export async function runEnrichment(rows: EnrichRow[], deps: {
  enrich: (row: EnrichRow & { domain: string }) => Promise<Enrichment>;
  save: (id: number, patch: Partial<Prospect>) => Promise<void>;
  onProgress?: (p: RunProgress) => void;
  shouldStop?: () => boolean;
  concurrency?: number;
}): Promise<RunResult> {
  const queue = rows.filter((r): r is EnrichRow & { domain: string } => !!r.domain);
  const prog: RunProgress = { total: queue.length, done: 0, failed: 0, skipped: rows.length - queue.length };
  let stopped: RunResult["stopped"] = null;
  let next = 0;
  const report = () => deps.onProgress?.({ ...prog });
  report();
  const worker = async () => {
    while (next < queue.length && !stopped) {
      if (deps.shouldStop?.()) { stopped = "user"; break; }
      const row = queue[next++];
      try {
        await deps.save(row.id, { status: "enriching", error: null });
        await deps.save(row.id, enrichmentPatch(row, await deps.enrich(row)));
        prog.done++;
      } catch (e) {
        const code = FATAL.find((c) => c === (e as { code?: string } | null)?.code);
        if (code) {
          stopped = stopped ?? code;
          // nothing was learned: the row goes back to what it was (a re-enrich must not turn an enriched row into a new one)
          const was = row.status === "enriched" || row.status === "failed" ? row.status : "new";
          await deps.save(row.id, { status: was, error: was === "failed" ? row.error ?? null : null }).catch(() => {});
        } else {
          prog.failed++;
          const error = (e instanceof Error ? e.message : "Enrichment failed").slice(0, 300);
          await deps.save(row.id, { status: "failed", error }).catch(() => {});
        }
      }
      report();
    }
  };
  await Promise.all(Array.from({ length: Math.min(deps.concurrency ?? 3, queue.length) }, worker));
  return { ...prog, stopped };
}
