# Task split

Two developers, one shared SQLite table. Each owns a folder. The data contract is `schema.sql` and `src/ghostleads/db.py`. Change the contract only after telling the other dev.

## Ownership
- Dev A (backend, branch `backend`): `src/ghostleads/backend/`, `app/` (dashboard)
- Dev B (scraping, branch `scraping`): `src/ghostleads/scraping/`
- Shared (small PRs, announce first): `schema.sql`, `src/ghostleads/db.py`, `docs/`, `.env.example`, `requirements.txt`
- Marketer: event choice, message angles, offer and pricing, 10-20 LinkedIn targets sanity check, pitch, video script.

## Interface between the two
Dev B writes rows with `db.upsert_scraped(...)`: `event_name`, `event_url`, `source_url`, `company_name`, `domain` (bare, lowercase, no www), and when found `impressum_url`, `owner_name`, `owner_title`, `owner_email`, `owner_phone`. Rows start at stage `scraped`.
Dev A reads rows by stage and moves them: `scraped` to `deduped` to `enriched` to `verified` to `drafted` to `sent`. Dev B never changes stage past `scraped`.

## Dev B: scraping (owner of the top of the funnel)
1. Event adapter: given an event page URL, return exhibitors, speakers and sponsors with company name and website. Generic first (fetch page, extract with an OpenAI structured-output call), site-specific parsing only if the generic one fails. Done when: 50+ companies from one real event land in the DB.
2. Domain resolution: company name to bare domain (serper.dev) when the page has no link. Done when: 90%+ of rows have a domain.
3. Impressum extractor: fetch `/impressum` (and `/kontakt`, `/imprint`), extract owner name, title, email, phone. Done when: runs on 30 domains and fills the owner for at least half, with a clear null when not found. No hallucinated values: only text that appears on the page.
4. Politeness and safety: respect robots.txt and rate limits, cache fetched pages in `data/cache/`, public pages only.
5. CLI: `python -m ghostleads.scraping run --event-url <url> --event-name <name>`.
6. Stretch: second event source or Apify actor if the first is thin.

## Dev A: backend (owner of everything after scraping)
1. Config and DB: `.env` loading, `db.init()` on start, helpers to read by stage.
2. AI Ark check (highest risk, do first): given a domain, set `in_aiark` 0 or 1 and `aiark_checked_at`. If there is no single-domain lookup, bulk-export and diff locally. Run the 20-lead pre-test and report the overlap rate to the team immediately. Done when: all `scraped` rows get `deduped`, ghosts have `in_aiark = 0`.
3. Enrichment of ghosts only: Blitz first (decision maker, LinkedIn URL, email, phone), Lusha for the top ~20, fall back to the Impressum owner fields. Record `enrichment_source`. Respect credit limits. Done when: 70%+ of ghosts have a person and a LinkedIn URL.
4. Email verification: set `email_status` (valid, invalid, unknown). Keep only valid for the email column shown as verified.
5. Personalization: OpenAI call writes a 3-line opener from event name, company and one scraped fact. German or English by company country. Store in `message`. No claims we cannot support.
6. Needle sender: send LinkedIn connect request plus message for 10-20 approved leads. Record `needle_status` and `needle_ref`. A `--dry-run` flag is the default. Real sends need an explicit `--send` flag and a human OK on the message list.
7. Dashboard (Streamlit in `app/`): funnel counts, table with a NOT IN DB badge, cost per verified ghost lead, a single-lead detail view that walks the stages, a CSV export button.
8. Orchestrator CLI: `python -m ghostleads.backend run --stage <stage>` and `run --all`.

## Shared
- 13:30 to 14:00: Dev A merges the contract skeleton to main, both pull it, both create `.env` from `.env.example`.
- 15:15: first end-to-end on real data, both present.
- 15:45: freeze. After that only bug fixes.
- 16:00: record the video together. Use real numbers from the dashboard.
- Marketer reviews every message before any Needle send.

## Git workflow
- `main` stays runnable. Work on `backend` or `scraping`, commit small and often, push often.
- Merge to main only after the other dev has pulled and run it. No force pushes.
- Never commit `.env`, API keys, the SQLite file, or `data/cache/`.

## Acceptance for the demo
One real event, at least 50 companies scraped, ghost count shown against AI Ark, at least 20 enriched with a named person, at least 10 messages drafted, at least 3 real Needle touches sent, dashboard showing the funnel, a 2-minute video submitted before 17:00.
