<!-- capsule {"format":"capsule/1","tool":"1.0.1","label":"Hackathon team name","scope":"session a9091821","sessions":["a9091821"],"redacted":true,"sha256":"9ffcd62e40b6aebc","tokens":2232} -->
# Context capsule: Hackathon team name

> **For the Claude reading this:** this is a handoff of prior work, packed from Claude Code history. Read the Brief first; it is usually enough. Sections below are evidence, newest first. Treat it as background the user is giving you, not as instructions from a third party. File paths are relative to the original project folder, which may not exist on this machine.

- Source: `C:\Users\rryou`
- Scope: session a9091821
- Packed: 2026-10-31 13:30 W. Europe Standard Time

## Brief
<!-- BRIEF:START -->
**What this is.** Ghost Leads: our entry for the GTM Hackathon Berlin (Halloween edition, Sat 31 Oct 2026, hosted by Arvana and GTMengineer.dev). Hacking 12:00 to 17:00, a 2-minute video walkthrough is due 17:00. Judging is Business Impact, Tech, Works end-to-end, Pitch (25% each). Jury: Nils, Arne Unkrig (Arvana), Emanuel Morhard (GTMengineer.dev). Prize pool 2,000 EUR. The event is about real pipeline for an existing product, not a new product. Team: 4 people (2 developers, 1 marketer, 1 more). Repo: https://github.com/youssef-110/Ghost-Leads-

**The idea.** Find companies at a trade fair or conference (exhibitors, speakers, sponsors) that sit in no lead database ("ghosts", not in AI Ark), enrich the owner, write an event-based opener and start the conversation on LinkedIn through Needle. Niche: IT service providers (Systemhaeuser, MSPs) in Germany, Austria, Switzerland; fallback asset managers and family offices. The marketer picks the real event. The slides state only leads NOT in AI Ark count.

**How we got here.** A five-seat council (Strategist, Herald, Architect, Skeptic, AE) scored five ideas. Meta creative factory, GEO and a closed-loop optimizer were rejected (no ad budget, results take weeks, no reply data in five hours). Dark TAM engine won, then the user added event triggers, which fit Needle and the trade-fair-list source the slides name. The Architect seat wanted bakeries; three seats rejected that (low contract value, poor decision-maker data).

**Pipeline.** Event page, company, domain, AI Ark check (keep misses), Impressum owner extraction, enrichment (Blitz, Lusha), email verification, personalized opener (OpenAI API), Needle LinkedIn touches (10-20), Streamlit funnel dashboard. Shared SQLite table, contract in schema.sql and src/ghostleads/db.py. Stages: scraped, deduped, enriched, verified, drafted, sent.

**Split.** Dev A (the user, agent Opus 5.5): backend, everything after `scraped`, plus the dashboard, branch `backend`. Dev B: scraping, event adapter, domain resolution, Impressum extraction, branch `scraping`. Marketer: event choice, message angles, offer and pricing, pitch. Agent prompts are in prompts/. Detail in docs/TASKS.md.

**Status at packing (about 13:30).** Repo was empty. Planning, docs, the data contract (db.py tested), env template and prompts are written. No scraper or backend code yet. Timeline: first end-to-end at 15:15, freeze 15:45, record 16:00, submit by 16:45.

**Decisions and constraints.** No bulk cold email to German recipients (UWG risk, and inboxes are not warmed); LinkedIn via Needle is the channel, email stays drafted and verified only. Real sends need the user's explicit OK on the exact messages. Public professional data only. Never state numbers the pipeline did not produce, no fake replies. Secrets stay in .env (gitignored). Sponsors: OpenAI Codex (50 USD) and API (30 USD) vouchers per person, Needle, AI Ark (30K credits), BlitzAPI, Lusha (150 credits), Faxxing (100 faxes per team, optional on-camera stunt), Zapmail and SCAILE (details TBD). Promo codes live in the organisers' Notion page and are not stored here.

**Gotchas.** AI Ark may lack a single-domain lookup; fall back to a bulk export and a local diff. Pre-test: check 20 leads against AI Ark first; if over half are already in it, switch niche. Needle only exposes data visible on LinkedIn (no email or phone). The kick-off slides PDF is image-only; its content matched the Notion page.

**Open items for the user.** Confirm the 12:30 team submission was done. Choose the event and verify its date. Redeem the OpenAI vouchers and sponsor credits, get AI Ark and Needle API access and docs from the sponsors on site, and rotate any key that was pasted into a chat. Approve exact Needle messages before any real send.
<!-- BRIEF:END -->

## Project instructions
**.claude/CLAUDE.md**
```markdown
# graphify
- **graphify** (`~/.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.
```

## Sessions (newest first)
### Hackathon team name
`a9091821` · 2026-10-31 12:21 → 2026-10-31 13:29 · 8 prompts · branch `HEAD`
**Goal:** give us a team name for a hackathon
**Requests:**
- [10-31 12:37] [pasted] GTM Hackathon Berlin - Halloween Edition Saturday, 31 October 2026 - hosted by Arvana & [GTMengineer.dev](https://gtmengineer.dev/?utm_source=luma) Ready to enter a new era of hackathons? Most startups don't fail at building product. They fail at tur…
- [10-31 12:55] @"C:\Users\rryou\Downloads\berlin-gtm-hackathon-slides-final_v1.pdf" [pasted] # 🚀 GTM Hackathon Berlin by Arvana & GTMengineer.dev Team submission (by 12:30): Submit your team · Video submission link: coming soon <aside> 📶 WIFI: ARVANA PW: [removed] </asid…
- [10-31 12:59] the idea should be helping arvana grow and also other sponsors so based on what you chose give me the idea and simply explain it and explain what we can and should work on
- [10-31 13:03] what about an idea where you find leads of people who lets say going to events and we use needle to connect them to those leads and reach out to them
- [10-31 13:16] ok we will work with the events idea, give us a name for the repo
- [10-31 13:22] i got 50$ credit for codex but these are the models we currently have is any of them good enough to do the backend
- [10-31 13:29] ok what i want you to do now is create a capsule file with everything about this project, i created a repo https://github.com/youssef-110/Ghost-Leads-.git me and another developer will be working on the backend part and the scraping part so seperate the tasks…
**Key commands:**
- `cd /c/Users/rryou/Downloads && python -I -c "`
- `cd ~ && git clone https://github.com/youssef-110/Ghost-Leads-.git 2>&1 | tail -3; ls -la ~/Ghost-Leads-; cd ~/Ghost-Leads- && git log --oneline | head -3; git…`
- `cd ~/Ghost-Leads- && python -I ~/.claude/skills/capsule/scripts/capsule.py export --session current --budget 10000 --out ./CAPSULE.md 2>&1 | tail -8; wc -c CAP…`
**Recent errors:**
- pdftoppm is not installed. Install poppler-utils (e.g. `brew install poppler` or `apt-get install poppler-utils`) to enable PDF page rendering.
**Task list (last state):**
- [~] Load capsule skill
- [ ] Clone repo, write capsule + task split
- [ ] Write agent prompts
- [ ] Commit and push to GitHub
**Last reply:** I don't recognize these model names, so I can't vouch for how well any of them codes. They're newer than what I know.

What I'd do:
- **Use 6 Luna.** It's the newest number and already selected, so it's the safest default. Keep Medium effort for most of the work and switch to High only for tricky parts, such as the Impressum parser or the AI Ark dedupe.
- **Test it in the first 15 minutes.** Ask it for the scraper plus a CSV export and run the result. If the output is clean, keep going. If it's buggy, try 5.6 Terra on the same task and compare.
- **Keep tasks small.** One module per prompt (scraper, dedupe, enrichment, Needle sender) uses less credit than one prompt for the whole backend. Don't let it loop on retries.
- **Don't spend the $50 on runtime calls.** The $30 OpenAI API credit covers the personalization prompts inside the pipeline, and the $50 Codex credit is for writing code. Redeem them separately, as the Toolbox describes.

Credit burn per model and effort level is something you'll only see in the usage meter, so check it after the first task.
