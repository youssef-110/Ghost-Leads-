# Ghost Leads

Ghost Leads is a lead research tool for B2B sales and outreach teams. You describe the companies you want (local
businesses in a city, companies from a web search, startups, companies that are hiring, or any list page such as an
exhibitor directory), it finds them from public sources, reads each company's own website for contact details, scores
how reachable each company is, and drafts a first message for you to review. Nothing is ever sent by the product.

**Live:** https://ghost-leads-dusky.vercel.app

It started as a hackathon tool (Python CLI, Streamlit, SQLite) for finding leads at trade fairs. That pipeline still
exists and is surfaced in the app as "Event signals"; see [Event signals](#event-signals-local-worker).

## Features

- **Find leads** from five sources:
  - Local businesses from OpenStreetMap (Nominatim; an Overpass server if you configure one).
  - Web search results reduced to company websites (Serper; DuckDuckGo's HTML endpoint is tried when no key is set,
    but it usually refuses automated clients).
  - Startups from the open-source Y Combinator dataset ([yc-oss/api](https://github.com/yc-oss/api)).
  - Companies with open roles, from the public Himalayas and Arbeitnow job APIs.
  - Any directory or list page (exhibitors, members, partners), read by page structure, with an LLM fallback.
  - Plus import: paste or upload domains (up to 1,000 per import).
- **Enrich** a company by crawling its own site (home page plus up to six contact, imprint, team and about pages):
  email addresses with an MX check and the page each was found on, phone numbers, social profiles, named people with
  roles, postal address, detected tech stack, and a 0-100 contactability score with plain-language reasons.
- **Scraper**: turn any public page into rows (JSON-LD, HTML tables, repeated cards). With an OpenAI key you can name
  the columns you want and describe what to extract.
- **Draft** a cold email or LinkedIn note from the prospect's published facts and your offer (needs an OpenAI key).
- **Verify** a batch of email addresses (syntax and MX only).
- **Lists**: save results, filter, enrich in bulk, add notes, export CSV.
- **Event signals**: the original event pipeline, run by a local worker.
- Workspaces with daily usage limits per plan; all data isolated per workspace by Postgres row-level security.

## Architecture

```
                         Supabase
                 (Auth + Postgres with RLS)
                   ^                    ^
   sign-in, read/  |                    |  rpc/gl_use with the caller's token
   write rows via  |                    |  (auth + membership + daily metering)
   RLS             |                    |
               +---+-----+  POST /api/* +------------------+  safeFetch   +----------------+
               | Browser |------------->| Vercel functions |------------->| Public web     |
               | (React) |<-------------| web/api, server  |              | company sites, |
               +---------+  JSON        +------------------+              | OSM, job APIs, |
                                                |                         | YC dataset     |
                                                +-----------------------> | Serper, OpenAI |
                                                                          +----------------+
```

- The browser talks to Supabase directly for sign-in and for all reads and writes of its own rows.
- The browser calls the Vercel functions for work that needs a server (fetching other sites, DNS, the LLM). Each
  call carries the user's Supabase access token.
- A function validates the request, then calls the `gl_use` RPC with that token. This one call authenticates the
  user, checks workspace membership and counts the request against the daily limit. Only then does it do the work.
- Functions return data. They hold no service-role key and never write to the database; the browser stores results
  through row-level security.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repository layout

```
web/                      Hosted product (Vite + React 19 + TypeScript, deployed on Vercel)
  src/                    Marketing site, sign-in, and the signed-in app (src/app)
  api/                    Vercel Node functions: discover, enrich, extract, draft, verify, health
  server/                 Engine code used by the functions (fetcher, robots, sources, enrichment, extraction)
  shared/types.ts         Request/response contract between src/ and api/
  tests/                  Unit tests (node:test)
supabase/migrations/      SQL for the lead engine tables and the gl_use RPC
src/ghostleads/           Python event pipeline (backend stages, scraper, cloud worker)
app/                      Streamlit dashboard for the event pipeline
events/, outreach.json    Event cards and sender identity for the event pipeline
tests/                    Python tests
docs/                     ARCHITECTURE.md, SELF_HOSTING.md, EVENT_PIPELINE.md, and hackathon history
```

Hackathon history is kept as it was: `docs/DEMO.md`, `docs/HACKATHON.md`, `docs/PLAN.md`, `docs/TASKS.md`,
`docs/presentation.html`, `CAPSULE.md`, `CAPSULE-backend.md`, `prompts/`.

## Quick start (local development)

Requires Node 22 or newer.

```bash
cd web
npm ci
vercel dev        # site + /api functions on one local port (needs the Vercel CLI: npm i -g vercel)
# or
npm run dev       # UI only (Vite). /api calls fail and the app reports the lead engine as unavailable.
```

Supabase wiring: the browser client in `web/src/lib.ts` and the functions in `web/server/http.ts` both default to the
hosted project's URL and publishable key, so a fresh clone works against that project without any configuration. The
publishable key is meant to be public; access is limited by row-level security. To use your own Supabase project,
override both sides:

- Browser (build time): `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY`
- Functions (run time): `SUPABASE_URL`, `SUPABASE_ANON_KEY`

Set all four or none. If only one side is overridden, sign-in and metering point at different projects and every API
call fails with `unauthorized`.

## Environment variables

For the hosted product, set these in the Vercel project (Settings → Environment Variables). For `vercel dev`, put them
in `web/.env.local` (or pull them with `vercel env pull`). `VITE_*` variables are read by Vite at build time and end up
in the browser bundle, so never put a secret in one.

| Variable | Required | What it enables | Where |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | No | Drafting (`/api/draft` returns 503 without it), AI extraction with custom columns, AI fallback for directory pages without a regular structure | Vercel env / `web/.env.local` |
| `OPENAI_MODEL` | No | Model for the above. Default `gpt-4.1-mini` | Vercel env / `web/.env.local` |
| `SERPER_API_KEY` | No, but web search is unreliable without it | Web search source through Serper. Without it DuckDuckGo is tried and usually refuses, which returns 503 | Vercel env / `web/.env.local` |
| `OVERPASS_URL` | No | Use an Overpass API server for the local-business source instead of Nominatim's tag search (more complete results). No default: the public overpass-api.de instance excludes commercial use | Vercel env / `web/.env.local` |
| `SUPABASE_URL` | Only for your own Supabase project | Project the functions call `gl_use` on | Vercel env / `web/.env.local` |
| `SUPABASE_ANON_KEY` | Only for your own Supabase project | Publishable (anon) key sent as `apikey` with `gl_use` | Vercel env / `web/.env.local` |
| `VITE_SUPABASE_URL` | Only for your own Supabase project | Project the browser signs in to and reads/writes | Vercel env (build) / `web/.env.local` |
| `VITE_SUPABASE_KEY` | Only for your own Supabase project | Publishable key for the browser client | Vercel env (build) / `web/.env.local` |
| `VERCEL_GIT_COMMIT_SHA` | Set by Vercel | Version shown by `/api/health` (`dev` locally) | Automatic |

The Python event pipeline reads a separate `.env` at the repository root (`AIARK_API_KEY`, `BLITZ_API_KEY`,
`NEEDLE_API_KEY`, `OPENAI_API_KEY`, `GL_DB`, and for the cloud worker `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`GL_WORKER_SECRET`). See [.env.example](.env.example) and [docs/EVENT_PIPELINE.md](docs/EVENT_PIPELINE.md).

`GET /api/health` reports what is configured: `{ "ai": true|false, "search": "serper"|"none", "version": "..." }`.

## Testing

Web (from `web/`):

```bash
npm run lint
npx tsc -p tsconfig.api.json                                            # type-check api/, server/, shared/
npm test                                                                # unit tests (node:test via tsx)
npm run build                                                           # type-check src/ and build the site
```

`npm run build` does not type-check `api/` or `server/`, which is why the `tsc -p tsconfig.api.json` step is separate.

Python event pipeline (from the repository root):

```bash
python -m pip install -r requirements.txt -e . pytest
python -m pytest -q
```

CI (`.github/workflows/tests.yml`) runs both.

## Deployment

1. Apply `supabase/migrations/20261115_lead_engine.sql` to the Supabase project first (SQL editor, or
   `supabase db push`). The migration is additive, but the app will not work until it has run: the functions call
   `gl_use` and the app reads the new tables.
2. Set the environment variables above in the Vercel project.
3. Deploy from `web/`:

   ```bash
   cd web
   vercel deploy --prod
   ```

   `web/vercel.json` builds with Vite, serves `dist`, and rewrites client-side routes to `index.html`. Files in
   `web/api/` are deployed as Node functions.

To run your own instance from scratch, follow [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

## Limits and known shortcuts

Daily limits per workspace (enforced in `gl_use`, reset at midnight UTC):

| Action | Free | Pro (x25) | Team (x100) |
| --- | --- | --- | --- |
| discover | 40 | 1,000 | 4,000 |
| enrich | 200 | 5,000 | 20,000 |
| extract | 40 | 1,000 | 4,000 |
| draft | 60 | 1,500 | 6,000 |
| verify (per address) | 500 | 12,500 | 50,000 |

Known shortcuts:

- **No billing.** Plans are changed by hand in the database:
  `update gl_workspaces set plan = 'pro' where id = '<workspace id>';`
  Members cannot change their own plan (column-level grants).
- **Enrichment runs are driven by the browser tab.** The list page enriches three companies at a time and writes each
  result as it arrives. Closing the tab stops the run; pressing Enrich again resumes with the rows that were never
  tried or were left mid-run. Failed rows are not retried automatically, because every attempt counts against the
  daily limit. A server-side job queue is the upgrade path.
- **No SMTP verification.** Email checks are syntax plus an MX lookup. "valid" means "published by the company on a
  domain that accepts mail", not "this mailbox exists". Guessed addresses are always marked "risky".
- **DuckDuckGo fallback is best-effort.** It normally answers automated clients with a bot challenge; the API then
  returns 503 `not_configured`. Treat `SERPER_API_KEY` as required for the web search source.
- **Local-business results are limited without Overpass.** The default Nominatim search returns at most 40 places per
  query and searches one OpenStreetMap tag per category.
- **No JavaScript rendering.** Pages that build their content in the browser yield little or nothing.
- **Quota is counted before the work runs**, so a request that fails upstream still uses one unit.
- **Rate limits and caches are per function instance** (robots.txt cache, MX cache, the one-request-per-second
  Nominatim throttle). They are not shared across instances.
- The list page loads the first 1,000 companies of a list; search, enrich and export apply to those.
- `supabase/migrations/20261031_base.sql` was reconstructed from the hosted database and has not yet been run
  against a fresh Supabase project (see [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)).

## Operating notes

- **Contact form.** `/contact` writes to the `gl_contact` table (insert-only for visitors). Read new messages in the
  Supabase table editor or with `select * from gl_contact order by created_at desc;`. Plan requests, crawler opt-outs
  and data removal requests all arrive there.
- **Plans.** `update gl_workspaces set plan = 'pro' where id = '...';` (or `team`). There is no billing integration.
- **Hiring leads.** Job boards publish no company website, so each name is looked up through Clearbit's public
  company autocomplete and a website is attached only on an exact name match.

## Responsible use

- The crawler identifies itself as `GhostLeadsBot/1.0`, fetches only when a user asks, follows robots.txt
  (RFC 9309; an unreachable robots.txt is treated as "stay out"), and refuses private, loopback and cloud-metadata
  addresses.
- It collects public business contact data that a company published on its own site, and stores the page each value
  came from. It does not sign in, submit forms, or work around CAPTCHAs or paywalls.
- Nothing is sent automatically. Drafts are text for a person to review and send themselves.
- Outreach compliance is the operator's responsibility. Whether you may contact someone depends on your jurisdiction
  and theirs, for example the GDPR and, in Germany, the UWG rules on unsolicited advertising. Having found an address
  is not a legal basis for using it.
- Site owners can opt out: the `/bot` page of the deployed site explains what the crawler does and gives the
  robots.txt lines that keep it away.

## Event signals (local worker)

The original event pipeline (exhibitor scraping, AI Ark dedupe, enrichment, drafting, Needle drafts and reply sync)
runs locally in Python. The web app's Event signals section queues jobs in Supabase; they are processed only while a
worker is running on your machine:

```bash
python -m ghostleads.cloud worker
```

It needs provider keys (Needle, AI Ark, Blitz, OpenAI) and a worker secret. Setup, the Streamlit dashboard, the CLI
and the safety rules are documented in [docs/EVENT_PIPELINE.md](docs/EVENT_PIPELINE.md).
