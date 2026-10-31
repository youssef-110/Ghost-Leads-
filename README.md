# Ghost Leads

GTM Hackathon Berlin (31 Oct 2026). Finds companies at trade fairs that no lead database knows, enriches the owner, and starts the conversation on LinkedIn through Needle.

Start with `CAPSULE.md`, then `docs/PLAN.md` and `docs/TASKS.md`. Agent prompts are in `prompts/`.

```
pip install -r requirements.txt
pip install -e .
cp .env.example .env   # fill in keys, never commit
```

Run the event scraper with:

```
python -m ghostleads.scraping run --event-url <url> --event-name <name>
```

## Backend pipeline (branch `backend`)

```
python -m ghostleads.backend run --all                 # dedupe, enrich, verify, draft, send (dry run)
python -m ghostleads.backend run --stage draft         # one step: dedupe | enrich | verify | draft | send
python -m ghostleads.backend attendees search events/web-summit-2026.json   # LinkedIn attendees via Needle
python -m ghostleads.backend attendees promote events/web-summit-2026.json  # kept attendees -> leads
python -m ghostleads.backend run --stage send --draft  # queue notes in Needle; nothing sends until approved there
python -m ghostleads.backend run --stage send sync     # pull approved/sent status back from Needle
streamlit run app/dashboard.py
```

Event cards live in `events/`. Sender name and offer for the notes live in `outreach.json` (marketer edits it).
Keys in `.env`: OPENAI_API_KEY, AIARK_API_KEY, BLITZ_API_KEY, NEEDLE_API_KEY. Lusha is replaced by Blitz + AI Ark.
