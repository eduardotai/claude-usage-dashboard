// Regenerates test/fixtures/grok. Shapes follow ccusage rust/adapters/grok (parser.rs + fixtures)
// and the real `turn_completed` sample in TokenTracker issue #362. Run: node test/fixtures/build-grok-fixtures.mjs
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'grok', 'home');
rmSync(ROOT, { recursive: true, force: true });

const A = '019a4f10-1111-7aaa-8bbb-000000000001';
const B = '019a5020-2222-7ccc-8ddd-000000000002';
const sec = (iso) => Math.floor(Date.parse(iso) / 1000);
const env = (iso, sessionId, update, meta) =>
	JSON.stringify({ timestamp: iso === null ? undefined : sec(iso), method: '_x.ai/session/update', params: { sessionId, update, ...(meta ? { _meta: meta } : {}) } });
const chunk = (iso, sessionId, text, ctx) => env(iso, sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }, { totalTokens: ctx });
const usage = (input, cached, output, reasoning, extra = {}) => ({ inputTokens: input, cachedReadTokens: cached, outputTokens: output, reasoningTokens: reasoning, totalTokens: input + output, ...extra });
const done = (iso, sessionId, u, eventId, withMs = true) =>
	env(iso, sessionId, { sessionUpdate: 'turn_completed', stopReason: 'end_turn', usage: u }, { eventId, ...(withMs ? { agentTimestampMs: Date.parse(iso) } : {}) });

function write(dir, lines, summary) {
	const d = join(ROOT, 'sessions', dir);
	mkdirSync(d, { recursive: true });
	writeFileSync(join(d, 'updates.jsonl'), lines.join('\n') + '\n');
	if (summary) writeFileSync(join(d, 'summary.json'), JSON.stringify(summary, null, 2));
}

// Session A: api-server. Two models in one turn, recorded cost, a replayed event, a corrupt line.
const twoModels = usage(48000, 30000, 2400, 900, {
	cacheCreationTokens: 2000,
	modelCalls: 4,
	costUsdTicks: 905000000,
	modelUsage: {
		'grok-4.5-build': usage(40000, 26000, 2000, 900, { cacheCreationTokens: 2000, modelCalls: 3, costUsdTicks: 820000000 }),
		'grok-code-fast-1': usage(8000, 4000, 400, 0, { modelCalls: 1, costUsdTicks: 85000000 })
	}
});
// Older builds: no per-model breakdown; the model comes from summary.json.
const noBreakdown = usage(12000, 9000, 600, 200, { modelCalls: 2, costUsdTicks: 210000000 });
write(`${encodeURIComponent('/home/dev/work/api-server')}/${A}`, [
	env('2026-11-03T14:00:00Z', A, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'fix the flaky test' } }),
	chunk('2026-11-03T14:00:03Z', A, 'Looking at test/users.spec.ts', 31000),
	done('2026-11-03T14:00:40Z', A, twoModels, 'evt-1'),
	done('2026-11-03T14:00:40Z', A, twoModels, 'evt-1'),
	'{"timestamp":1793714460,"method":"_x.ai/session/update","params":{"sessionId":"' + A + '","update":{"sessionUpdate":"turn_completed","usage":{"inputTokens":',
	chunk('2026-11-03T14:05:00Z', A, 'Done.', 52000),
	done('2026-11-03T14:05:10Z', A, noBreakdown, 'evt-2', false)
], { info: { id: A, cwd: '/home/dev/work/api-server' }, git_root_dir: '/home/dev/work/api-server', current_model_id: 'grok-4.5-build' });

// Session B: web-app, no summary.json, free-tier model id, no recorded cost. Event ids restart per session.
write(`${encodeURIComponent('/home/dev/work/web-app')}/${B}`, [
	done('2026-11-04T18:30:00Z', B, usage(5000, 1000, 300, 100, { modelUsage: { 'grok-4.5-build-free': usage(5000, 1000, 300, 100) } }), 'evt-1'),
	done(null, B, usage(100, 0, 10, 0), 'evt-9')
]);
console.log('grok fixtures written to', ROOT);
