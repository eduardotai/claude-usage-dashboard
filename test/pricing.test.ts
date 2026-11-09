import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPriceBook, loadSnapshot, modelKeyCandidates } from '../src/pricing/litellm.js';
import { TEST_TABLE, testBook } from './helpers.js';

const rec = (model: string, u: Partial<{ i: number; o: number; cr: number; cw: number; cw1h: number }>) => ({
	model,
	inputTokens: u.i ?? 0,
	outputTokens: u.o ?? 0,
	cacheReadTokens: u.cr ?? 0,
	cacheWriteTokens: u.cw ?? 0,
	cacheWrite1hTokens: u.cw1h ?? 0
});

describe('PriceBook.cost', () => {
	const book = testBook();

	it('prices input, output, cache read and 5m/1h cache writes separately', () => {
		const c = book.cost(rec('claude-opus-4-8', { i: 100, o: 50, cw: 1000, cw1h: 400, cr: 2000 }));
		// 100*5 + 50*25 + 600*6.25 + 400*10 + 2000*0.5 = 10_500 (per 1M) -> $0.0105
		expect(c).toBeCloseTo(0.0105, 10);
	});

	it('returns null for unknown models instead of $0', () => {
		expect(book.cost(rec('acme-coder-9', { i: 1000 }))).toBeNull();
		expect(book.resolve('acme-coder-9')).toBeNull();
	});

	it('resolves dated, provider-prefixed and suffixed ids without fuzzy family guessing', () => {
		expect(book.resolve('claude-sonnet-4-5-20250929')?.key).toBe('claude-sonnet-4-5');
		expect(book.resolve('anthropic/claude-opus-4-8')?.key).toBe('claude-opus-4-8');
		expect(book.resolve('claude-sonnet-4-5[1m]')?.key).toBe('claude-sonnet-4-5');
		expect(book.resolve('claude-haiku-4-5-20251001')?.key).toBe('claude-haiku-4-5-20251001');
		expect(book.resolve('claude-opus-9-9')).toBeNull();
	});

	it('falls back to the input price for missing cache prices (never free)', () => {
		expect(book.cost(rec('claude-sonnet-4-5', { cr: 1_000_000, cw: 1_000_000 }))).toBeCloseTo(6, 10);
	});

	it('applies >200k long-context tiers when the table has them', () => {
		const short = book.cost(rec('claude-sonnet-4-6', { i: 100_000, o: 1000 }))!;
		const long = book.cost(rec('claude-sonnet-4-6', { i: 250_000, o: 1000 }))!;
		expect(short).toBeCloseTo(0.3 + 0.015, 10);
		expect(long).toBeCloseTo(1.5 + 0.0225, 10);
	});
});

describe('modelKeyCandidates', () => {
	it('lowercases and strips date suffixes', () => {
		expect(modelKeyCandidates('GPT-5-2025-08-07')).toContain('gpt-5');
	});
});

describe('loadPriceBook', () => {
	const okFetch = (async () => new Response(JSON.stringify(TEST_TABLE_BIG))) as typeof fetch;
	const failFetch = (async () => {
		throw new Error('offline');
	}) as typeof fetch;
	const TEST_TABLE_BIG = Object.fromEntries(
		Array.from({ length: 30 }, (_, i) => [`m-${i}`, { input_cost_per_token: 1e-6 }]).concat(Object.entries(TEST_TABLE))
	);

	it('downloads, caches to disk, then serves from the fresh cache', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'ab-'));
		const live = await loadPriceBook({ cacheDir: dir, fetchImpl: okFetch });
		expect(live.info.source).toBe('live');
		expect(JSON.parse(await readFile(join(dir, 'litellm-prices.json'), 'utf8'))['claude-opus-4-8']).toBeTruthy();
		const cached = await loadPriceBook({ cacheDir: dir, fetchImpl: failFetch });
		expect(cached.info.source).toBe('cache');
	});

	it('uses a stale cache when the download fails', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'ab-'));
		const file = join(dir, 'litellm-prices.json');
		await writeFile(file, JSON.stringify(TEST_TABLE_BIG));
		const old = new Date(Date.now() - 3 * 86_400_000);
		await utimes(file, old, old);
		// The bundled snapshot is older still, so the stale cache is the newest prices we have.
		const snapshotPath = join(dir, 'snap.json');
		await writeFile(snapshotPath, JSON.stringify({ generated_at: new Date(Date.now() - 10 * 86_400_000).toISOString(), source: 'test', models: TEST_TABLE_BIG }));
		const book = await loadPriceBook({ cacheDir: dir, fetchImpl: failFetch, snapshotPath });
		expect(book.info.source).toBe('stale-cache');
	});

	it('prefers the bundled snapshot over a stale cache that is older than it', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'ab-'));
		const file = join(dir, 'litellm-prices.json');
		await writeFile(file, JSON.stringify(TEST_TABLE_BIG));
		const old = new Date(Date.now() - 30 * 86_400_000);
		await utimes(file, old, old);
		const snapshotPath = join(dir, 'snap.json');
		await writeFile(snapshotPath, JSON.stringify({ generated_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), source: 'test', models: TEST_TABLE_BIG }));
		const book = await loadPriceBook({ cacheDir: dir, offline: true, snapshotPath });
		expect(book.info.source).toBe('bundled');
	});

	it('falls back to the bundled snapshot when offline with no cache', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'ab-'));
		let called = false;
		const spy = (async () => {
			called = true;
			throw new Error('should not be called');
		}) as typeof fetch;
		const book = await loadPriceBook({ cacheDir: dir, offline: true, fetchImpl: spy });
		expect(called).toBe(false);
		expect(book.info.source).toBe('bundled');
	});

	it('bundled snapshot prices current Claude models', async () => {
		const book = await loadSnapshot();
		expect(book.info.models).toBeGreaterThan(50);
		for (const m of ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']) {
			expect(book.resolve(m), m).not.toBeNull();
		}
	});
});
