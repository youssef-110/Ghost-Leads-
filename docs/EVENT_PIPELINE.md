# Event pipeline (local Python worker)

This is the original Ghost Leads tool: a local, review-first event prospecting workbench. It discovers exhibitor
companies, checks whether they are already in AI Ark, enriches and verifies contact data, drafts contextual outreach,
and tracks Needle invitations, replies and meetings. It runs on your machine with a SQLite database and your own
provider keys.

In the hosted app it appears as **Event signals** (`/app/events`). The web app does not run this pipeline itself: it
writes jobs to Supabase, and a worker you start locally picks them up. See [Cloud bridge](#cloud-bridge-event-signals-in-the-web-app).

The hosted lead engine (Find leads, Lists, Scraper) does not need anything on this page. See the
[repository README](../README.md).

## Requirements

- Python 3.10 or newer (3.13 is what CI runs).
- Provider keys in a `.env` file at the repository root. Copy `.env.example` and fill in what you use:

| Variable | Used by |
| --- | --- |
| `AIARK_API_KEY` | Dedupe stage (is the company already in AI Ark) |
| `BLITZ_API_KEY` | Enrich and verify stages |
| `OPENAI_API_KEY` | Draft stage, attendee search, reply handling, and the scraper's LLM fallback |
| `NEEDLE_API_KEY` | Attendee search, draft queueing, send/reply sync |
| `SERPER_API_KEY` | Optional. The scraper uses it to find a website for exhibitors that list none |
| `OPENAI_MODEL` | Optional. Model for the scraper's LLM fallback (default `gpt-4.1-mini`) |
| `GL_DB` | Optional. SQLite path (default `data/ghostleads.db`) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GL_WORKER_SECRET` | Only for the cloud bridge below |

## Run the dashboard

From the repository root:

```bash
python -m venv .venv
# Windows: .venv\Scripts\python.exe -m pip install -r requirements.txt
# macOS/Linux: .venv/bin/python -m pip install -r requirements.txt
.venv\Scripts\python.exe -m pip install -e .       # use .venv/bin/python on macOS/Linux
copy .env.example .env                            # on macOS/Linux: cp .env.example .env
.venv\Scripts\python.exe -m streamlit run app/dashboard.py
```

Open the local URL printed by Streamlit (normally `http://localhost:8501`). The dashboard runs without credentials for
local exploration; provider-dependent actions require valid keys in `.env`. The local SQLite database defaults to
`data/ghostleads.db` (override with `GL_DB`). Both `.env` and `data/` are ignored by Git: cloning this repository
**does not** include private leads or API keys. The app explains its empty state rather than displaying manufactured
metrics.

For a quick **clearly labelled sample** in a fresh clone, run `.venv\Scripts\python.exe -m ghostleads.backend seed`.
Seed rows are excluded from real-event KPIs and never sent. For a real event, configure `.env`, then ingest the
exhibitor directory you are authorized to use:

```bash
.venv\Scripts\python.exe -m ghostleads.scraping run --event-url <exhibitor-directory-url> --event-name <event-name>
```

Event metadata and evidence rules live in `events/*.json`; sender identity and permitted marketing claims live in
`outreach.json`. Review both before drafting. Scraping depends on the source site being reachable and structured
appropriately; it does not manufacture missing exhibitors or owners.

## Safe workflow

| Step | What happens | Human gate |
| --- | --- | --- |
| Discover | Scrape exhibitor listings, normalize domains, extract public contact information. | Choose a legitimate event source. |
| Dedupe | Compare domains with AI Ark; distinguish matches, domain misses, and unchecked rows. | Provider access and honest matching required; a domain miss is not proof the company is absent. |
| Enrich / verify | Find relevant owner, profile and contact signals; validate available data. | Check provenance and avoid unsupported claims. |
| Draft | Generate short, event-specific notes using `outreach.json`. | Review the exact text for each lead. |
| Queue / send | CLI preview is the default; the dashboard can create one reviewed Needle draft. | Review the exact recipient and text locally, then again in Needle. Direct sending through this app is disabled. |
| Replies / meetings | Sync inbound activity and prepare meeting invitations. | Approve responses and confirm a specific slot before booking. |

The dashboard's automation runs the **pre-send** pipeline only. It does not silently queue drafts, send LinkedIn
messages, answer replies, or book meetings on page load. Provider connectivity is not implied by the presence of a key.
Counts come from persisted, non-SEED rows.

CLI equivalents (run from repository root):

```bash
python -m ghostleads.backend run --all                         # send is dry-run
python -m ghostleads.backend run --stage draft                 # dedupe | enrich | verify | draft | send
python -m ghostleads.backend attendees search events/web-summit-2026.json
python -m ghostleads.backend attendees promote events/web-summit-2026.json
python -m ghostleads.backend run --stage send                  # preview only
python -m ghostleads.backend run --stage send sync             # sync approval/sent statuses
python -m ghostleads.backend replies sync                     # inbound status/replies
```

Direct sending through the app is disabled, including the legacy `send --send --ids` route. Bulk `--draft` CLI creation
is disabled; use the dashboard to review one recipient and the exact text before creating a pending Needle draft. If a
provider outcome is ambiguous, reconcile it manually before trying again. Never assume an absent local draft ID means
the remote call failed. Approval and sending happen only in Needle after a second review. Replies and booking require
separate human validation.

## Cloud bridge: Event signals in the web app

`src/ghostleads/cloud.py` connects the local pipeline to the hosted app.

```bash
python -m ghostleads.cloud publish --workspace "<workspace name or id>"   # push local real rows into a workspace
python -m ghostleads.cloud worker                                         # run jobs queued from the web app
python -m ghostleads.cloud worker --once                                  # process the current queue, then exit
```

How it works:

- The web app inserts rows into `gl_jobs` (through row-level security, as the signed-in member). The worker polls
  the `gl_worker_claim` RPC every few seconds, runs each job with the local pipeline, and reports the result with
  `gl_worker_finish`. If no worker is running, the Event signals page shows a "worker offline?" hint after 45 seconds.
- Job kinds: `attendee_search` (Needle search and promote for one event), `pipeline` (dedupe, enrich, verify, draft),
  `queue_drafts` (create Needle drafts for the leads a member approved in the app; nothing is sent until it is
  approved again in Needle), `sync` (send statuses and replies).
- The worker authenticates with `GL_WORKER_SECRET`. Supabase stores only a hash of it, so the worker needs no
  service-role key. It also needs `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the publishable key) in `.env`.
- Event names are unique across workspaces. `publish` claims each local event for the target workspace and skips events
  another workspace already owns. The worker never trusts event names in a job payload: it only reads and pushes events
  the workspace owns, and `queue_drafts` only acts on leads that Supabase confirms belong to the job's workspace.
- `SEED` rows are never published.

Known gap: the Supabase side of this bridge (tables `gl_workspaces`, `gl_events`, `gl_leads`, `gl_attendees`,
`gl_jobs`, the `gl_is_member` function and the `gl_worker_*` RPCs, including how the worker secret hash is registered)
exists in the hosted project but is not in this repository as SQL. See [SELF_HOSTING.md](SELF_HOSTING.md).

## Tests

```bash
python -m pip install -r requirements.txt -e . pytest
python -m pytest -q
```

The repository intentionally excludes local lead data and credentials; use an existing authorized local database or
ingest your own source to see real counts.

## History

Hackathon-era material is kept unchanged: [DEMO.md](DEMO.md) (local walkthrough), [presentation.html](presentation.html)
(operator slides; figures are a dated local snapshot), [PLAN.md](PLAN.md), [TASKS.md](TASKS.md),
[HACKATHON.md](HACKATHON.md), and `CAPSULE.md` / `CAPSULE-backend.md` at the repository root.
