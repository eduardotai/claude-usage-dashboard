/**
 * The same export must give the same numbers on every machine: online or offline, fresh install
 * or old cache, bundled snapshot or a much larger live LiteLLM list.
 */
import { mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGrokAppsAdapter, createGrokBotAdapter } from '../src/adapters/grok-bot.js';
import { loadGrokUnified, parseAmount } from '../src/adapters/grok-unified.js';
import { parseCount } from '../src/adapters/csv.js';
import { UsageStore } from '../src/core/store.js';
import { loadPriceBook, type PriceTable } from '../src/pricing/litellm.js';
import { GROK_UNIFIED_FIXTURES, fixturesEnv } from './helpers.js';

const DAY = 86_400_000;
const rate = { litellm_provider: 'xai', input_cost_per_token: 2e-6, output_cost_per_token: 6e-6, cache_read_input_token_cost: 0.5e-6 };
const longCtx = { input_cost_per_token_above_200k_tokens: 4e-6, output_cost_per_token_above_200k_tokens: 12e-6, cache_read_input_token_cost_above_200k_tokens: 1e-6 };
/** loadPriceBook ignores tables with fewer than ~20 models; pad with unrelated entries. */
const pad = (t: PriceTable): PriceTable => {
	const out: PriceTable = { ...t };
	for (let i = 0; i < 25; i++) out[`filler-model-${i}`] = { litellm_provider: 'openai', input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 };
	return out;
};
const SNAPSHOT = pad({ 'xai/grok-4.6': { ...rate, ...longCtx }, 'xai/grok-4.7': { ...rate, ...longCtx }, 'xai/grok-4.5': { ...rate, cache_read_input_token_cost: 0.2e-6 } });
// Shaped like the live list: more xAI models, extra batch/image fields, and one model with the
// same base price but a different long-context price (which also reproduces the charges).
const LIVE = pad({
	'xai/grok-4.6': { ...rate, ...longCtx, input_cost_per_image_token: 2e-6 },
	'xai/grok-4.7': { ...rate, ...longCtx, input_cost_per_token_batches: 1.6e-6, output_cost_per_token_batches: 4.8e-6 },
	'xai/grok-4.7-latest': { ...rate, ...longCtx },
	'xai/grok-4.7-fast-preview': { ...rate },
	'xai/grok-4.5': { ...rate, cache_read_input_token_cost: 0.2e-6 },
	'xai/grok-code-fast-1': { litellm_provider: 'xai', input_cost_per_token: 0.2e-6, output_cost_per_token: 1.5e-6 }
});
// An old cache from before these models existed.
const OLD = pad({ 'claude-sonnet-4-5': { litellm_provider: 'anthropic', input_cost_per_token: 3e-6, output_cost_per_token: 15e-6 } });

async function setup(snapshotAgeDays: number) {
	const dir = await mkdtemp(join(tmpdir(), 'ab-src-'));
	const snapshotPath = join(dir, 'snapshot.json');
	await writeFile(snapshotPath, JSON.stringify({ generated_at: new Date(Date.now() - snapshotAgeDays * DAY).toISOString(), source: 'test', models: SNAPSHOT }));
	return { dir, snapshotPath };
}
async function cacheFile(dir: string, table: PriceTable, ageDays: number) {
	const f = join(dir, 'litellm-prices.json');
	await writeFile(f, JSON.stringify(table));
	const t = new Date(Date.now() - ageDays * DAY);
	await utimes(f, t, t);
}
const okFetch = (table: PriceTable) => (async () => new Response(JSON.stringify(table), { status: 200 })) as unknown as typeof fetch;
const failFetch = (async () => {
	throw new Error('offline');
}) as unknown as typeof fetch;

const SOURCES: Record<string, () => Promise<Awaited<ReturnType<typeof loadPriceBook>>>> = {
	'bundled (offline, fresh install)': async () => {
		const { dir, snapshotPath } = await setup(5);
		return loadPriceBook({ cacheDir: dir, offline: true, snapshotPath });
	},
	'live download': async () => {
		const { dir, snapshotPath } = await setup(5);
		return loadPriceBook({ cacheDir: dir, fetchImpl: okFetch(LIVE), snapshotPath });
	},
	'fresh cache of the live list': async () => {
		const { dir, snapshotPath } = await setup(5);
		await cacheFile(dir, LIVE, 0);
		return loadPriceBook({ cacheDir: dir, fetchImpl: failFetch, snapshotPath });
	},
	'stale cache, newer than the snapshot, missing xAI models': async () => {
		const { dir, snapshotPath } = await setup(30);
		await cacheFile(dir, OLD, 3);
		return loadPriceBook({ cacheDir: dir, fetchImpl: failFetch, snapshotPath });
	},
	'stale cache older than the snapshot (offline)': async () => {
		const { dir, snapshotPath } = await setup(2);
		await cacheFile(dir, OLD, 40);
		return loadPriceBook({ cacheDir: dir, offline: true, snapshotPath });
	}
};

async function run(csv: string[], prices: Awaited<ReturnType<typeof loadPriceBook>>) {
	const env = fixturesEnv();
	const store = new UsageStore([createGrokBotAdapter(env, { csv }), createGrokAppsAdapter(env, { csv })], prices);
	const recs = await store.all();
	return {
		source: prices.info.source,
		costs: recs.map((r) => [r.agent, r.model, r.pricingModel ?? null, r.cost, r.costEst === null ? null : +r.costEst.toFixed(12)]),
		warnings: store.agentStatuses().map((a) => a.warnings)
	};
}

describe('same result from every price source', () => {
	it('exercises the intended loading paths', async () => {
		const got = await Promise.all(Object.values(SOURCES).map(async (load) => (await load()).info.source));
		expect(got).toEqual(['bundled', 'live', 'cache', 'stale-cache', 'bundled']);
	});

	it('export with on-demand charges: Grok Bot rate, estimates and messages match everywhere', async () => {
		const results = await Promise.all(Object.values(SOURCES).map(async (load) => run([GROK_UNIFIED_FIXTURES], await load())));
		const [first, ...rest] = results;
		expect(first!.costs.filter((c) => c[0] === 'grok-bot').every((c) => c[2] === 'xai/grok-4.7' && c[3] === 'estimated')).toBe(true);
		for (const r of rest) {
			expect(r.costs).toEqual(first!.costs);
			expect(r.warnings).toEqual(first!.warnings);
		}
	});

	it('export with no on-demand rows: estimate unavailable everywhere, with the reason', async () => {
		const csv = [join(GROK_UNIFIED_FIXTURES, 'usage-2026-11-07.csv')];
		const results = await Promise.all(Object.values(SOURCES).map(async (load) => run(csv, await load())));
		for (const r of results) {
			expect(r.costs).toEqual(results[0]!.costs);
			expect(r.costs.every((c) => c[3] === 'unavailable')).toBe(true);
			expect(r.warnings[0]!.join(' ')).toMatch(/no on-demand charges to match a rate against/);
		}
	});

	it('uses a rate only the live list has when the bundled snapshot has none (newer model)', async () => {
		const { dir } = await setup(5);
		const snapshotPath = join(dir, 'old-snapshot.json');
		await writeFile(snapshotPath, JSON.stringify({ generated_at: new Date().toISOString(), source: 'test', models: pad({ 'xai/grok-4.5': { ...rate, cache_read_input_token_cost: 0.2e-6 } }) }));
		const prices = await loadPriceBook({ cacheDir: dir, fetchImpl: okFetch(LIVE), snapshotPath });
		const { costs } = await run([GROK_UNIFIED_FIXTURES], prices);
		// LIVE has several matching keys whose effective prices agree for these rows.
		expect(costs.filter((c) => c[0] === 'grok-bot').every((c) => c[2] === 'xai/grok-4.7' && c[3] === 'estimated')).toBe(true);
	});
});

describe('spreadsheet-localized exports', () => {
	it('reads a semicolon-separated export with decimal commas', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'ab-loc-'));
		const f = join(dir, 'usage-ptbr.csv');
		await writeFile(
			f,
			[
				'Billing Item ID;Event Time;Product;Charge Category;Usage Type;Principal Type;Principal ID;Usage;Pricing Currency;Pricing Contracted;Model;User Email',
				'a1;2026-11-04T18:00:00.000Z;grok-bot;usage;on_demand;user;p;"{""cache-write-text-tokens"":""6000"",""cached-prompt-text-tokens"":""60000"",""completion-text-tokens"":""100"",""prompt-text-tokens"":""3""}";USD;0,0426060000;;dev@example.com'
			].join('\r\n')
		);
		const { rows } = await loadGrokUnified(fixturesEnv(), { csv: [f] });
		expect(rows).toHaveLength(1);
		expect(rows[0]!.billedUsd).toBeCloseTo(0.042606, 10);
		expect(rows[0]!.tokens).toEqual({ input: 3, cacheRead: 60000, cacheWrite: 6000, output: 100 });
	});

	it('parses localized amounts and counts', () => {
		expect(parseAmount('0.0291435')).toBeCloseTo(0.0291435, 10);
		expect(parseAmount('0,0291435')).toBeCloseTo(0.0291435, 10);
		expect(parseAmount('1.234,50')).toBeCloseTo(1234.5, 10);
		expect(parseAmount('$1,234.50')).toBeCloseTo(1234.5, 10);
		expect(parseCount('1,204')).toBe(1204);
		expect(parseCount('1.204')).toBe(1204);
		expect(parseCount('1 204')).toBe(1204);
		expect(parseCount('52880')).toBe(52880);
	});
});
