import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAdapters } from '../src/adapters/index.js';
import { createCursorAdapter } from '../src/adapters/cursor.js';
import { GROK_BOT_MODEL, createGrokAppsAdapter, createGrokBotAdapter, matchBilledRate, unifiedRowToRecord } from '../src/adapters/grok-bot.js';
import { PriceBook } from '../src/pricing/litellm.js';
import { loadGrokUnified } from '../src/adapters/grok-unified.js';
import { UsageStore } from '../src/core/store.js';
import * as stats from '../src/core/stats.js';
import { CURSOR_FIXTURES, GROK_UNIFIED_FIXTURES, fixturesEnv, testBook } from './helpers.js';

const env = fixturesEnv();
const opts = { csv: [GROK_UNIFIED_FIXTURES] };

describe('grok.com unified usage export', async () => {
	const { rows, stats: scan } = await loadGrokUnified(env, opts);

	it('reads both exports, dedupes on Billing Item ID and skips a corrupt Usage cell', () => {
		expect(scan.files).toBe(2);
		expect(rows).toHaveLength(11);
		expect(scan.duplicatesDropped).toBe(1);
		expect(scan.malformedLines).toBe(1);
	});

	it('treats the four token counts as disjoint buckets and normalizes key spelling', () => {
		expect(rows.find((r) => r.id.endsWith('000000000001'))!.tokens).toEqual({ input: 2, cacheRead: 130000, cacheWrite: 600, output: 170 });
		expect(rows.find((r) => r.product === 'grok-chat')!.tokens).toEqual({ input: 100, cacheRead: 500, cacheWrite: 0, output: 200 });
		expect(rows.find((r) => r.product === 'grok-voice')).toMatchObject({ tokens: null, units: { 'audio-seconds': 35 } });
	});

	it('never keeps personal columns', () => {
		expect(JSON.stringify(rows)).not.toMatch(/example\.com|00000000-0000-4000-8000-000000000000/);
	});
});

describe('Grok Bot from the export', async () => {
	const bot = createGrokBotAdapter(env, opts);
	const store = new UsageStore([bot, createGrokAppsAdapter(env, opts)], testBook());
	const all = await store.all();
	const botRecs = all.filter((r) => r.agent === 'grok-bot');

	it('emits one call per row with measured tokens and the billed amount', () => {
		expect(botRecs).toHaveLength(6);
		// an all-zero token row is a measured zero, not missing data
		expect(botRecs.filter((r) => r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens === 0)).toHaveLength(1);
		expect(botRecs.every((r) => r.tokens === 'measured' && r.model === GROK_BOT_MODEL)).toBe(true);
		const s = stats.summary(botRecs);
		expect(s.billed_cost).toBeCloseTo(0.042606 + 0.029204, 9);
		expect(s.billed_records).toBe(6);
		expect(s.charged_records).toBe(2);
	});

	it('estimates API cost at the xAI rate that reproduces every on-demand charge, and says so', () => {
		expect(botRecs.every((r) => r.pricingModel === 'xai/grok-4.7' && r.cost === 'estimated')).toBe(true);
		const onDemand = botRecs.filter((r) => (r.billedUsd ?? 0) > 0);
		for (const r of onDemand) expect(r.costEst).toBeCloseTo(r.billedUsd!, 10);
		const w = store.agentStatuses().find((a) => a.id === 'grok-bot')!.warnings.join(' ');
		expect(w).toMatch(/xai\/grok-4\.7 list price \(\$2 input \/ \$0\.5 cached \/ \$6 output per M; same rate as xai\/grok-4\.6\).*2 on-demand charges/);
	});

	it('leaves the estimate unavailable when no charge pins down the rate', async () => {
		const only = { csv: [join(GROK_UNIFIED_FIXTURES, 'usage-2026-11-07.csv')] };
		const s2 = new UsageStore([createGrokBotAdapter(env, only)], testBook());
		const recs = await s2.all();
		expect(recs.every((r) => r.costEst === null && r.cost === 'unavailable')).toBe(true);
		expect(s2.agentStatuses()[0]!.warnings.join(' ')).toMatch(/no on-demand charges/);
		expect(stats.summary(recs).billed_cost).toBe(0);
	});

	it('puts chat, voice and imagine under Grok apps; non-token rows count as calls only', () => {
		const apps = all.filter((r) => r.agent === 'grok-apps');
		expect(apps.map((r) => r.model).sort()).toEqual(['grok-4.7', 'grok-imagine', 'grok-voice']);
		expect(apps.find((r) => r.model === 'grok-4.7')).toMatchObject({ tokens: 'measured', cost: 'estimated' });
		expect(apps.find((r) => r.model === 'grok-voice')).toMatchObject({ tokens: 'unavailable', cost: 'unavailable', calls: 1 });
	});
});

describe('Cursor rows from the export', () => {
	it('become Cursor usage with billed amounts', async () => {
		const { records } = await createCursorAdapter(env, { grokCsv: [GROK_UNIFIED_FIXTURES] }).load();
		expect(records).toHaveLength(2);
		expect(records.find((r) => r.model === 'claude-4.5-sonnet')).toMatchObject({ inputTokens: 2000, cacheReadTokens: 10000, cacheWriteTokens: 500, outputTokens: 700, billedUsd: 0, pricingModel: 'claude-sonnet-4-5' });
	});

	it('yield to the Cursor CSV inside its time span', async () => {
		const csvEnv = fixturesEnv({ AGENTBURN_IMPORTS_DIR: join(CURSOR_FIXTURES, 'imports') });
		// CSV covers Nov 4–5: both export rows (Nov 2, Nov 6) are outside and kept.
		let res = await createCursorAdapter(csvEnv, { grokCsv: [GROK_UNIFIED_FIXTURES] }).load();
		expect(res.records.filter((r) => r.session === 'grok-export:cursor')).toHaveLength(2);
		// Adding the Oct 20 legacy CSV widens the span past Nov 2: that row is dropped.
		res = await createCursorAdapter(csvEnv, { csv: [join(CURSOR_FIXTURES, 'legacy-v1.csv')], grokCsv: [GROK_UNIFIED_FIXTURES] }).load();
		expect(res.records.filter((r) => r.session === 'grok-export:cursor').map((r) => r.model)).toEqual(['cursor-grok-4.6-high']);
	});
});

describe('registry', () => {
	it('lists Grok Bot and Grok apps as available', () => {
		const ids = createAdapters(env).map((a) => [a.id, a.status]);
		expect(ids).toContainEqual(['grok-bot', 'available']);
		expect(ids).toContainEqual(['grok-apps', 'available']);
	});
});

describe('Grok Bot rate matching is independent of the price table', () => {
	const base = { litellm_provider: 'xai', input_cost_per_token: 2e-6, output_cost_per_token: 6e-6, cache_read_input_token_cost: 0.5e-6 };
	const long = { input_cost_per_token_above_200k_tokens: 4e-6, output_cost_per_token_above_200k_tokens: 12e-6, cache_read_input_token_cost_above_200k_tokens: 1e-6 };
	const book = (table: Record<string, object>) => new PriceBook(table as never, { source: 'live', fetchedAt: null, models: Object.keys(table).length, url: 'test' });
	const run = async (table: Record<string, object>) => {
		const store = new UsageStore([createGrokBotAdapter(env, opts)], book(table));
		const recs = await store.all();
		return { recs, warning: store.agentStatuses()[0]!.warnings.join(' ') };
	};

	it('treats models whose entries differ only in unused fields (batch, image) as one rate', async () => {
		// Shaped like the live LiteLLM list: grok-4.7 carries batch prices grok-4.6 lacks.
		const live = {
			'xai/grok-4.6': { ...base, ...long, input_cost_per_image_token: 2e-6 },
			'xai/grok-4.7': { ...base, ...long, input_cost_per_image_token: 2e-6, input_cost_per_token_batches: 1.6e-6, output_cost_per_token_batches: 4.8e-6, cache_read_input_token_cost_batches: 0.4e-6 },
			'xai/grok-4.7-latest': { ...base, ...long },
			'xai/grok-4.5': { ...base, cache_read_input_token_cost: 0.2e-6 } // different rate: no match
		};
		const snapshot = { 'xai/grok-4.6': { ...base, ...long }, 'xai/grok-4.7': { ...base, ...long } };
		const a = await run(live);
		const b = await run(snapshot);
		expect(a.recs.every((r) => r.pricingModel === 'xai/grok-4.7' && r.cost === 'estimated')).toBe(true);
		expect(a.warning).toMatch(/xai\/grok-4\.7 list price \(.*same rate as xai\/grok-4\.6, xai\/grok-4\.7-latest\)/);
		// Same estimate whichever table is loaded.
		expect(a.recs.map((r) => r.costEst)).toEqual(b.recs.map((r) => r.costEst));
	});

	it('ignores rate differences that no row in the export reaches', async () => {
		// Long-context prices differ, but every fixture prompt is under 200k tokens.
		const { recs } = await run({ 'xai/grok-4.6': { ...base, ...long }, 'xai/grok-x': { ...base } });
		expect(recs.every((r) => r.cost === 'estimated')).toBe(true);
	});

	it('stays unavailable when matching rates would price the export differently', async () => {
		// A row above 200k tokens makes the long-context price matter.
		const big = [{ ...unifiedRowToRecord({ id: 'x', timestamp: 1, product: 'grok-bot', usageType: 'included', model: '', tokens: { input: 10, cacheRead: 250_000, cacheWrite: 0, output: 10 }, units: {}, billedUsd: 0 }, 'grok-bot', 'p') }];
		const charged = [
			unifiedRowToRecord({ id: 'y', timestamp: 2, product: 'grok-bot', usageType: 'on_demand', model: '', tokens: { input: 3, cacheRead: 60000, cacheWrite: 6000, output: 100 }, units: {}, billedUsd: 0.042606 }, 'grok-bot', 'p')
		];
		const m = matchBilledRate([...big, ...charged], book({ 'xai/grok-4.6': { ...base, ...long }, 'xai/grok-x': { ...base } }));
		expect(m.key).toBeNull();
		expect(m.reason).toMatch(/price this export differently/);
		expect(m.matches).toEqual(['xai/grok-x', 'xai/grok-4.6']);
	});
});
