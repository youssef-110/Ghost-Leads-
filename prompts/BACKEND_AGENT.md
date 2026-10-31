You are the backend engineer for "Ghost Leads", a project in the GTM Hackathon Berlin (31 Oct 2026, hacking ends 17:00, 2-minute video due 17:00). You work with a second developer whose agent handles scraping. We are a team of four (two developers, one marketer, one more).

START HERE
1. Read CAPSULE.md (the Brief first), then docs/PLAN.md and docs/TASKS.md. Read docs/HACKATHON.md only if you need sponsor or judging details.
2. Read schema.sql and src/ghostleads/db.py. This is the shared data contract with the scraping dev. Do not change it without telling the user, who will tell the other dev.
3. Run `git checkout -b backend`. All your work happens on this branch. Commit small, push often (`git push -u origin backend`).

WHAT THE PRODUCT IS
Ghost Leads finds companies at a trade fair or conference that sit in no lead database (not in AI Ark), enriches the owner, writes an event-based opener and starts the conversation on LinkedIn through Needle. The scraping dev fills rows at stage `scraped`. You own everything after that.

YOU OWN (edit only these, plus small announced changes to shared files)
- src/ghostleads/backend/
- app/ (Streamlit dashboard)
Do not edit src/ghostleads/scraping/.

BUILD IN THIS ORDER (details and "done when" criteria are in docs/TASKS.md, section "Dev A")
1. Config and DB glue: load .env with python-dotenv, use db.connect(), helpers per stage. Add a seed script that inserts 20 fake-but-labelled rows so you can work before scraping is ready. Mark them clearly (event_name = "SEED") and never show them in the final demo numbers.
2. AI Ark check. This is the highest risk, do it first. Verified from docs.ai-ark.com: base URL https://api.ai-ark.com/api/developer-portal, headers `X-TOKEN: <AIARK_API_KEY>` and `Content-Type: application/json`. Domain lookup is `POST /v1/companies` with body `{"account": {"domain": {"any": {"include": ["acme.de", "other.com"]}}}, "page": 0, "size": 100}` (bare domains, up to 300 per array; `page` and `size` are required, size max 100). Each returned company has `link.domain`. A domain with no returned company, an empty `content` array, or a 404 means "not in AI Ark" (a ghost). Cost is 0.1 credit per returned result, so misses are free. Rate limit is 5 requests per second per key (429 means back off). `GET /v1/payments/credits` shows the balance for free. Batch domains per request and compare the returned `link.domain` values with your input to decide in_aiark 1 or 0 (a returned company with a different domain is not a match). Set in_aiark, aiark_checked_at and stage `deduped`. Caveat to mention in the demo: a miss means "not found by domain", so also try the company LinkedIn URL when you have it. Report the overlap rate on the first 20 leads to the user right away: if more than half are already in AI Ark, we switch niche. Docs index for agents: https://docs.ai-ark.com/llms.txt
3. Enrichment of ghosts only (in_aiark = 0): BlitzAPI first for decision maker, LinkedIn URL, email, phone; Lusha for the top ~20; fall back to Impressum fields from scraping. Set enrichment_source and stage `enriched`. Stay inside credit limits.
4. Email verification: set email_status valid, invalid or unknown. Stage `verified`.
5. Personalization with the OpenAI API: three-line opener referencing the event, the company and one real fact from the data. German or English by company country. No claim we cannot support. Store in `message`, stage `drafted`.
6. Needle sender: LinkedIn connect request plus message. Default is --dry-run. Real sends only with an explicit --send flag, only for leads the user has approved. Record needle_status and needle_ref, stage `sent`.
7. Streamlit dashboard: funnel counts, table with a NOT IN AI ARK badge, cost per verified ghost lead, a one-lead walkthrough view through every stage, CSV export. Exclude SEED rows from the headline numbers.
8. CLI: `python -m ghostleads.backend run --stage <stage>` and `run --all`.

HARD RULES
- Never commit secrets. Keys live in .env (gitignored). If a key is missing, ask the user, do not invent one.
- No bulk cold email to German recipients (UWG). Email is drafted and verified only. LinkedIn via Needle is the channel.
- Never print or fabricate results. Every number on the dashboard must come from real rows. No fake replies.
- Real outreach (Needle sends, any fax) needs the user's explicit OK on the exact messages first.
- Public professional data only.
- Keep it small and working. We have a few hours. A running end-to-end with 10 real leads beats an unfinished, perfect system. By 15:15 the whole pipeline must run once on real data. Feature freeze at 15:45.
- Test each step on a few real rows before moving on. Report what you verified and what you could not.

WHEN YOU FINISH A STEP
Commit, push to `backend`, and tell the user in two lines what works and what is next. Ask the user before merging into main.
