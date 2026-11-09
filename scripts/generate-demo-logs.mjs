#!/usr/bin/env node
/**
 * Generate synthetic Claude Code logs for demos and screenshots.
 *
 * Same shape the real adapter reads, including the quirks it must handle:
 * split assistant entries sharing message.id + requestId, and subagent
 * transcripts under <session>/subagents/. Fictional projects only.
 *
 *   node scripts/generate-demo-logs.mjs --out ./sample-logs
 *   node dist/server/cli.js --claude-dir ./sample-logs
 *
 * Nothing here touches your real ~/.claude logs.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
		cache_read_input_tokens: int(4000, 90000) * base,
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

const now = Date.now();
let calls = 0;
let lines = 0;
for (const [project, weight] of PROJECTS) {
	const dir = join(out, `-home-demo-projects-${project}`);
	mkdirSync(dir, { recursive: true });
	const sessions = Math.max(3, Math.round(weight * 9));
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
console.log(`Wrote ${calls.toLocaleString()} synthetic model calls (${lines.toLocaleString()} JSONL lines) to ${out}`);
