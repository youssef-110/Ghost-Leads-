# Ghost Leads

**Website:** https://ghost-leads-operator-demo.vercel.app/ — the public Vercel deployment serves the React website at `/` and a read-only pipeline walkthrough at `/app`. It is not the Streamlit dashboard, has no live database connection, and cannot create drafts or send messages. Its figures are a dated local snapshot; local draft references do not verify a remote Needle queue. The functional, database-backed dashboard runs locally with the instructions below.

A local, review-first event prospecting workbench. It discovers exhibitor companies, checks whether they are already in AI Ark, enriches and verifies contact data, drafts contextual outreach, and tracks Needle invitations, replies and meetings. The Streamlit dashboard presents the pipeline and makes the safe steps runnable without hiding provider errors or inventing leads.

## Run the dashboard

Requires Python 3.10+ (3.13 tested). From the repository root:

```bash
python -m venv .venv
# Windows: .venv\Scripts\python.exe -m pip install -r requirements.txt
# macOS/Linux: .venv/bin/python -m pip install -r requirements.txt
.venv\Scripts\python.exe -m pip install -e .       # use .venv/bin/python on macOS/Linux
copy .env.example .env                            # on macOS/Linux: cp .env.example .env
.venv\Scripts\python.exe -m streamlit run app/dashboard.py
```

Open the local URL printed by Streamlit (normally `http://localhost:8501`). The dashboard runs without credentials for local exploration; provider-dependent actions require valid keys in `.env`. The local SQLite database defaults to `data/ghostleads.db` (override with `GL_DB`). Both `.env` and `data/` are ignored by Git: cloning this repository **does not** include private leads or API keys. The app explains its empty state rather than displaying manufactured metrics.

For a quick **clearly labelled sample** in a fresh clone, run `.venv\Scripts\python.exe -m ghostleads.backend seed`. Seed rows are excluded from real-event KPIs and never sent. For a real event, configure `.env`, then ingest the exhibitor directory you are authorized to use:

```bash
.venv\Scripts\python.exe -m ghostleads.scraping run --event-url <exhibitor-directory-url> --event-name <event-name>
```

Event metadata and evidence rules live in `events/*.json`; sender identity and permitted marketing claims live in `outreach.json`. Review both before drafting. Scraping depends on the source site being reachable and structured appropriately; it does not manufacture missing exhibitors or owners.

## Safe workflow

| Step | What happens | Human gate |
| --- | --- | --- |
| Discover | Scrape exhibitor listings, normalize domains, extract public contact information. | Choose a legitimate event source. |
| Dedupe | Compare domains with AI Ark; distinguish matches, domain misses, and unchecked rows. | Provider access and honest matching required; a domain miss is not proof the company is absent. |
| Enrich / verify | Find relevant owner, profile and contact signals; validate available data. | Check provenance and avoid unsupported claims. |
| Draft | Generate short, event-specific notes using `outreach.json`. | Review the exact text for each lead. |
| Queue / send | CLI preview is the default; the dashboard can create one reviewed Needle draft. | Review the exact recipient and text locally, then again in Needle. Direct sending through this app is disabled. |
| Replies / meetings | Sync inbound activity and prepare meeting invitations. | Approve responses and confirm a specific slot before booking. |

The dashboard's automation runs the **pre-send** pipeline only. It does not silently queue drafts, send LinkedIn messages, answer replies, or book meetings on page load. Provider connectivity is not implied by the presence of a key. Counts come from persisted, non-SEED rows.

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

Direct sending through the app is disabled, including the legacy `send --send --ids` route. Bulk `--draft` CLI creation is disabled; use the dashboard to review one recipient and the exact text before creating a pending Needle draft. If a provider outcome is ambiguous, reconcile it manually before trying again—never assume an absent local draft ID means the remote call failed. Approval and sending happen only in Needle after a second review. Replies and booking require separate human validation.

## Presentation / troubleshooting

See [docs/DEMO.md](docs/DEMO.md) for a repeatable local walkthrough and honest interpretation of statuses. Open [the six-slide operator presentation](docs/presentation.html) locally in a browser; its figures are a dated local snapshot, not a live report or a public deployment. The historical handoff is in `CAPSULE-backend.md`; implementation context in `docs/PLAN.md` and `docs/TASKS.md`.

Run checks with `python -m pytest -q` after installing the project and `pytest`. This repository intentionally excludes local lead data and credentials; use an existing authorized local database or ingest your own source to see real counts.
