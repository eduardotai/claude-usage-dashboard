#!/usr/bin/env node
/**
 * Generate synthetic multi-agent logs for demos and screenshots.
 *
 * Writes the same shapes the real adapters read, including the quirks they must handle:
 *   claude/        Claude Code: split assistant entries sharing message.id + requestId, subagents
 *   codex/         Codex CLI: cumulative token_count events, re-emitted snapshots
 *   grok/          Grok Build: turn_completed updates with per-model usage and recorded cost
 *   cursor/        Cursor usage CSV export (latest header)
 *   cursor-user/   Cursor local state.vscdb with best-effort (mostly zero) token counts
 *                  (only when this Node has node:sqlite)
 *   grok/export/   grok.com unified usage export: Grok Bot + Grok apps, a few on-demand charges
 *                  (fake email / principal id)
 * Fictional projects only.
 *
 *   node scripts/generate-demo-logs.mjs --out ./sample-logs
 *   (then run the command it prints)
 *
 * Nothing here touches your real agent logs.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
	options: {
		out: { type: 'string', default: './sample-logs' },
		days: { type: 'string', default: '150' },
		seed: { type: 'string', default: '7' }
	}
});
const out = resolve(values.out);
const DAYS = Number(values.days);

// Small deterministic PRNG (mulberry32) so screenshots are reproducible.
let s = Number(values.seed) >>> 0;
const rand = () => {
	s = (s + 0x6d2b79f5) >>> 0;
	let t = s;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (pairs) => {
	const total = pairs.reduce((x, [, w]) => x + w, 0);
	let r = rand() * total;
	for (const [v, w] of pairs) if ((r -= w) <= 0) return v;
	return pairs[pairs.length - 1][0];
};
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => ((c === 'x' ? int(0, 15) : int(8, 11)).toString(16)));

const PROJECTS = [
	['acme-storefront', 5.0],
	['ml-pipeline', 3.4],
	['design-system', 2.1],
	['api-gateway', 1.7],
	['docs-site', 1.2],
	['mobile-app', 1.0],
	['infra-scripts', 0.6],
	['playground', 0.35]
];
const MODELS = [
	['claude-opus-4-8', 0.62],
	['claude-sonnet-4-6', 0.24],
	['claude-haiku-4-5-20251001', 0.1],
	['claude-opus-4-7', 0.03],
	['local-qwen-coder', 0.01] // via a custom base URL: has no public price -> flagged, not $0
];

function usage(base) {
	const cw = int(0, 4000) * base;
	const oneHour = rand() < 0.3 ? Math.floor(cw * 0.5) : 0;
	return {
		input_tokens: int(4, 900) * base,
		output_tokens: int(150, 2600) * base,
		cache_creation_input_tokens: cw,
		cache_read_input_tokens: int(4000, 50000) * base,
		cache_creation: { ephemeral_5m_input_tokens: cw - oneHour, ephemeral_1h_input_tokens: oneHour }
	};
}

function assistantLines(ts, project, sessionId, sidechain, model) {
	const u = usage(int(1, 6));
	const id = `msg_${uuid().replace(/-/g, '').slice(0, 24)}`;
	const requestId = `req_${uuid().replace(/-/g, '').slice(0, 24)}`;
	// Claude Code writes one line per content block, repeating id + usage.
	const blocks = pick([[['text'], 0.5], [['thinking', 'text'], 0.3], [['thinking', 'text', 'tool_use'], 0.2]]);
	return blocks.map((type, i) => ({
		parentUuid: null,
		isSidechain: sidechain,
		type: 'assistant',
		timestamp: new Date(ts + i * 350).toISOString(),
		cwd: `/home/demo/projects/${project}`,
		sessionId,
		requestId,
		message: { id, model, role: 'assistant', content: [{ type }], usage: u }
	}));
}

rmSync(out, { recursive: true, force: true });
const now = Date.now();
let calls = 0;
let lines = 0;
for (const [project, weight] of PROJECTS) {
	const dir = join(out, 'claude', `-home-demo-projects-${project}`);
	mkdirSync(dir, { recursive: true });
	const sessions = Math.max(3, Math.round(weight * 6));
	for (let i = 0; i < sessions; i++) {
		const sessionId = uuid();
		// Recent days are busier (adoption curve).
		const dayOffset = Math.floor(Math.pow(rand(), 1.6) * DAYS);
		const day = new Date(now - dayOffset * 86_400_000);
		day.setHours(int(8, 20), int(0, 59), 0, 0);
		let t = Math.min(day.getTime(), now - 60_000);
		const n = Math.max(3, Math.round(18 * weight * (0.5 + rand())));
		const main = [];
		const sub = [];
		for (let k = 0; k < n; k++) {
			t += int(20, 400) * 1000;
			const model = pick(MODELS);
			main.push({ type: 'user', timestamp: new Date(t - 5000).toISOString(), cwd: `/home/demo/projects/${project}`, sessionId, message: { role: 'user', content: 'demo' } });
			main.push(...assistantLines(t, project, sessionId, false, model));
			calls++;
			if (rand() < 0.12) {
				sub.push(...assistantLines(t + 1000, project, sessionId, true, 'claude-haiku-4-5-20251001'));
				calls++;
			}
		}
		const write = (p, rows) => {
			writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
			lines += rows.length;
		};
		write(join(dir, `${sessionId}.jsonl`), main);
		if (sub.length) {
			mkdirSync(join(dir, sessionId, 'subagents'), { recursive: true });
			write(join(dir, sessionId, 'subagents', `agent-${uuid().slice(0, 8)}.jsonl`), sub);
		}
	}
}
const claudeCalls = calls;

// ---------------------------------------------------------------------------
// Codex CLI rollouts: cumulative totals; cached input is inside input_tokens.
let codexCalls = 0;
const CODEX_PROJECTS = [['api-gateway', 3], ['ml-pipeline', 2], ['infra-scripts', 1.2], ['playground', 0.6]];
const CODEX_MODELS = [['gpt-5.5', 0.55], ['gpt-5.3-codex', 0.35], ['gpt-5.4-mini', 0.1]];
for (const [project, weight] of CODEX_PROJECTS) {
	for (let i = 0; i < Math.round(weight * 14); i++) {
		const id = uuid();
		const dayOffset = Math.floor(Math.pow(rand(), 1.3) * Math.min(DAYS, 75));
		const start = new Date(now - dayOffset * 86_400_000);
		start.setHours(int(9, 21), int(0, 59), 0, 0);
		let t = Math.min(start.getTime(), now - 3_600_000);
		const iso = (ms) => new Date(ms).toISOString();
		const cwd = `/home/demo/projects/${project}`;
		const model = pick(CODEX_MODELS);
		const rows = [
			{ timestamp: iso(t), type: 'session_meta', payload: { id, timestamp: iso(t), cwd, originator: 'codex_cli_rs', cli_version: '0.131.0', source: 'cli', model_provider: 'openai' } },
			{ timestamp: iso(t + 50), type: 'turn_context', payload: { cwd, model, approval_policy: 'on-request', effort: 'medium' } }
		];
		const total = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 };
		const turns = int(3, Math.round(10 * weight));
		for (let k = 0; k < turns; k++) {
			t += int(30, 300) * 1000;
			const input = int(20, 150) * 1000;
			const cached = Math.floor(input * (0.55 + rand() * 0.35));
			const output = int(200, 4000);
			const reasoning = Math.floor(output * rand() * 0.6);
			const last = { input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output };
			for (const f of Object.keys(total)) total[f] += last[f];
			const info = { total_token_usage: { ...total }, last_token_usage: last, model_context_window: 272000 };
			rows.push({ timestamp: iso(t), type: 'event_msg', payload: { type: 'token_count', info, rate_limits: null } });
			codexCalls++;
			// Codex re-emits the same snapshot; the adapter must not double count it.
			if (rand() < 0.4) rows.push({ timestamp: iso(t + 200), type: 'event_msg', payload: { type: 'token_count', info, rate_limits: null } });
		}
		const d = new Date(start);
		const dir = join(out, 'codex', 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, `rollout-${iso(start.getTime()).slice(0, 19).replace(/:/g, '-')}-${id}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
	}
}

// ---------------------------------------------------------------------------
// Grok Build sessions: turn_completed with per-model usage and recorded cost (1e-10 USD ticks).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = JSON.parse(readFileSync(join(ROOT, 'pricing', 'litellm-snapshot.json'), 'utf8'));
const table = snapshot.models ?? snapshot;
const ticks = (key, u) => {
	const p = table[key];
	if (!p) return undefined;
	const usd = (u.inputTokens - u.cachedReadTokens) * (p.input_cost_per_token ?? 0) + u.cachedReadTokens * (p.cache_read_input_token_cost ?? p.input_cost_per_token ?? 0) + u.outputTokens * (p.output_cost_per_token ?? 0);
	return Math.round(usd * 1e10);
};
let grokCalls = 0;
const GROK_PROJECTS = [['design-system', 2], ['docs-site', 1.4], ['acme-storefront', 1]];
for (const [project, weight] of GROK_PROJECTS) {
	for (let i = 0; i < Math.round(weight * 10); i++) {
		const sessionId = uuid();
		const dayOffset = Math.floor(Math.pow(rand(), 1.1) * Math.min(DAYS, 40));
		const start = new Date(now - dayOffset * 86_400_000);
		start.setHours(int(10, 22), int(0, 59), 0, 0);
		let t = Math.min(start.getTime(), now - 3_600_000);
		const rows = [];
		for (let k = 0; k < int(2, Math.round(8 * weight)); k++) {
			t += int(40, 400) * 1000;
			const mk = (lo, hi) => {
				const inputTokens = int(lo, hi) * 1000;
				const cachedReadTokens = Math.floor(inputTokens * (0.5 + rand() * 0.4));
				const outputTokens = int(300, 3500);
				return { inputTokens, cachedReadTokens, outputTokens, reasoningTokens: Math.floor(outputTokens * 0.4), totalTokens: inputTokens + outputTokens };
			};
			const modelUsage = {};
			const main = { ...mk(40, 200), modelCalls: int(1, 5) };
			main.costUsdTicks = ticks('xai/grok-4.5', main);
			modelUsage['grok-4.5-build'] = main;
			if (rand() < 0.35) {
				const fast = { ...mk(2, 12), modelCalls: 1 };
				fast.costUsdTicks = ticks('xai/grok-code-fast-1', fast);
				modelUsage['grok-code-fast-1'] = fast;
			}
			const vals = Object.values(modelUsage);
			const sum = (f) => vals.reduce((a, v) => a + (v[f] ?? 0), 0);
			const usage = { inputTokens: sum('inputTokens'), cachedReadTokens: sum('cachedReadTokens'), outputTokens: sum('outputTokens'), reasoningTokens: sum('reasoningTokens'), totalTokens: sum('totalTokens'), modelCalls: sum('modelCalls'), costUsdTicks: sum('costUsdTicks'), modelUsage };
			grokCalls += usage.modelCalls;
			rows.push({ timestamp: Math.floor(t / 1000), method: '_x.ai/session/update', params: { sessionId, update: { sessionUpdate: 'turn_completed', stopReason: 'end_turn', usage }, _meta: { eventId: `evt-${k + 1}`, agentTimestampMs: t } } });
		}
		const cwd = `/home/demo/projects/${project}`;
		const dir = join(out, 'grok', 'sessions', encodeURIComponent(cwd), sessionId);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'updates.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
		writeFileSync(join(dir, 'summary.json'), JSON.stringify({ info: { id: sessionId, cwd }, current_model_id: 'grok-4.5-build' }));
	}
}

// ---------------------------------------------------------------------------
// Cursor usage CSV export (latest header) for the last ~30 days.
const CURSOR_MODELS = [['claude-4.5-sonnet-thinking', 0.4], ['cursor-grok-4.6-xhigh-fast', 0.25], ['gpt-5.5', 0.2], ['composer-2.5-fast', 0.15]];
const csv = ['Date,User,Cloud Agent ID,Automation ID,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost'];
let cursorCalls = 0;
const csvDays = Math.min(DAYS, 30);
for (let d = 0; d < csvDays; d++) {
	if (rand() < 0.3) continue; // not every day
	for (let k = 0; k < int(10, 40); k++) {
		const ts = new Date(now - d * 86_400_000);
		ts.setHours(int(9, 20), int(0, 59), int(0, 59), int(0, 999));
		if (ts.getTime() > now) continue;
		const model = pick(CURSOR_MODELS);
		const errored = rand() < 0.04;
		const cw = errored ? 0 : int(0, 6000);
		const inp = errored ? 0 : int(500, 9000);
		const cr = errored ? 0 : int(20000, 250000);
		const outp = errored ? 0 : int(200, 3500);
		csv.push([ts.toISOString(), 'demo@example.com', '', '', errored ? '"Errored, Not Charged"' : 'Included', model, 'No', cw, inp, cr, outp, cw + inp + cr + outp, errored ? '$0.00' : 'Included'].join(','));
		cursorCalls++;
	}
}
mkdirSync(join(out, 'cursor'), { recursive: true });
writeFileSync(join(out, 'cursor', 'usage-events-demo.csv'), csv.join('\n') + '\n');

// Cursor local DB: older requests (before the CSV), tokens mostly 0/0 as in real installs.
let dbRequests = 0;
let sqlite = null;
try {
	sqlite = createRequire(import.meta.url)('node:sqlite');
} catch {
	/* Node < 22.5: skip the DB part of the demo */
}
if (sqlite) {
	const userDir = join(out, 'cursor-user');
	mkdirSync(join(userDir, 'globalStorage'), { recursive: true });
	const db = new sqlite.DatabaseSync(join(userDir, 'globalStorage', 'state.vscdb'));
	db.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB); CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);');
	const put = db.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)');
	const byProject = new Map();
	for (let c = 0; c < 10; c++) {
		const composerId = uuid();
		const project = pick([['mobile-app', 2], ['acme-storefront', 1]]);
		byProject.set(project, [...(byProject.get(project) ?? []), composerId]);
		const created = now - (csvDays + int(1, 25)) * 86_400_000;
		const headers = [];
		let t = created;
		for (let k = 0; k < int(2, 7); k++) {
			t += int(60, 900) * 1000;
			const u = uuid();
			const a = uuid();
			headers.push({ bubbleId: u, type: 1 }, { bubbleId: a, type: 2 });
			const measured = rand() < 0.08;
			put.run(`bubbleId:${composerId}:${u}`, JSON.stringify({ type: 1, text: 'demo', createdAt: new Date(t).toISOString(), tokenCount: { inputTokens: 0, outputTokens: 0 } }));
			put.run(`bubbleId:${composerId}:${a}`, JSON.stringify({ type: 2, text: 'ok', tokenCount: measured ? { inputTokens: int(2000, 20000), outputTokens: int(100, 2000) } : { inputTokens: 0, outputTokens: 0 } }));
			dbRequests++;
		}
		put.run(`composerData:${composerId}`, JSON.stringify({ composerId, createdAt: created, modelConfig: { modelName: pick([['claude-4.5-sonnet', 1], ['default', 1]]) }, fullConversationHeadersOnly: headers }));
	}
	db.close();
	let n = 0;
	for (const [project, ids] of byProject) {
		const ws = join(userDir, 'workspaceStorage', `demo${n++}`);
		mkdirSync(ws, { recursive: true });
		writeFileSync(join(ws, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(`/home/demo/projects/${project}`).href }));
		const wdb = new sqlite.DatabaseSync(join(ws, 'state.vscdb'));
		wdb.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);');
		wdb.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run('composer.composerData', JSON.stringify({ allComposers: ids.map((composerId) => ({ composerId })) }));
		wdb.close();
	}
}

// ---------------------------------------------------------------------------
// grok.com unified usage export (X Subscription). Token buckets are disjoint; on-demand rows
// are charged at xAI's grok-4.7 list price, like real exports.
const gp = table['xai/grok-4.7'] ?? { input_cost_per_token: 2e-6, output_cost_per_token: 6e-6, cache_read_input_token_cost: 5e-7 };
const gq = (s) => '"' + s.replace(/"/g, '""') + '"';
const gHeader = 'Billing Item ID,Event Time,Product,Charge Category,Usage Type,Principal Type,Principal ID,Usage,Pricing Currency,Pricing Contracted,Model,User Email';
const gRows = [gHeader];
let grokBotRows = 0;
let onDemand = 0;
const PRINCIPAL = '00000000-0000-4000-8000-000000000000';
for (let d = 0; d < Math.min(DAYS, 21); d++) {
	if (rand() < 0.2) continue;
	for (let k = 0; k < int(8, 30); k++) {
		const ts = new Date(now - d * 86_400_000);
		ts.setHours(int(7, 23), int(0, 59), int(0, 59), int(0, 999));
		if (ts.getTime() > now) continue;
		const prompt = rand() < 0.7 ? int(2, 200) : int(500, 6000);
		const cached = int(20, 190) * 1000;
		const write = int(0, 4000);
		const completion = int(80, 2500);
		const charged = d < 3 && rand() < 0.08;
		const cost = charged ? prompt * gp.input_cost_per_token + cached * gp.cache_read_input_token_cost + write * gp.input_cost_per_token + completion * gp.output_cost_per_token : 0;
		const usage = JSON.stringify({ 'cache-write-text-tokens': String(write), 'cached-prompt-text-tokens': String(cached), 'completion-text-tokens': String(completion), 'prompt-text-tokens': String(prompt) });
		gRows.push([uuid(), ts.toISOString(), 'grok-bot', 'usage', charged ? 'on_demand' : 'included', 'user', PRINCIPAL, gq(usage), 'USD', cost.toFixed(10), '', 'demo@example.com'].join(','));
		grokBotRows++;
		if (charged) onDemand++;
	}
	if (rand() < 0.3) {
		const ts = new Date(now - d * 86_400_000);
		ts.setHours(int(8, 22), int(0, 59), 0, 0);
		if (ts.getTime() <= now) {
			const chat = rand() < 0.6;
			const usage = chat
				? JSON.stringify({ 'Cached prompt text tokens': String(int(0, 4000)), 'Completion text tokens': String(int(100, 1500)), 'Prompt text tokens': String(int(200, 3000)) })
				: JSON.stringify({ 'Audio seconds': String(int(10, 90)) });
			gRows.push([uuid(), ts.toISOString(), chat ? 'grok-chat' : 'grok-voice', 'usage', 'included', 'user', PRINCIPAL, gq(usage), 'USD', (0).toFixed(10), chat ? 'grok-4.7' : '', 'demo@example.com'].join(','));
		}
	}
}
mkdirSync(join(out, 'grok', 'export'), { recursive: true });
writeFileSync(join(out, 'grok', 'export', 'usage-demo.csv'), gRows.join('\n') + '\n');

console.log(`Wrote synthetic logs to ${out}:
  Claude Code  ${claudeCalls.toLocaleString()} calls (${lines.toLocaleString()} JSONL lines)
  Codex CLI    ${codexCalls.toLocaleString()} turns
  Grok Build   ${grokCalls.toLocaleString()} model calls
  Cursor       ${cursorCalls.toLocaleString()} CSV rows${sqlite ? ` + ${dbRequests} requests in a local state.vscdb` : ' (state.vscdb skipped: no node:sqlite)'}
  Grok export  ${grokBotRows.toLocaleString()} Grok Bot rows (${onDemand} on-demand) + Grok apps

Run:
  node dist/server/cli.js --offline \\
    --claude-dir ${join(out, 'claude')} \\
    --codex-home ${join(out, 'codex')} \\
    --grok-home ${join(out, 'grok')} \\
    --cursor-csv ${join(out, 'cursor')} \\
    --cursor-dir ${join(out, 'cursor-user')} \\
    --grok-csv ${join(out, 'grok', 'export')}`);
