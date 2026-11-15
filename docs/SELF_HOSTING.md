# Self-hosting

How to run your own instance of the hosted product with your own Supabase and Vercel accounts.

Two migrations live in `supabase/migrations/`. Run them in order: `20261031_base.sql` (workspaces, membership, event
pipeline, worker RPCs), then `20261115_lead_engine.sql` (lists, prospects, scrapes, usage metering). The base file was
reconstructed from the hosted database and has not yet been run against a fresh project; report anything it misses.

## What you need

- A Supabase account and a Vercel account.
- Node 22 (the version CI uses) or newer, npm, and the Vercel CLI (`npm i -g vercel`).
- Optional provider keys: OpenAI (drafting, AI extraction), Serper (web search).

## 1. Create the Supabase project

1. Create a new project in the Supabase dashboard.
2. Note the **project URL** and the **publishable (anon) key** (Project Settings → API). You do not need the
   service-role key; do not put it anywhere in this application.
3. Authentication: the app signs users up with email and password (`supabase.auth.signUp`) and sends the company name
   as user metadata. Under Authentication → URL Configuration, set the Site URL to your deployment URL and add
   `https://<your-domain>/app` to the redirect URLs, because the confirmation email links back to `/app`.

## 2. Create the base schema

Open the Supabase SQL editor and run `supabase/migrations/20261031_base.sql`. It creates `gl_workspaces`,
`gl_members`, the event pipeline tables, `gl_is_member` and the `gl_worker_*` RPCs, with row-level security.
To use the local worker later, insert the SHA-256 hex of your `GL_WORKER_SECRET` into `gl_worker_keys`.

## 3. Apply the lead engine migration

Run `supabase/migrations/20261115_lead_engine.sql` once, either by pasting it into the SQL editor or with the Supabase
CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

It creates `gl_lists`, `gl_prospects`, `gl_scrapes`, `gl_usage`, the `gl_use` function, their policies and grants, and
adds `gl_workspaces.plan`. Tables, the column and the functions are created idempotently, but the `create policy`
statements are not: running the file a second time fails on the first policy that already exists.

Check afterwards:

```sql
select proname from pg_proc where proname in ('gl_use', 'gl_is_member');   -- two rows
select tablename, rowsecurity from pg_tables
 where schemaname = 'public' and tablename like 'gl_%';                    -- rowsecurity = true everywhere
```

## 4. Create the Vercel project

From the repository:

```bash
cd web
npm ci
vercel link        # create or select a project; the project root is this web/ directory
```

If you import the Git repository in the Vercel dashboard instead, set **Root Directory** to `web`. `web/vercel.json`
already declares the Vite framework, the `dist` output directory and the single-page-app rewrite. Files in `web/api/`
are deployed as Node functions automatically. No `maxDuration` is configured, so the platform default applies; a draft
request can take up to three model calls of 45 seconds each in the worst case.

## 5. Set environment variables

In the Vercel project, for Production (and Preview if you use it):

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | Your Supabase project URL. Read at build time. |
| `VITE_SUPABASE_KEY` | Your publishable (anon) key. Read at build time. |
| `SUPABASE_URL` | The same project URL. Read by the functions at run time. |
| `SUPABASE_ANON_KEY` | The same publishable key. Read by the functions at run time. |
| `OPENAI_API_KEY` | Optional. Enables drafting and AI extraction. |
| `OPENAI_MODEL` | Optional. Default `gpt-4.1-mini`. |
| `SERPER_API_KEY` or `BRAVE_API_KEY` | Optional. One of them enables the web search and LinkedIn sources. |
| `OVERPASS_URL` | Optional. An Overpass API endpoint you are allowed to use, for fuller local-business results. |

The four Supabase variables are not optional for a self-hosted instance. Without them the code falls back to the
original hosted project's URL and publishable key, which are compiled into `web/src/lib.ts` and `web/server/http.ts`:
your users would sign up in someone else's project. Set all four, and redeploy after changing a `VITE_*` value because
it is baked into the bundle.

Never put the Supabase service-role key or any provider key in a `VITE_*` variable.

For local development with `vercel dev`, put the same values in `web/.env.local` (ignored by Git).

The crawler's user agent string in `web/server/fetch.ts` contains a link to the original deployment. If you run your
own instance, change that link to your own `/bot` page so site owners who look up the crawler reach you.

## 6. Deploy

```bash
cd web
vercel deploy --prod
```

Then open `https://<your-domain>/api/health`. It should answer with JSON such as
`{"ai":true,"search":"serper","version":"abc1234"}`. An HTML answer means the functions were not deployed (wrong root
directory).

## 7. Create the first account

1. Open `https://<your-domain>/signup`, enter a company name, email and password.
2. Confirm the email if your Supabase project requires confirmation.
3. On first sign-in the app creates a workspace named after the company and opens `/app`.
4. Run a search under Find leads. If it returns `unauthorized`, the function and the browser are pointing at different
   Supabase projects (step 5), or `gl_use` / `gl_is_member` is missing (steps 2 and 3).

## Operating notes

- **Plans.** There is no billing integration. Change a workspace's plan in the SQL editor:

  ```sql
  update gl_workspaces set plan = 'pro' where id = '<workspace id>';   -- 'free' | 'pro' | 'team'
  ```

- **Usage.** `select * from gl_usage where day = current_date;` shows today's counters. Limits are defined inside
  `gl_use` and mirrored in `FREE_LIMITS` in `web/shared/types.ts`; change both together.
- **Event signals.** To use the local worker against your project, see
  [EVENT_PIPELINE.md](EVENT_PIPELINE.md#cloud-bridge-event-signals-in-the-web-app). It uses the base schema objects
  from step 2.
- **Responsible use.** You operate the crawler and are responsible for how its output is used. Keep the `/bot` page
  reachable and accurate. See the Responsible use section of the [README](../README.md#responsible-use).
