/**
 * API-equivalent pricing from LiteLLM's public price table
 * (BerriAI/litellm `model_prices_and_context_window.json`).
 *
 * Resolution order when the server starts:
 *   1. fresh on-disk cache (< 24h old)
 *   2. live download (skipped with --offline / AGENTBURN_OFFLINE=1)
 *   3. stale on-disk cache
 *   4. the snapshot bundled in the npm package
 *
 * The download is the only network request AgentBurn ever makes, and it sends
 * nothing about you: it is a plain GET of a public JSON file.
 *
 * Models we cannot find are NOT priced at $0: their cost is `null` and they are
 * reported as unpriced so the UI can say so.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SNAPSHOT_PATH } from '../paths.js';
import type { RawUsageRecord } from '../core/types.js';

export const LITELLM_URL =
	'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

/** Subset of LiteLLM's per-model entry that we use. All prices are USD per token. */
export interface LiteLLMEntry {
	litellm_provider?: string;
	mode?: string;
	input_cost_per_token?: number;
	output_cost_per_token?: number;
	cache_creation_input_token_cost?: number;
	cache_creation_input_token_cost_above_1hr?: number;
	cache_read_input_token_cost?: number;
	input_cost_per_token_above_200k_tokens?: number;
	output_cost_per_token_above_200k_tokens?: number;
	cache_creation_input_token_cost_above_200k_tokens?: number;
	cache_read_input_token_cost_above_200k_tokens?: number;
}

export type PriceTable = Record<string, LiteLLMEntry>;
export type PricingSource = 'live' | 'cache' | 'stale-cache' | 'bundled';

export interface PricingInfo {
	source: PricingSource;
	/** ISO time the table was fetched (or the snapshot was generated). */
	fetchedAt: string | null;
	models: number;
	url: string;
}

const PROVIDER_PREFIXES = ['anthropic/', 'openai/', 'gemini/', 'vertex_ai/', 'xai/', 'deepseek/', 'bedrock/'];

/** Candidate keys for a logged model id, most specific first. No fuzzy family guessing. */
export function modelKeyCandidates(model: string): string[] {
	const m = model.trim().toLowerCase();
	const out = new Set<string>([m]);
	const noProvider = PROVIDER_PREFIXES.reduce((s, p) => (s.startsWith(p) ? s.slice(p.length) : s), m);
	out.add(noProvider);
	// Context-window / variant suffixes some agents append, e.g. "claude-sonnet-4-5[1m]".
	const noBracket = noProvider.replace(/\[[^\]]*\]$/, '');
	out.add(noBracket);
	// Bedrock-style version suffix "-v1:0".
	const noVersion = noBracket.replace(/-v\d+(:\d+)?$/, '');
	out.add(noVersion);
	// Dated snapshots "...-20250929" or "...-2025-08-07" -> undated alias.
	out.add(noVersion.replace(/-(\d{8}|\d{4}-\d{2}-\d{2})$/, ''));
	for (const base of [...out]) for (const p of PROVIDER_PREFIXES) out.add(p + base);
	return [...out];
}

export class PriceBook {
	private readonly cache = new Map<string, { key: string; entry: LiteLLMEntry } | null>();

	constructor(
		private readonly table: PriceTable,
		readonly info: PricingInfo
	) {}

	/** All price-table keys (for adapters that match a bill against list prices). */
	keys(): string[] {
		return Object.keys(this.table);
	}

	resolve(model: string): { key: string; entry: LiteLLMEntry } | null {
		if (this.cache.has(model)) return this.cache.get(model)!;
		let found: { key: string; entry: LiteLLMEntry } | null = null;
		for (const key of modelKeyCandidates(model)) {
			const entry = this.table[key];
			if (entry && typeof entry.input_cost_per_token === 'number') {
				found = { key, entry };
				break;
			}
		}
		this.cache.set(model, found);
		return found;
	}

	/**
	 * API-equivalent cost in USD, or null when the model is unknown.
	 *
	 * - Cache writes use the 5-minute write price, and the 1-hour price for the
	 *   portion the agent logged as 1h TTL (when LiteLLM has it).
	 * - Missing cache prices fall back to the plain input price (never to $0).
	 * - Long-context tiers (`*_above_200k_tokens`) apply when the request's whole
	 *   prompt (input + cache read + cache write) exceeds 200k tokens.
	 */
	cost(r: Pick<RawUsageRecord, 'model' | 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'cacheWrite1hTokens'>): number | null {
		const hit = this.resolve(r.model);
		if (!hit) return null;
		const e = hit.entry;
		const prompt = r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens;
		const long = prompt > 200_000;
		const pick = (base: number | undefined, above: number | undefined) =>
			long && typeof above === 'number' ? above : base;

		const input = pick(e.input_cost_per_token, e.input_cost_per_token_above_200k_tokens) ?? 0;
		const output = pick(e.output_cost_per_token, e.output_cost_per_token_above_200k_tokens) ?? 0;
		const write5m = pick(e.cache_creation_input_token_cost, e.cache_creation_input_token_cost_above_200k_tokens) ?? input;
		const write1h = e.cache_creation_input_token_cost_above_1hr ?? write5m;
		const read = pick(e.cache_read_input_token_cost, e.cache_read_input_token_cost_above_200k_tokens) ?? input;

		const w1h = Math.min(r.cacheWrite1hTokens, r.cacheWriteTokens);
		return (
			r.inputTokens * input +
			r.outputTokens * output +
			(r.cacheWriteTokens - w1h) * write5m +
			w1h * write1h +
			r.cacheReadTokens * read
		);
	}
}

// --- Loading ---------------------------------------------------------------

export function defaultCacheDir(env: NodeJS.ProcessEnv = process.env): string {
	if (env.AGENTBURN_CACHE_DIR) return env.AGENTBURN_CACHE_DIR;
	if (process.platform === 'win32' && env.LOCALAPPDATA) return join(env.LOCALAPPDATA, 'agentburn', 'cache');
	return join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'agentburn');
}


function isPriceTable(v: unknown): v is PriceTable {
	return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length > 20;
}

interface Snapshot {
	generated_at: string;
	source: string;
	models: PriceTable;
}

export async function loadSnapshot(path = SNAPSHOT_PATH): Promise<PriceBook> {
	const snap = JSON.parse(await readFile(path, 'utf8')) as Snapshot;
	return new PriceBook(snap.models, {
		source: 'bundled',
		fetchedAt: snap.generated_at,
		models: Object.keys(snap.models).length,
		url: LITELLM_URL
	});
}

export interface LoadOptions {
	offline?: boolean;
	cacheDir?: string;
	fetchImpl?: typeof fetch;
	now?: () => number;
	snapshotPath?: string;
}

export async function loadPriceBook(opts: LoadOptions = {}): Promise<PriceBook> {
	const cacheDir = opts.cacheDir ?? defaultCacheDir();
	const cacheFile = join(cacheDir, 'litellm-prices.json');
	const now = opts.now ?? Date.now;

	let cached: { table: PriceTable; mtime: number } | null = null;
	try {
		const [text, st] = await Promise.all([readFile(cacheFile, 'utf8'), stat(cacheFile)]);
		const table = JSON.parse(text) as unknown;
		if (isPriceTable(table)) cached = { table, mtime: st.mtimeMs };
	} catch {
		/* no usable cache */
	}
	const book = (table: PriceTable, source: PricingSource, at: number) =>
		new PriceBook(table, { source, fetchedAt: new Date(at).toISOString(), models: Object.keys(table).length, url: LITELLM_URL });

	if (cached && now() - cached.mtime < CACHE_TTL_MS) return book(cached.table, 'cache', cached.mtime);

	if (!opts.offline) {
		try {
			const res = await (opts.fetchImpl ?? fetch)(LITELLM_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
			if (res.ok) {
				const text = await res.text();
				const table = JSON.parse(text) as unknown;
				if (isPriceTable(table)) {
					await mkdir(cacheDir, { recursive: true }).catch(() => {});
					await writeFile(cacheFile, text).catch(() => {});
					return book(table, 'live', now());
				}
			}
		} catch {
			/* offline, blocked or timed out: fall through */
		}
	}
	if (cached) return book(cached.table, 'stale-cache', cached.mtime);
	return loadSnapshot(opts.snapshotPath);
}
