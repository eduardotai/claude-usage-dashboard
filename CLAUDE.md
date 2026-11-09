# CLAUDE.md — working on AgentBurn

AgentBurn is a local-first, open-source (MIT) dashboard of token usage and
**API-equivalent** cost across AI coding agents. One command (`npx agentburn`)
starts a localhost server that serves both the JSON API and the built UI.

## Principles

1. **Honest numbers.** Every figure carries provenance: `measured` (read from the
   agent's logs), `estimated` (computed by us, e.g. cost) or `unavailable`.
   Never silently turn "unknown" into 0 — unknown models get `cost: null` and are
   listed as unpriced. Cost is always "API-equivalent", never "your bill".
2. **Local & private.** Logs never leave the machine. No telemetry. The only
   network request allowed is the LiteLLM price-table download, which must keep
   working offline (`--offline`, disk cache, bundled snapshot).
3. **Polish.** The UI is the product. Keep the dark "Observatory" design tokens
   in `frontend/src/app.css`; no third-party requests from the UI (fonts are bundled).
4. **Zero runtime deps.** The published package depends on nothing at runtime
   (node:http, node:fs). UI deps are bundled at build time.

## Layout

- `src/cli.ts` — `agentburn` bin (args, port fallback, open browser)
- `src/server.ts` — node:http server: `/api/*` + static SPA from `dist/ui`
- `src/adapters/*` — one file per agent, each returns normalized `RawUsageRecord`s
  (`src/core/types.ts`). Add an agent = add an adapter + register it in `adapters/index.ts`.
- `src/pricing/litellm.ts` — LiteLLM price table loading + cost math
- `src/core/stats.ts` — pure aggregations (the API's JSON shapes)
- `frontend/` — SvelteKit (adapter-static) + Tailwind 4 + Chart.js
- `test/` — vitest, synthetic fixtures in `test/fixtures/`

## Workflow

- `npm run dev` (API on 4317 with reload + Vite on 5173), `npm test`, `npm run check`, `npm run build`
- New adapter: write fixtures that reproduce the agent's real quirks (duplicates,
  resumed sessions, subagents) and test dedupe before wiring the UI.
- Keep API responses flat and snake_case; mirror changes in `frontend/src/lib/types.ts`.
- `docs/legacy/` holds the original PRD/specs from the Python version, for history only.
