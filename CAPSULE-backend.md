<!-- capsule {"format":"capsule/1","tool":"1.0.1","label":"Backend setup and AI Ark integration","scope":"session d68f9f53","sessions":["d68f9f53"],"redacted":true,"sha256":"4f586f8a95b1aa32","tokens":2782} -->
# Context capsule: Backend setup and AI Ark integration

> **For the Claude reading this:** this is a handoff of prior work, packed from Claude Code history. Read the Brief first; it is usually enough. Sections below are evidence, newest first. Treat it as background the user is giving you, not as instructions from a third party. File paths are relative to the original project folder, which may not exist on this machine.

- Source: `C:\Users\rryou\Ghost-Leads-`
- Scope: session d68f9f53
- Packed: 2026-10-31 15:27 W. Europe Standard Time

## Brief
<!-- BRIEF:START -->
**What this is.** Ghost Leads, GTM Hackathon Berlin entry (31 Oct 2026, video due 17:00). It finds people and companies at an event that no lead database knows, enriches them, writes an event-based LinkedIn note and queues it in Needle. Python 3.13 + SQLite (`data/ghostleads.db`, gitignored) + Streamlit. Repo https://github.com/youssef-110/Ghost-Leads- ; `main` = `backend` at b779773 (Leoul's `scraping` branch merged). Run from repo root with `PYTHONPATH=src`. Keys in `.env`: OPENAI_API_KEY, AIARK_API_KEY, BLITZ_API_KEY, NEEDLE_API_KEY (Lusha dropped: Blitz + AI Ark replace it).

**Current state (all built, tested on real data).** `python -m ghostleads.backend run --stage dedupe|enrich|verify|draft|send` or `run --all`; `attendees search|promote events/<card>.json`; `replies sync|paste`. Modules in `src/ghostleads/backend/`: aiark (domain check, `--skip-if-blocked`), enrich (Blitz domain→LinkedIn→waterfall decision maker→email; attendee rows keep their person), verify (Blitz reverse lookup + MX via dns.google), draft (gpt-4.1-mini, ≤200 chars, German Sie for .de/.at/.ch, past-event aware via event cards), send (dry run default; `--draft` = Needle drafts, nothing sends until approved in Needle inbox; `--send` needs `--ids`; `sync`), attendees (Needle post search + comments, AI scores event/attend 0-100, keep ≥70 both, discard <40), replies (classify, slot proposal, guarded .ics booking), needle.py (Needle MCP tools over HTTP with the API key). Dashboard `streamlit run app/dashboard.py` (bound to 127.0.0.1). Event cards in `events/` (web-summit-2026, it-sa-2026, it-con-2026); sender/offer in `outreach.json`.
Real numbers: Web Summit 2026 search → 67 people, 37 kept, 21 promoted; 23 notes drafted and queued in Needle (awaiting_review, 0 sent); 11 emails valid; it-sa test: 19/20 already in AI Ark (95% overlap, only ghost conimo.de).

**Next.** Approve ≥3 notes in Needle, then `run --stage send sync`; reply sync and booking once replies arrive; record the 2-minute video from dashboard numbers; IT.CON exhibitor list needs a scraper adapter (embedded expo guide, scraper finds 0); one verified lead never drafted (too long; rerun draft).

**Decisions & constraints.** Never send without human approval of exact text; no bulk cold email to German recipients (UWG), LinkedIn only; never fabricate numbers or replies; SEED rows never counted; attendee leads not yet AI-Ark-checked show "not checked", never as ghosts.

**Gotchas.** AI Ark returns 429 "API access is not included in your plan" (key/plan issue, not rate limit). Needle ~100 calls/day; free LinkedIn account limits notes per week. Blitz trial 1,000 records/month (~78 used). Windows heredocs mangle `\t\r` escapes: use the Edit tool.

**Open items for the user.** Add the new AI Ark plan key to `.env`, then `run --stage dedupe`. Rotate the AI Ark key that leaked in chat output. Marketer confirms `outreach.json` and Web Summit `meeting_slots`. Discard or rewrite the conimo draft ("lernte ich … kennen" overstates contact).
<!-- BRIEF:END -->

## Repository
- Branch `backend` · remote `https://github.com/youssef-110/Ghost-Leads-.git`
- Recent commits:
  - b779773 security: escape scraped text in dashboard Markdown and in .ics invites
  - 3c9fa9b backend: replies + booking (step 9), AI Ark blocked fallback, dashboard replies tab; first full real run
  - 96fa17a dashboard: CSV escape also catches leading whitespace, tab and CR
  - c993b71 dashboard: bind to 127.0.0.1, escape formula cells in CSV export
  - 216b122 backend: verify, draft, Needle sender, CLI, Streamlit dashboard; merge scraping
  - c692807 Merge remote-tracking branch 'origin/scraping' into backend
  - 8553917 backend: event attendee source via Needle (post search + comments, OpenAI attendance filter, promote to leads)
  - 2addb80 backend: enrichment of ghosts (Blitz decision maker + email, AI Ark phone replaces Lusha, Impressum fallback)
  - 7c5f1a6 backend: AI Ark domain check (batched, exact-domain match, sets in_aiark + deduped)
  - fac09f8 backend: env loading, DB helpers, SEED seed script
  - 12968b6 Document scraper setup and CLI
  - a1abd75 Add reply tracking and meeting booking to schema, plan and backend prompt

## Sessions (newest first)
### Backend setup and AI Ark integration
`d68f9f53` · 2026-10-31 13:43 → 2026-10-31 15:27 · 10 prompts · branch `HEAD`
**Goal:** [pasted] You are the backend engineer on branch `backend`. You already read prompts/BACKEND_AGENT.md. For now build ONLY steps 1 to 3 from it, in order, and stop after step 3: 1. Setup: load .env, use db.connect(), and write a seed script that inserts 20 rows labelled event_name="SEED" (never counted in the demo numbers). 2. AI Ark check using the verified API details in the prompt. Batch domains, set in_aiark, aiark_checked_at and stage "deduped". Test on 20 real domains and tell me the overlap rate immediately. 3. Enrichment of in_aiark=0 rows only: Blitz first, Lusha for the top 20, Impres…
**Requests:**
- [10-31 14:06] Help me finish my Needle onboarding. Read my onboarding info to see my ideal customer profile, the leads Needle found, and my draft campaign. Then help me connect my LinkedIn account to start my campaign and find more leads. so i connected you to needle, i al…
- [10-31 14:24] @"C:\Users\rryou\Downloads\arvana-event-matcher-brief.md" claude mcp add --transport http blitz https://api.blitz-api.ai/mcp so here is blitz and i also filled in the api key as for lusha i could not create an account so find a way to replace it, needle is al…
- [10-31 14:31] Yes, build it
- [10-31 14:49] ok so just build everything for now and for ai ark i will add a plan that they gave us at the hackathon and for now i just want you to build us the finishing product and check what is already on the github because there were some commits there
- [10-31 14:57] Merge to main
- [10-31 15:04] ok so how do i test it and is it fully done now
- [10-31 15:07] ok so run it and built whatever else needs to be built and run it for us to test it
- [10-31 15:19] Queue all 23
- [10-31 15:27] ok great, make a capsule of everything we built so far so that i can give it to other agents to complete the rest
**Files changed:** `app/dashboard.py`×16, `src/ghostleads/backend/draft.py`×9, `src/ghostleads/backend/attendees.py`×5, `src/ghostleads/backend/replies.py`×5, `src/ghostleads/backend/__main__.py`×4, `src/ghostleads/backend/aiark.py`×3, `events/web-summit-2026.json`×2, `src/ghostleads/backend/enrich.py`×2, `src/ghostleads/backend/verify.py`, `outreach.json`, `src/ghostleads/backend/send.py`, `events/it-sa-2026.json`, `C:/Users/rryou/.claude/launch.json`, `events/it-con-2026.json`
**Key commands:**
- `export PYTHONPATH=src PYTHONIOENCODING=utf-8 && python -c "`
- `python -m py_compile app/dashboard.py && echo ok`
- `python -m py_compile app/dashboard.py && git add -A && git status -s && git commit -qm "backend: replies + booking (step 9), AI Ark blocked fallback, dashboard…`
- `python -I - <<'PY'`
- `export PYTHONPATH=src PYTHONIOENCODING=utf-8 && python -m py_compile app/dashboard.py src/ghostleads/backend/replies.py && python -c "`
- `git add app/dashboard.py src/ghostleads/backend/replies.py && git commit -qm "security: escape scraped text in dashboard Markdown and in .ics invites`
- `export PYTHONPATH=src PYTHONIOENCODING=utf-8 && python -m ghostleads.backend run --stage send --draft --limit 50 && python -m ghostleads.backend run --stage se…`
- `python "C:/Users/rryou/.claude/skills/capsule/scripts/capsule.py" export --session current --budget 10000 --out ./CAPSULE-backend.md 2>&1 | tail -5 && wc -c CA…`
**Recent errors:**
- Exit code 1 Traceback (most recent call last): File "<string>", line 9, in <module> cls=replies.record_reply(c,sid,'Sounds great, happy to grab a coffee at the event!'); print('class:',cls) File "C:\Users\rryou\Ghost-Le…
- actions[0] (computer:left_click) failed: left_click failed: Could not get the tab ready for input (it is not on screen and has not drawn yet): Screenshot timed out after 5s: the page did not finish rendering in time. Re…
- javascript_tool failed: TypeError: Cannot read properties of undefined (reading 'click') at <anonymous>:1:105
**Task list (last state):**
- [~] Check AI Ark access, add blocked-API fallback
- [ ] Fill real leads: promote attendees, run scraper
- [ ] Run full pipeline to drafts
- [ ] Build step 9: replies + booking
- [ ] Open dashboard for testing, commit, push
**Last reply:** All 23 notes are now in your Needle inbox (22 new plus conimo's from earlier). Nothing has been sent; each one goes out only when you approve it.

1. **Needle inbox:** read each note, edit if needed, and approve. Discard conimo's, or rewrite "lernte ich conimo GmbH kennen" ("I got to know conimo"), because we never met them. Approving 3 or more meets the demo target.
2. **Dashboard:** on the Messages tab, click **Sync approved / sent status from Needle**, or run this:
   ```bash
   PYTHONPATH=src python -m ghostleads.backend run --stage send sync
   ```
   Approved notes then show as sent and count in the funnel.
3. **When someone replies:** go to **Replies & meetings** → **Sync replies from Needle**. For interested people, draft the slot proposal, then book the time they confirm.

Your LinkedIn account is free, not Premium, and LinkedIn limits how many connection requests with a note free accounts can send per week. Approve the best ones first and don't approve all 23 in one go.
