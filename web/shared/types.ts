// Contract between the browser app (src/) and the Vercel functions (api/). Types plus one constant; no logic.

export type Source = "maps" | "web" | "startups" | "hiring" | "directory" | "import";

/** valid: mailbox domain accepts mail and the address was published by the company.
 *  risky: guessed pattern, or a domain we could not fully check. invalid: bad syntax or no mail server. */
export type EmailStatus = "valid" | "risky" | "invalid" | "unknown";
export type FoundEmail = {
  email: string;
  kind: "personal" | "role" | "guessed";
  status: EmailStatus;
  reason: string | null;        // short human reason for the status, e.g. "no MX record"
  source_url: string | null;    // page the address was published on; null for guessed
};
export type Person = {
  name: string; title: string | null; email: string | null; linkedin: string | null; source_url: string | null;
};
export type Socials = Partial<Record<"linkedin" | "twitter" | "facebook" | "instagram" | "youtube" | "github" | "tiktok", string>>;
export type Signal = { kind: "hiring" | "funding" | "event" | "tech" | "other"; label: string; url: string | null };

/** One company returned by a discovery source, before enrichment. */
export type DiscoverItem = {
  company_name: string;
  website: string | null;
  domain: string | null;        // registrable domain, lowercase, no www
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  industry: string | null;
  description: string | null;
  source: Source;
  source_url: string | null;    // where this record came from (always set when the source has a page for it)
  signals: Signal[];
};

export type DiscoverParams =
  | { source: "maps"; query: string; location: string; limit?: number }        // OpenStreetMap businesses
  | { source: "web"; query: string; limit?: number }                           // web search -> company sites
  | { source: "startups"; query?: string; industry?: string; location?: string; hiring?: boolean; limit?: number }
  | { source: "hiring"; query: string; location?: string; limit?: number }     // companies with open roles
  | { source: "directory"; url: string; limit?: number };                      // any list page: exhibitors, members, partners
export type DiscoverRequest = { ws: string } & DiscoverParams;
export type DiscoverResponse = { items: DiscoverItem[]; note: string | null };

export type EnrichRequest = { ws: string; domain: string; company_name?: string };
export type Enrichment = {
  domain: string;
  website: string;
  company_name: string | null;
  description: string | null;
  language: string | null;
  emails: FoundEmail[];
  phones: string[];
  socials: Socials;
  people: Person[];
  tech: string[];
  address: string | null;
  pages_crawled: number;
  score: number;                // 0-100 contactability score
  score_reasons: string[];      // why, in plain words
};

export type ExtractRequest = { ws: string; url: string; fields?: string[]; instructions?: string };
export type ExtractResponse = {
  columns: string[];
  rows: Record<string, string | null>[];
  method: "ai" | "table" | "list" | "jsonld";
  note: string | null;
};

export type DraftRequest = {
  ws: string;
  channel: "email" | "linkedin";
  offer: string;                // what the sender sells, in their words
  prospect: Pick<DiscoverItem, "company_name" | "description" | "industry" | "city" | "signals"> & { person?: Person | null; tech?: string[] };
};
export type DraftResponse = { subject: string | null; message: string };

export type VerifyRequest = { ws: string; emails: string[] };
export type VerifyResponse = { results: FoundEmail[] };

export type Health = { ai: boolean; search: "serper" | "none"; version: string };

/** Every non-2xx response body. HTTP: 400 bad_request, 401 unauthorized, 422 blocked (robots.txt, private address,
 *  not HTML), 429 quota, 502 upstream, 503 not_configured (feature needs a provider key). */
export type ApiError = {
  error: string;
  code: "bad_request" | "unauthorized" | "blocked" | "quota" | "upstream" | "not_configured";
};

/** Row of gl_prospects (see supabase/migrations). */
export type Prospect = Omit<DiscoverItem, "signals"> & {
  id: number; workspace_id: string; list_id: string; key: string;
  emails: FoundEmail[]; phones: string[]; socials: Socials; people: Person[]; tech: string[]; signals: Signal[];
  score: number | null; score_reasons: string[];
  status: "new" | "enriching" | "enriched" | "failed"; error: string | null;
  message: string | null; notes: string | null; created_at: string; updated_at: string;
};
export type List = {
  id: string; workspace_id: string; name: string; source: Source; query: Record<string, unknown>; created_at: string;
};
export type Scrape = {
  id: string; workspace_id: string; name: string; url: string; fields: string[]; columns: string[];
  rows: Record<string, string | null>[]; method: string; created_at: string;
};
export type Usage = { kind: "discover" | "enrich" | "extract" | "draft" | "verify"; n: number; day: string };
/** Daily limits on the free plan; pro is x25, team x100. Mirrors gl_use() in the migration. */
export const FREE_LIMITS: Record<Usage["kind"], number> = { discover: 40, enrich: 200, extract: 40, draft: 60, verify: 500 };
