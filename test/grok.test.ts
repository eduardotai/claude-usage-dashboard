import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGrokBuildAdapter, grokPricingModel } from '../src/adapters/grok-build.js';
import { UsageStore } from '../src/core/store.js';
import * as stats from '../src/core/stats.js';
import { GROK_HOME_FIXTURE, testBook } from './helpers.js';

describe('grok build adapter', async () => {
	const adapter = createGrokBuildAdapter({ GROK_HOME: GROK_HOME_FIXTURE });
	const { records, stats: scan } = await adapter.load();
	const byModel = (m: string) => records.filter((r) => r.model === m);

	it('emits one record per model in a completed turn, splitting cache out of input', () => {
		const [build] = byModel('grok-4.5-build');
		expect(build).toMatchObject({
			agent: 'grok-build',
			project: 'api-server',
			inputTokens: 12000,
			cacheReadTokens: 26000,
			cacheWriteTokens: 2000,
			outputTokens: 2000,
			calls: 3,
			pricingModel: 'grok-4.5'
		});
		expect(build!.reportedCostUsd).toBeCloseTo(0.082, 10);
		expect(byModel('grok-code-fast-1')[0]).toMatchObject({ inputTokens: 4000, cacheReadTokens: 4000, outputTokens: 400, calls: 1 });
	});

	it('falls back to summary.json for the model and to envelope seconds for time', () => {
		const older = byModel('grok-4.5-build')[1]!;
		expect(older).toMatchObject({ inputTokens: 3000, cacheReadTokens: 9000, outputTokens: 600, calls: 2 });
		expect(older.reportedCostUsd).toBeCloseTo(0.021, 10);
		expect(older.timestamp).toBe(Date.parse('2026-11-03T14:05:10Z'));
	});

	it('decodes the project from the session directory when summary.json is missing', () => {
		const free = byModel('grok-4.5-build-free')[0]!;
		expect(free).toMatchObject({ project: 'web-app', inputTokens: 4000, cacheReadTokens: 1000, reportedCostUsd: null, pricingModel: 'grok-4.5' });
	});

	it('drops replayed events, and skips corrupt or undated lines', () => {
		expect(records).toHaveLength(4);
		expect(scan).toMatchObject({ files: 2, duplicatesDropped: 1, malformedLines: 2 });
	});

	it('uses the recorded cost when present and estimates the rest', async () => {
		const store = new UsageStore([adapter], testBook());
		const all = await store.all();
		const free = all.find((r) => r.model === 'grok-4.5-build-free')!;
		expect(free.cost).toBe('estimated');
		expect(free.costEst).toBeCloseTo(4000 * 2e-6 + 1000 * 0.2e-6 + 300 * 6e-6, 10);
		expect(all.find((r) => r.model === 'grok-code-fast-1')!.cost).toBe('measured');
		const sum = stats.summary(all);
		expect(sum.provenance.cost).toBe('estimated');
		expect(sum.total_calls).toBe(7);
		expect(sum.unpriced_models).toEqual([]);
	});

	it('maps Grok Build model ids to public API ids', () => {
		expect(grokPricingModel('grok-4.5-build')).toBe('grok-4.5');
		expect(grokPricingModel('grok-4.5-build-free')).toBe('grok-4.5');
		expect(grokPricingModel('grok-code-fast-1')).toBeUndefined();
	});

	it('returns nothing when ~/.grok is absent', async () => {
		const res = await createGrokBuildAdapter({ GROK_HOME: join(GROK_HOME_FIXTURE, 'nope') }).load();
		expect(res.records).toEqual([]);
	});
});
