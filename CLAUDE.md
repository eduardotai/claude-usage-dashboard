# CLAUDE.md — working on Burnboard

Burnboard is a local-first, open-source (MIT) dashboard of token usage and
**API-equivalent** cost across AI coding agents. One command (`npx burnboard`)
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

- `src/cli.ts` — `burnboard` bin (args, port fallback, open browser)
- `src/server.ts` — node:http server: `/api/*` + static SPA from `dist/ui`
- `src/adapters/*` — one file per agent, each returns normalized `RawUsageRecord`s
  (`src/core/types.ts`). Add an agent = add an adapter + register it in `adapters/index.ts`.
- `src/pricing/litellm.ts` — LiteLLM price table loading + cost math
- `src/core/stats.ts` — pure aggregations (the API's JSON shapes)
- `frontend/` — SvelteKit (adapter-static) + Tailwind 4 + Chart.js
- `test/` — vitest, synthetic fixtures in `test/fixtures/`

## Workflow

- `npm run dev` (API on 4317 with reload + Vite on 5173), `npm test`, `npm run check`, `npm run build`
- New adapter: research the real on-disk format first and cite sources in the adapter's
  header comment. Never invent a format: if there's no verified local source, register the
  agent as `planned` with a `note` saying what's missing (see Grok Bot in `adapters/index.ts`).
- Write fixtures that reproduce the agent's real quirks (duplicates, running totals,
  resumed/forked sessions, subagents). Fixture builders live next to the fixtures
  (`test/fixtures/build-*-fixtures.mjs`). Tests must not read the real home dir:
  use `fixturesEnv()` from `test/helpers.ts`.
- Records with no token data get `tokens: 'unavailable'` (they count as `calls`, never as 0
  tokens). A cost the agent recorded itself goes in `reportedCostUsd` (cost `measured`).
  Agent-specific model ids map to LiteLLM ids via `pricingModel`, by exact rules only.
- Billing exports (grok.com usage CSV) contain the user's email and account id: never read
  those columns into records, never commit a real export, and build fixtures from synthetic
  rows only. Charged amounts go in `billedUsd` (shown as "Billed", measured), never mixed
  into the API-equivalent estimate.
- Optional Node features (`node:sqlite`, zstd) must degrade with a warning on Node 20, and
  their tests use `it.runIf`.
- Keep API responses flat and snake_case; mirror changes in `frontend/src/lib/types.ts`.
- `docs/legacy/` holds the original PRD/specs from the Python version, for history only.
