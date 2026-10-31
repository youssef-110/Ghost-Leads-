# Ghost Leads website

Public deployment: https://ghost-leads-operator-demo.vercel.app/

This Vite/React frontend serves a product website (`/`) and a read-only, interactive walkthrough (`/app`). Neither route connects to the Python/SQLite workbench or Needle, creates drafts, or sends outreach. The sample cards are fictional UI illustrations. The reported Web Summit figures are a dated local snapshot, not live provider state; local draft references do not verify a Needle queue. The database-backed dashboard remains the local Streamlit app described in the [repository README](../README.md).

## Develop and check

```bash
npm ci
npm run dev
npm run lint
node --test tests/*.test.mjs
npm run build
```

## Deploy

The linked Vercel project builds this `web/` directory with `npm run build`; `vercel.json` serves `dist` and rewrites client-side routes to `index.html`. After reviewing the built assets for secrets, deploy from this directory with `vercel deploy --prod --yes --scope hex8`. Never put provider credentials in Vite public environment variables or client-side source.

