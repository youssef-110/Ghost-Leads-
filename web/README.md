# Ghost Leads web

The hosted product: a Vite + React 19 + TypeScript site (`src/`), Vercel Node functions (`api/`) and the engine they use
(`server/`). The request/response contract is `shared/types.ts`.

For what the product does, the architecture and the limits, see the [repository README](../README.md),
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) and [docs/SELF_HOSTING.md](../docs/SELF_HOSTING.md).

## Develop

```bash
npm ci
vercel dev        # site + /api functions (needs the Vercel CLI)
npm run dev       # UI only; /api calls fail and the app says the lead engine is unavailable
```

Routes: `/`, `/pricing`, `/bot`, `/login`, `/signup`, and the signed-in app under `/app` (Overview, Find leads, Lists,
Scraper, Event signals, Settings).

## Test

```bash
npm run lint
npx tsc -p tsconfig.api.json                                            # type-check api/, server/, shared/
npm test                                                                # unit tests
```

`npm run build` type-checks `src/` only, so run the `tsconfig.api.json` check when you change `api/` or `server/`.

## Build

```bash
npm run build     # tsc -b && vite build, output in dist/
npm run preview   # serve the built site locally (no functions)
```

## Deploy

Apply `../supabase/migrations/20261115_lead_engine.sql` to the Supabase project first, then:

```bash
vercel deploy --prod
```

`vercel.json` serves `dist` and rewrites client-side routes to `index.html`; `api/*.ts` become Node functions.

## Environment

All optional for the hosted project. Set them in the Vercel project, or in `.env.local` here for `vercel dev`.

| Variable | Read by | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | functions | Drafting, AI extraction, AI fallback for directory pages |
| `SERPER_API_KEY` | functions | Web search source |
| `OVERPASS_URL` | functions | Overpass server for the local-business source |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | functions | Your own Supabase project for `gl_use` |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` | browser (build time) | Your own Supabase project for the client |

Set the two Supabase pairs together or not at all. Provider keys belong in function environment variables only: a
`VITE_*` variable is compiled into the public bundle.
