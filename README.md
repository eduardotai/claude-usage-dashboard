<div align="center">

# 🔥 AgentBurn

**What your AI coding agents burn — in tokens and API-equivalent dollars.**

A local-first, open-source dashboard for Claude Code (Codex CLI and Cursor next).
One command, a polished web UI, and honest numbers: every figure says whether it was
**measured**, **estimated** or is **unavailable**.

```bash
npx agentburn
```

![AgentBurn dashboard (synthetic demo data)](docs/preview.webp)

</div>

## Why

Terminal tools like [ccusage](https://github.com/ccusage/ccusage) and
[tokscale](https://github.com/junhoyeo/tokscale) are great. AgentBurn is for when you
want to *look* at your usage: a calm, fast web dashboard that opens with one command,
works across agents, and is explicit about where every number comes from.

- **One command.** `npx agentburn` scans your logs, starts a server on `localhost`, opens your browser.
- **Honest provenance.** Tokens are *measured* from your agent's logs. Cost is an
  *estimate* at public API prices. Models without a public price are flagged as
  *unavailable* and left out of the total — never silently counted as $0.
- **Correct counts.** Claude Code writes one API response as several log lines and copies
  messages into resumed sessions. AgentBurn de-duplicates them (see [How counting works](#how-counting-works)),
  which a naive line-by-line sum counts two or three times.
- **100% local.** Your logs never leave your machine. No accounts, no telemetry.

## Features

- Total tokens with input / output / cache write / cache read breakdown
- Estimated API-equivalent cost, with the share of tokens that could be priced
- 7D / 30D / 90D / All ranges, filter by agent and by project (click a project to drill down)
- Daily burn chart (tokens or cost), model split, top projects, a year-long activity heatmap
- Subagent (sidechain) calls included and labelled
- Refresh re-scans logs without restarting

## Install & run

Requires Node.js 20+.

> **Pre-release:** the package is not on npm yet. Until it is, run it from source:
> `git clone … && npm install && npm run build && node dist/server/cli.js`
> (or `npm pack` and `npx ./agentburn-0.1.0.tgz`).

```bash
npx agentburn                # scan, serve on http://localhost:4317, open the browser
npx agentburn --no-open      # don't open the browser
npx agentburn --offline      # never download prices (uses cache or the bundled table)
npx agentburn --port 8080    # pick a port (falls back to the next free one)
npx agentburn --claude-dir ~/backup/claude/projects
```

Or install globally: `npm i -g agentburn && agentburn`.

| Option / env | What it does |
| --- | --- |
| `-p, --port` / `PORT` | Port (default `4317`) |
| `--host` | Interface to bind (default `127.0.0.1`, loopback only) |
| `--no-open` | Don't open a browser |
| `--offline` / `AGENTBURN_OFFLINE=1` | Skip the price download |
| `--claude-dir` / `CLAUDE_LOGS_DIR` | Claude Code log root(s), comma-separated |
| `CLAUDE_CONFIG_DIR` | Claude Code config dir(s); `<dir>/projects` is scanned |
| `AGENTBURN_CACHE_DIR` | Where the price table is cached |

## Where the data comes from

| Agent | Status | Data read |
| --- | --- | --- |
| Claude Code | ✅ supported | `~/.claude/projects/**/*.jsonl` and `~/.config/claude/projects/**/*.jsonl` (incl. `subagents/`) |
| Codex CLI | 🛠 next | `~/.codex/sessions/**/*.jsonl` |
| Cursor | 🛠 next | Cursor's local state / usage export (tokens are often missing — will show as *unavailable*) |
| Gemini CLI | 🗺 later | — |

AgentBurn only **reads** these files. It never writes to them.

## Privacy

- Everything runs on your machine. The server binds to `127.0.0.1` and rejects requests
  whose `Host` isn't localhost (protection against DNS rebinding).
- The UI makes no third-party requests (fonts are bundled).
- The **only** network request is a plain `GET` of LiteLLM's public price table
  ([`model_prices_and_context_window.json`](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)),
  at most once a day, cached in `~/.cache/agentburn`. Nothing about you is sent.
  Use `--offline` to skip it.

## About the cost figures

> **Cost is an API-equivalent estimate, not your bill.**

If you're on a subscription (Claude Pro/Max, ChatGPT Plus/Pro, Cursor plans), you don't
pay per token. AgentBurn shows what the same tokens would cost at public API list prices,
for perspective. Details:

- Prices come from LiteLLM. Resolution order: fresh disk cache (<24h) → live download →
  stale cache → the snapshot bundled in the package. The footer shows which one is in use.
- Input, output, cache read, 5-minute and 1-hour cache writes are priced separately;
  long-context tiers (`>200k` prompt tokens) apply when LiteLLM lists them.
- Model ids are matched exactly, after stripping provider prefixes, dated snapshot
  suffixes and `[1m]`-style variants. There is no fuzzy "it says opus, use opus pricing"
  guessing: unknown models are reported as unpriced.
- Batch, priority and regional pricing, web search fees and discounts are not modelled.

## How counting works

**Claude Code**

- Only `assistant` entries with a `message.usage` block count. Each is one model call.
- **Split entries:** one API response is logged as several lines (thinking, text, tool use),
  each repeating the same `message.id`, `requestId` and usage. AgentBurn de-duplicates on
  `message.id + requestId`, keeping the most complete entry (largest output count).
- **Resumed sessions** copy earlier messages into a new file; the same global de-duplication
  counts them once (attributed to the session where they first appeared).
- **Subagents / sidechains** (Task tool) are real, separately billed API calls whose usage
  is *not* contained in the parent's entries, so they **are counted**, attributed to the
  parent session and project, and labelled as subagent calls. If a subagent call shows up
  both inline and in a `subagents/` file it is counted once.
- Entries missing `message.id` or `requestId` can't be de-duplicated and are kept as is.
  Zero-token entries (e.g. `<synthetic>` placeholders) are ignored.
- Days are bucketed in your local timezone. The project is the last segment of the
  session's working directory.

## API

The same server exposes a small JSON API (all `GET` except refresh). Every stats endpoint
accepts `start`, `end` (`yyyy-mm-dd`), `project` and `agent` (e.g. `claude-code`).

| Endpoint | Returns |
| --- | --- |
| `/api/health` | status + version |
| `/api/meta` | version, pricing source, agents with data paths and scan stats |
| `/api/agents` | agents (incl. planned) with usage in the current filter |
| `/api/stats/summary` | totals, breakdown, `estimated_cost`, `cost_coverage`, `unpriced_models`, `provenance` |
| `/api/stats/daily` | per-day tokens and cost (`days=N` for a trailing window) |
| `/api/stats/models` · `/projects` · `/agents` | grouped tokens, calls, cost (`null` when unpriced) |
| `/api/stats/heatmap` | trailing-year daily cells (`days=30..730`) |
| `POST /api/refresh` | re-scan logs from disk |

## Develop

```bash
git clone https://github.com/eduardotai/claude-usage-dashboard agentburn && cd agentburn
npm install
npm run demo:logs                               # synthetic logs in ./sample-logs
npm run dev -- --claude-dir ./sample-logs       # API :4317 (reload) + UI :5173 (HMR)
npm test                                        # vitest: parser, dedupe, pricing, API
npm run check                                   # tsc + svelte-check
npm run build && node dist/server/cli.js        # production build, as npx runs it
```

Layout: `src/adapters/*` (one per agent → normalized records), `src/pricing/` (LiteLLM),
`src/core/stats.ts` (aggregations), `src/server.ts` + `src/cli.ts` (zero-dependency
server and bin), `frontend/` (SvelteKit + Tailwind + Chart.js, built as a static SPA).
`npm run pricing:snapshot` refreshes the bundled offline price table.

Adding an agent: implement the `Adapter` interface in `src/adapters/<agent>.ts`, register it
in `src/adapters/index.ts`, and add fixtures that reproduce the agent's real log quirks.

## Roadmap

- [x] TypeScript rewrite, one-command `npx agentburn`, zero runtime dependencies
- [x] Claude Code adapter with de-duplication and subagent policy
- [x] LiteLLM pricing with cache + offline fallback; unknown models flagged
- [ ] Codex CLI adapter
- [ ] Cursor adapter (with *unavailable* tokens made explicit)
- [ ] Sessions view and per-session drill-down
- [ ] Export (CSV / JSON) and a `--json` CLI summary
- [ ] Gemini CLI adapter
- [ ] Optional sync across machines and team views (hosted, opt-in)

## License

[MIT](LICENSE) © eduardotai. AgentBurn is not affiliated with Anthropic, OpenAI, Cursor or Google.
