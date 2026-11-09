// Regenerates test/fixtures/codex. Shapes follow openai/codex codex-rs/protocol/src/protocol.rs
// (RolloutLine { timestamp, type, payload }) as of cli 0.13x. Run: node test/fixtures/build-codex-fixtures.mjs
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdCompressSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'codex', 'home');
rmSync(ROOT, { recursive: true, force: true });

const S1 = '0199e3a1-7c2b-7d10-9a51-3f2b8c4d1e01';
const S2 = '0199e3a8-1f40-7a22-8b3c-5d6e7f809102';
const S3 = '0199e6b2-0a11-7c33-9d44-6e7f80910203';
const S4 = '0199d0c4-2b22-7e55-8f66-708192a3b404';
const S5 = '0199ebd5-3c33-7f66-a077-8192a3b4c505';

const rate = { primary: { used_percent: 12.0, window_minutes: 300, resets_in_seconds: 9000 }, secondary: { used_percent: 3.0, window_minutes: 10080, resets_in_seconds: 500000 } };
const u = (input, cached, out, reasoning, cacheWrite = 0) => ({
	input_tokens: input,
	cached_input_tokens: cached,
	...(cacheWrite ? { cache_write_input_tokens: cacheWrite } : {}),
	output_tokens: out,
	reasoning_output_tokens: reasoning,
	total_tokens: input + out
});
const line = (timestamp, type, payload) => JSON.stringify({ timestamp, type, payload });
const meta = (ts, id, cwd, extra = {}) =>
	line(ts, 'session_meta', { id, timestamp: ts, cwd, originator: 'codex_cli_rs', cli_version: '0.131.0', instructions: null, source: 'cli', model_provider: 'openai', git: { commit_hash: 'a1b2c3d', branch: 'main' }, ...extra });
const ctx = (ts, cwd, model) => line(ts, 'turn_context', { cwd, approval_policy: 'on-request', sandbox_policy: { mode: 'workspace-write' }, model, effort: 'medium', summary: 'auto' });
const tc = (ts, total, last) => line(ts, 'event_msg', { type: 'token_count', info: total ? { total_token_usage: total, last_token_usage: last, model_context_window: 272000 } : null, rate_limits: rate });
const user = (ts, text) => line(ts, 'event_msg', { type: 'user_message', message: text, images: [] });
const item = (ts, text) => line(ts, 'response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });

function write(rel, lines, { zst = false } = {}) {
	const f = join(ROOT, rel);
	mkdirSync(dirname(f), { recursive: true });
	const body = lines.join('\n') + '\n';
	writeFileSync(f, zst ? zstdCompressSync(Buffer.from(body)) : body);
}

// S1: main session. Re-emitted snapshot, model switch, cache write field.
const cwd1 = '/home/dev/work/api-server';
const t1a = u(12000, 8000, 500, 200);
const t1b = u(15000, 10500, 800, 300);
const t1c = u(20000, 14000, 1000, 400, 1000);
const s1 = [
	meta('2026-11-03T13:00:00.000Z', S1, cwd1),
	ctx('2026-11-03T13:00:00.100Z', cwd1, 'gpt-5.3-codex'),
	user('2026-11-03T13:00:01.000Z', 'add pagination to /users'),
	tc('2026-11-03T13:00:01.200Z', null, null),
	item('2026-11-03T13:00:04.000Z', 'Added cursor-based pagination.'),
	tc('2026-11-03T13:00:05.000Z', t1a, t1a),
	tc('2026-11-03T13:00:05.200Z', t1a, t1a),
	tc('2026-11-03T13:01:00.000Z', t1b, u(3000, 2500, 300, 100)),
	ctx('2026-11-03T13:01:30.000Z', cwd1, 'gpt-5.5'),
	tc('2026-11-03T13:02:00.000Z', t1c, u(5000, 3500, 200, 100, 1000))
];
write(`sessions/2026/11/03/rollout-2026-11-03T10-00-00-${S1}.jsonl`, s1);
// The same rollout, archived (and compressed) while sessions/ still has it: must not double count.
write(`archived_sessions/rollout-2026-11-03T10-00-00-${S1}.jsonl`, s1);
write(`sessions/2026/11/03/rollout-2026-11-03T10-00-00-${S1}.jsonl.zst`, s1, { zst: true });

// S2: forked subagent replays the parent's history as a dense burst, then does new work.
const s2 = [
	meta('2026-11-03T13:05:00.000Z', S2, cwd1, { forked_from_id: S1, source: { subagent: 'review' } }),
	ctx('2026-11-03T13:05:00.005Z', cwd1, 'gpt-5.3-codex'),
	tc('2026-11-03T13:05:00.010Z', t1a, t1a),
	tc('2026-11-03T13:05:00.040Z', t1b, u(3000, 2500, 300, 100)),
	tc('2026-11-03T13:05:00.070Z', t1c, u(5000, 3500, 200, 100, 1000)),
	user('2026-11-03T13:05:02.000Z', 'review the diff'),
	tc('2026-11-03T13:05:12.000Z', u(22000, 15000, 1100, 450, 1000), u(2000, 1000, 100, 50))
];
write(`sessions/2026/11/03/rollout-2026-11-03T10-05-00-${S2}.jsonl`, s2);

// S3: resumed session whose counter restarts (total goes down), plus a corrupt line.
const cwd3 = '/home/dev/work/web-app';
write(`sessions/2026/11/04/rollout-2026-11-04T09-00-00-${S3}.jsonl`, [
	meta('2026-11-04T12:00:00.000Z', S3, cwd3),
	ctx('2026-11-04T12:00:00.100Z', cwd3, 'gpt-5.5'),
	tc('2026-11-04T12:00:10.000Z', u(5000, 0, 100, 0), u(5000, 0, 100, 0)),
	'{"timestamp":"2026-11-04T12:00:11.000Z","type":"event_msg","payload":{"type":"token_count",',
	meta('2026-11-04T15:00:00.000Z', S3, cwd3),
	tc('2026-11-04T15:00:10.000Z', u(1200, 200, 50, 0), u(1200, 200, 50, 0)),
	tc('2026-11-04T15:00:20.000Z', u(2000, 1000, 70, 10), u(800, 800, 20, 10))
]);

// S4: archived only (flat archived_sessions layout).
write(`archived_sessions/rollout-2026-10-30T08-00-00-${S4}.jsonl`, [
	meta('2026-10-30T11:00:00.000Z', S4, '/home/dev/work/api-server'),
	ctx('2026-10-30T11:00:00.100Z', '/home/dev/work/api-server', 'gpt-5-codex'),
	tc('2026-10-30T11:00:30.000Z', u(9000, 6000, 400, 100), u(9000, 6000, 400, 100))
]);

// S5: compressed only. Read when the runtime has zstd.
write(`sessions/2026/11/05/rollout-2026-11-05T08-00-00-${S5}.jsonl.zst`, [
	meta('2026-11-05T11:00:00.000Z', S5, cwd3),
	ctx('2026-11-05T11:00:00.100Z', cwd3, 'gpt-5.5'),
	tc('2026-11-05T11:00:30.000Z', u(3000, 1000, 250, 50), u(3000, 1000, 250, 50))
], { zst: true });
console.log('codex fixtures written to', ROOT);
