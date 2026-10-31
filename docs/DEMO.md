# Local demo runbook

This is an operator-led demonstration, not a simulated outbound campaign. Start in the repository root. Keep `.env` and `data/` local; neither belongs in a slide deck, screen share of secrets, or GitHub commit.

## Preparation

1. Install dependencies and launch Streamlit using [README.md](../README.md). Open the local URL printed in the terminal. If the local database is absent, use the dashboard's setup guidance; do not claim the empty state is a live dataset.
2. Confirm the event card (`events/web-summit-2026.json`) and sender copy (`outreach.json`) are correct for this audience. The IT.CON 2026 exhibitor guide is available for discovery, but that event took place in September 2026; do not use it as a future meeting ask.
3. Use a real, authorized local database to show the funnel. The dashboard reads SQLite, and only rows outside the `SEED` event are real KPIs. Source URLs and enrichment provenance should be inspectable. If a card has no source evidence, explain that limitation rather than inventing it.
4. For a demo without provider access, show the persisted workflow and local statuses. A populated key is only a configuration signal, not proof of provider connectivity.

## Walkthrough

1. **Overview:** Explain the stage funnel and the difference between known AI Ark matches, unchecked leads, and potential ghosts. A ghost requires a real negative AI Ark check; an unchecked record is not a ghost.
2. **Pipeline / automation:** Show the ordered dedupe → enrich → verify → draft workflow and its status. Trigger only a deliberate, safe pre-send run if keys and quotas permit. If the provider is unavailable, show the blocked state honestly. Nothing runs a paid API call merely because someone opened the dashboard.
3. **Leads:** Filter by event and stage. Inspect one record's company, profile, source URL, contact provenance, and drafted note. Blank fields remain blank; a scraped owner is not automatically a verified contact.
4. **Outreach:** Show a drafted message and whether it has a Needle draft reference. A draft queued in Needle is not a sent invitation. Review the exact note and recipient there before approving it; do not approve or directly send a live message during the demo unless the team has explicitly authorized those exact recipients and text.
5. **Events and replies:** Show event metadata, inbound sync/status, and the manual gate for booking an agreed meeting slot. Never interpret a classifier's `interested` label as confirmation of a specific time.
6. **Health / setup:** Explain which local components are ready, which API keys are configured, and what still needs external provider verification. Refresh the UI and confirm counts persist in the local database.

## CLI safety net

```bash
python -m pytest -q
python -m ghostleads.backend run --stage send       # preview only
python -m ghostleads.backend run --all              # pipeline; send remains a dry run
```

The application does not ship the local lead database. A fresh GitHub checkout must ingest an authorized source before it can show real-event KPIs. The `seed` command creates rows labelled `SEED` only; these are not evidence of customers or meetings. If a source is blocked, use another legitimate source or report the limitation instead of fabricating exhibitors.
