# Architecture

This document describes the hosted product in `web/` and `supabase/`. The local Python event pipeline is described in
[EVENT_PIPELINE.md](EVENT_PIPELINE.md).

## Components

| Component | Where | Role |
| --- | --- | --- |
| Browser app | `web/src` | Marketing site, sign-in, signed-in app. Owns all database reads and writes. |
| Functions | `web/api/*.ts` | Thin Vercel Node handlers. One file per endpoint. |
| Engine | `web/server/**` | Request plumbing (`http.ts`), outbound fetcher (`fetch.ts`, `robots.ts`), discovery sources (`sources/`), enrichment, extraction, drafting, email checks. |
| Contract | `web/shared/types.ts` | Request and response types shared by the browser and the functions, plus `FREE_LIMITS`. |
| Database | Supabase Postgres | Tables with row-level security; `gl_use` RPC. Migration in `supabase/migrations/`. |
| Auth | Supabase Auth | Issues the access token the browser sends to both Supabase and the functions. |

The functions are stateless and hold no service-role key. They never write to the database. The only thing they send to
Supabase is one `gl_use` RPC call per request, made with the caller's own token.

## Auth and metering sequence

Every metered endpoint is built with `endpoint(kind, prepare)` in `web/server/http.ts`:

```
Browser                         Function                         Supabase (PostgREST)
   |  POST /api/<kind>             |                                   |
   |  Authorization: Bearer <jwt>  |                                   |
   |  { ws, ... }                  |                                   |
   |------------------------------>|                                   |
   |                               | 1. method is POST, token present, |
   |                               |    body is a JSON object,         |
   |                               |    ws is a UUID                   |
   |                               | 2. prepare(body): validate input, |
   |                               |    no I/O                         |
   |                               | 3. POST /rest/v1/rpc/gl_use       |
   |                               |    { p_ws, p_kind, p_n }          |
   |                               |    apikey: publishable key        |
   |                               |    Authorization: Bearer <jwt>    |
   |                               |---------------------------------->|
   |                               |                                   | verify JWT
   |                               |                                   | gl_is_member(p_ws)?
   |                               |                                   | n + p_n <= limit(plan)?
   |                               |<----------------------------------| { used, limit } or error
   |                               | 4. run(): do the work             |
   |<------------------------------| 200 JSON                          |
   |  write result rows through RLS (browser -> Supabase)              |
```

- **Authentication** is PostgREST verifying the JWT. A missing or invalid token gives 401.
- **Authorization** is `gl_use` checking `gl_is_member(p_ws)`. A non-member gets Postgres error `42501`, mapped to 401.
- **Metering** is an atomic `update ... where n + p_n <= lim returning n` on `gl_usage`. If no row is updated the
  function raises `quota`, mapped to 429. Limits are `discover 40, enrich 200, extract 40, draft 60, verify 500` per
  day, multiplied by 25 for `pro` and 100 for `team`. The day is Postgres `current_date` (UTC on Supabase).
- `p_n` is 1 for every endpoint except `verify`, where it is the number of addresses (1 to 50).
- Input validation runs before metering, so a malformed request costs nothing. Metering runs before the work, so a
  request that then fails upstream still uses quota.
- `gl_use` is `security definer` so it can write `gl_usage`, which members can only read.

Error responses always have the shape `{ error, code }`:

| HTTP | code | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | Invalid input |
| 401 | `unauthorized` | No token, bad token, or not a member of the workspace |
| 422 | `blocked` | robots.txt disallows the page, the address is not public, or the response is not a web page |
| 429 | `quota` | Daily limit reached |
| 502 | `upstream` | The target site, a data source, Supabase or the AI provider failed or timed out |
| 503 | `not_configured` | The feature needs a provider key that is not set |

## Endpoints

All POST bodies include `ws` (workspace id). Types are in `web/shared/types.ts`.

### `POST /api/discover`

Body: `{ ws, source, ...params, limit? }`. `limit` defaults to 25, maximum 100. Returns `{ items: DiscoverItem[], note }`.
`web/server/discover.ts` validates the parameters and dispatches to one source:

| `source` | Parameters | Flow |
| --- | --- | --- |
| `maps` | `query`, `location` | Nominatim geocodes `location` to a bounding box. The search word is mapped to OpenStreetMap tags (`sources/maps.ts`, `CATEGORIES`); unknown words are matched against names. Default: Nominatim tag search inside the box (up to 40 hits, one tag). With `OVERPASS_URL`: one Overpass query for all tags of the category. Results are ranked so that places with a website, email or phone come first. Nominatim calls are throttled to one per second per instance. |
| `web` | `query` | Serper when `SERPER_API_KEY` is set, otherwise DuckDuckGo's HTML endpoint. Results are reduced to company domains: social networks, directories, marketplaces, review sites and news are dropped (`sources/item.ts`). If DuckDuckGo returns no results (it usually serves a bot challenge), the answer is 503 `not_configured`. |
| `startups` | `query?`, `industry?`, `location?`, `hiring?` | Downloads a JSON file from `yc-oss.github.io/api` (hiring list, one industry, or all companies), caches it in memory for six hours, filters locally. Inactive companies and those without a website are skipped. |
| `hiring` | `query`, `location?` | Queries Himalayas (search API) and Arbeitnow (latest roles) in parallel, matches every query word against job title and tags, groups by company. Items carry `hiring` signals that link to the job posting. These items have no website. |
| `directory` | `url` | Fetches the page through `safeFetch`, finds repeated outbound links that look like a company list, follows same-site "next" links for up to five pages. If fewer than three companies are found and OpenAI is configured, the page text is given to the model instead and the response note says so. |

All sources deduplicate by registrable domain.

### `POST /api/enrich`

Body: `{ ws, domain, company_name? }`. Returns an `Enrichment`. `web/server/enrich.ts`:

1. Normalise the domain (must be a public ICANN domain, not an IP).
2. Fetch `https://<domain>/` (retry on `www.` if the bare host fails with a network error).
3. Pick up to six internal pages: links on the home page that look like contact, imprint, team or about pages, then
   common paths for kinds the home page does not link to. Fetch them three at a time, 7 s each.
4. From every page: emails (including Cloudflare-obfuscated and bracketed "(at)" forms), phones, social links, named
   people with a stated role, postal address. Each email remembers the first page it was seen on.
5. Keep addresses on the company's own domain (plus freemail addresses), at most 12. Check each: syntax, then MX.
6. Match personal addresses to named people. If the domain accepts mail, guess one address for up to five people
   without one, using the pattern detected from a published address or `first.last`. Guesses are `kind: "guessed"`,
   `status: "risky"`, `source_url: null`.
7. Detect tech from the home page HTML and headers. Compute the score (0-100) and its reasons.

Every outbound request in this flow goes through `safeFetch`.

### `POST /api/extract`

Body: `{ ws, url, fields?, instructions? }`. Returns `{ columns, rows, method, note }`. `web/server/extract.ts`:

- Fetch the page through `safeFetch`.
- If the caller gave `fields` or `instructions` and OpenAI is configured: send the visible text (up to 40,000
  characters) to the model with a strict JSON schema. `method: "ai"`.
- Otherwise use heuristics and pick the best of: JSON-LD items, the largest HTML table, the largest run of same-shaped
  siblings. `method` is `jsonld`, `table` or `list`. If the caller asked for columns but AI is not configured, the
  note says the request was not applied.
- At most 500 rows, 500 characters per cell, up to 30 field names.

### `POST /api/draft`

Body: `{ ws, channel: "email" | "linkedin", offer, prospect }`. Returns `{ subject, message }`. Returns 503 without
`OPENAI_API_KEY`. `web/server/draft.ts` sends only the listed prospect facts and the offer, with rules that forbid
invented claims. Length limits (90 words for email, 280 characters for LinkedIn) are checked in code; the model is asked
to shorten up to twice, then the request fails with 502.

### `POST /api/verify`

Body: `{ ws, emails: string[] }` (1 to 50). Returns `{ results: FoundEmail[] }`. For each address: syntax check, then an
MX lookup on the domain (3 s timeout, cached per instance). Because no source page is known, the best possible result
here is `risky` ("domain accepts mail, mailbox not tested"). No SMTP connection is made.

### `GET /api/health`

No auth, no metering. Returns `{ ai, search, version }`: whether `OPENAI_API_KEY` is set, which search provider is
active, and the short commit SHA.

## Enrichment runs

There is no server-side queue. `runEnrichment` in `web/src/app/logic.ts` runs in the browser:

- A pool of three workers takes rows that have a domain and whose status is `new` or `enriching`. Rows in `failed`
  are retried only on an explicit request, because every attempt counts against the daily limit.
- For each row it writes `status = 'enriching'`, calls `/api/enrich`, then writes the result and `status = 'enriched'`,
  or `status = 'failed'` with the error text.
- Quota, sign-out, network and "API unavailable" errors stop the run; the row that hit the error goes back to `new`.
- A closed tab leaves rows as `enriching`. They count as pending, so the next run picks them up.

## Data model

Defined in `supabase/migrations/20261115_lead_engine.sql`. All tables have row-level security enabled.

| Table | Key columns | Notes |
| --- | --- | --- |
| `gl_workspaces` (pre-existing) | `id`, `name`, `plan` | The migration adds `plan` (`free`, `pro`, `team`; default `free`). |
| `gl_lists` | `id`, `workspace_id`, `name`, `source`, `query` (jsonb), `created_by`, `created_at` | One saved search or import. |
| `gl_prospects` | `id`, `workspace_id`, `list_id`, `key`, `company_name`, `domain`, `website`, `phone`, `email`, `address`, `city`, `country`, `industry`, `description`, `source`, `source_url`, `emails`, `phones`, `socials`, `people`, `tech`, `signals` (jsonb), `score`, `score_reasons`, `status`, `error`, `message`, `notes`, `created_at`, `updated_at` | One company in one list. `unique (list_id, key)`; `key` is the domain, or a slug of name and city for companies without a website. `status` is `new`, `enriching`, `enriched` or `failed`. `updated_at` is maintained by a trigger. |
| `gl_scrapes` | `id`, `workspace_id`, `name`, `url`, `fields`, `columns`, `rows` (jsonb), `method` | A saved Scraper result. |
| `gl_usage` | `(workspace_id, day, kind)` primary key, `n` | Daily counters. Members can read; only `gl_use` writes. |

Policies: `gl_lists`, `gl_prospects` and `gl_scrapes` allow all operations to `authenticated` users for whom
`gl_is_member(workspace_id)` is true (both `using` and `with check`). `gl_usage` has a select policy only. Deleting a
workspace or list cascades to its rows.

The event pipeline tables (`gl_events`, `gl_leads`, `gl_attendees`, `gl_jobs`), `gl_is_member` and the `gl_worker_*`
RPCs are defined in `supabase/migrations/20261031_base.sql` and are not touched by this migration.

## Trust boundaries

| Boundary | Risk | Defence |
| --- | --- | --- |
| User-supplied URLs and domains reach the server's network | SSRF: reaching internal services or cloud metadata | `checkUrl` in `server/fetch.ts`: http/https only, no credentials in the URL, default ports only, hostname must contain a dot and not end in `.local`, `.internal` or `.localhost`, IP literals checked against a block list. At connect time a custom DNS `lookup` rejects the request if any resolved address is private, loopback, link-local (including 169.254.169.254), CGNAT, multicast, or an IPv6 form that can tunnel to private IPv4, so a DNS answer cannot change between check and use. Each redirect hop (maximum five) is validated again. Responses are capped at 3 MB and 10 s, and only HTML, JSON, XML and plain text types are read. |
| The crawler visits third-party sites | Ignoring site owners' wishes; load | `robots.txt` is fetched and applied before every page (`server/robots.ts`, RFC 9309 matching, own group or `*`). A 4xx on robots.txt means no restrictions; a 5xx or network error means the site is not crawled. Rules are cached for one hour per instance. The user agent is `GhostLeadsBot/1.0` with a link to the site. Fetches happen only on a user's request; an enrichment reads at most seven pages of a site. |
| Fixed third-party APIs | Not user-controlled | `apiJson` is used only for hard-coded hosts (Nominatim, yc-oss, Himalayas, Arbeitnow, Serper) and the operator-set `OVERPASS_URL`. It does not go through the SSRF guard and must not be given user-supplied URLs. |
| Browser to database | One member reading or changing another workspace's data | Row-level security on every table, keyed on `gl_is_member(workspace_id)`. The browser only has the publishable key and the user's own token. |
| Members and their plan | A member raising their own limits | Column-level grants: `insert` and `update` on `gl_workspaces` are revoked from `authenticated` and `anon` and re-granted for the `name` column only. `plan` can be changed only by a privileged role (SQL editor, a future billing backend). `gl_usage` cannot be written by members at all. |
| Browser to functions | Unauthenticated or cross-workspace use; cost abuse | `gl_use` is called with the caller's token before any work. `execute` on it is revoked from `public` and `anon`. `p_n` is bounded to 1-50. Inputs have length and count limits. |
| Scraped content shown in the app | Stored XSS from a hostile page | Scraped strings are rendered as React text nodes; the app does not use `dangerouslySetInnerHTML`. Links are rendered only when `safeUrl` accepts them (plain `http(s)` URLs), so `javascript:` URLs never become an `href`. External links use `rel="noreferrer"`. |
| Scraped content in CSV exports | Formula injection when opened in a spreadsheet | `csvCell` in `web/src/app/logic.ts` quotes every cell and prefixes cells that start with `=`, `+`, `-`, `@`, tab or carriage return (after optional whitespace) with an apostrophe. |
| Scraped content sent to the LLM | Prompt injection changing the output | Model output is constrained by a strict JSON schema and is only ever stored as cell text or shown as a draft for a person to review. The model has no tools and nothing is sent automatically. Extraction and directory prompts instruct the model to copy values and not invent them. For directory pages the code also drops any company name that does not appear in the page text and any website URL that is not a link on the page. This reduces but does not remove the risk of wrong rows; AI-read results are labelled. |
| Secrets | Leaking provider keys to the browser | Provider keys are read only in `web/server` from `process.env`. `VITE_*` variables hold only the Supabase URL and publishable key. |

## Upgrade path

- **Server-side job queue for enrichment.** Move the browser-driven loop to a queue (for example a jobs table plus a
  scheduled or queue-triggered function) so runs continue when the tab closes and concurrency is controlled centrally.
  This needs a trusted writer, which the current design deliberately avoids.
- **Billing webhook that sets `plan`.** A payment provider webhook, verified server-side, updating
  `gl_workspaces.plan` with a privileged key. The column grants already prevent members from doing this themselves.
- **Proxy or browser-rendering provider** for JavaScript-heavy sites, plugged into `safeFetch` so the SSRF and robots
  rules still apply.
- **SMTP-level verification provider** for mailbox checks. Port 25 is not available on Vercel, so this has to be an
  external service called from `server/email.ts`.
- **Shared rate limiting and caches** (Nominatim throttle, robots and MX caches) if the functions run on many
  instances.
- **Base schema verification.** `20261031_base.sql` was reconstructed from the hosted database; run it against a
  fresh project (or a Supabase branch) to confirm a new instance can be created from the repo alone.
