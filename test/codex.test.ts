import { join } from 'node:path';
import * as zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { codexHomes, createCodexAdapter, findCodexRollouts } from '../src/adapters/codex.js';
import { CODEX_HOME_FIXTURE } from './helpers.js';

const hasZstd = typeof (zlib as any).zstdDecompressSync === 'function';
const S = (id: string) => (r: { session: string }) => r.session === id;

describe('codex adapter', async () => {
	const { records, stats, warnings } = await createCodexAdapter({ CODEX_HOME: CODEX_HOME_FIXTURE }).load();
	const s1 = records.filter(S('0199e3a1-7c2b-7d10-9a51-3f2b8c4d1e01'));

	it('counts only advances of the cumulative total (re-emitted snapshots are ignored)', () => {
		expect(s1).toHaveLength(3);
		expect(s1.map((r) => r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens)).toEqual([12000, 3000, 5000]);
		expect(s1.map((r) => r.outputTokens)).toEqual([500, 300, 200]);
	});

	it('splits cached input out of input_tokens instead of adding it again', () => {
		expect(s1[0]).toMatchObject({ inputTokens: 4000, cacheReadTokens: 8000, cacheWriteTokens: 0, outputTokens: 500 });
		// third turn reports cache_write_input_tokens, also inside input_tokens
		expect(s1[2]).toMatchObject({ inputTokens: 500, cacheReadTokens: 3500, cacheWriteTokens: 1000 });
	});

	it('uses the model from the latest turn_context and derives the project from cwd', () => {
		expect(s1.map((r) => r.model)).toEqual(['gpt-5.3-codex', 'gpt-5.3-codex', 'gpt-5.5']);
		expect(s1[0]).toMatchObject({ agent: 'codex', project: 'api-server', tokens: 'measured', calls: 1, sidechain: false });
		expect(s1[0]!.timestamp).toBe(Date.parse('2026-11-03T13:00:05.000Z'));
	});

	it('does not recount the parent history replayed by a fork', () => {
		const fork = records.filter(S('0199e3a8-1f40-7a22-8b3c-5d6e7f809102'));
		expect(fork).toHaveLength(1);
		expect(fork[0]).toMatchObject({ inputTokens: 1000, cacheReadTokens: 1000, outputTokens: 100, sidechain: true });
	});

	it('starts a new baseline when a resumed session resets its counter', () => {
		const s3 = records.filter(S('0199e6b2-0a11-7c33-9d44-6e7f80910203'));
		expect(s3.map((r) => [r.inputTokens, r.cacheReadTokens, r.outputTokens])).toEqual([
			[5000, 0, 100],
			[1000, 200, 50],
			[0, 800, 20]
		]);
		expect(s3[0]!.project).toBe('web-app');
	});

	it('reads archived sessions once, preferring sessions/ and plain files', async () => {
		const files = await findCodexRollouts([CODEX_HOME_FIXTURE]);
		const names = files.map((f) => f.split(/[\\/]/).slice(-2).join('/'));
		expect(names.filter((n) => n.includes('0199e3a1'))).toEqual(['03/rollout-2026-11-03T10-00-00-0199e3a1-7c2b-7d10-9a51-3f2b8c4d1e01.jsonl']);
		expect(records.filter(S('0199d0c4-2b22-7e55-8f66-708192a3b404'))).toHaveLength(1);
	});

	it.runIf(hasZstd)('reads .jsonl.zst rollouts when Node has zstd', () => {
		expect(records.filter(S('0199ebd5-3c33-7f66-a077-8192a3b4c505'))).toHaveLength(1);
		expect(records).toHaveLength(9);
		expect(warnings).toEqual([]);
	});

	it.runIf(!hasZstd)('skips .jsonl.zst rollouts with a warning when Node lacks zstd', () => {
		expect(stats.skippedFiles).toBe(1);
		expect(warnings[0]).toMatch(/zstd/);
	});

	it('reports scan stats', () => {
		expect(stats.files).toBe(5);
		expect(stats.duplicatesDropped).toBe(4); // 1 re-emit + 3 replayed fork events
		expect(stats.malformedLines).toBe(1);
		expect(stats.sidechainRecords).toBe(1);
	});

	it('handles a missing home and comma-separated CODEX_HOME', async () => {
		const res = await createCodexAdapter({ CODEX_HOME: join(CODEX_HOME_FIXTURE, 'nope') }).load();
		expect(res.records).toEqual([]);
		expect(codexHomes({ CODEX_HOME: '/a, /b' })).toHaveLength(2);
	});
});
