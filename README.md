# Ghost Leads

GTM Hackathon Berlin (31 Oct 2026). Finds companies at trade fairs that no lead database knows, enriches the owner, and starts the conversation on LinkedIn through Needle.

Start with `CAPSULE.md`, then `docs/PLAN.md` and `docs/TASKS.md`. Agent prompts are in `prompts/`.

```
pip install -r requirements.txt
pip install -e .
cp .env.example .env   # fill in keys, never commit
```

If an event directory needs JavaScript rendering, install Playwright's browser once:

```
python -m playwright install chromium
```

Run the event scraper with:

```
python -m ghostleads.scraping run --event-url <url> --event-name <name>
```
