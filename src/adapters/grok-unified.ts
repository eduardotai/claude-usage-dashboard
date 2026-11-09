/**
 * Grok "unified usage" export: the account-wide CSV from grok.com/dashboard → Usage → Export.
 * Under the X Subscription it lists every billable event across products (Grok Bot, Cursor,
 * Grok chat/voice/imagine). Read-only import: drop it in ~/.agentburn/imports/grok/ or pass
 * --grok-csv. AgentBurn never downloads it.
 *
 * Header (verified on a real export, 2026-11-09; columns are resolved by name):
 *   Billing Item ID,Event Time,Product,Charge Category,Usage Type,Principal Type,Principal ID,
 *   Usage,Pricing Currency,Pricing Contracted,Model,User Email
 *
 * - `Usage` is a JSON object of string counts. Token products use
 *   `prompt-text-tokens`, `cached-prompt-text-tokens`, `cache-write-text-tokens`,
 *   `completion-text-tokens` (grok-chat spells them "Prompt text tokens" etc.; we normalize).
 *   Other products use units we don't model (`Audio seconds`, `Generated image`).
 * - The four token counts are DISJOINT buckets, unlike OpenAI-style logs: on the real export
 *   ~90% of Grok Bot rows have cached > prompt (e.g. prompt 2, cached 130k), and the on-demand
 *   charges equal exactly prompt×input + cached×cache-read + cache-write×input +
 *   completion×output at xAI's list price. So prompt = uncached input.
 * - `Usage Type` is `included` (inside the plan, charged $0) or `on_demand`; `Pricing
 *   Contracted` is what was actually charged in `Pricing Currency` (USD).
 * - `Model` is empty for Grok Bot (and voice/imagine) rows.
 * - `User Email` and `Principal ID` are personal; AgentBurn never reads them.
 */
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { findFiles } from './fs.js';
import { parseCount, parseCsv } from './csv.js';
import { emptyStats, type AdapterScanStats } from '../core/types.js';

export interface GrokUnifiedOptions {
	/** Export files or folders, in addition to the default import dir. */
	csv?: string[];
}

export interface GrokUnifiedRow {
	id: string;
	timestamp: number;
	product: string;
	usageType: string;
	model: string;
	/** Disjoint token buckets; null when the row is not token-based. */
	tokens: { input: number; cacheRead: number; cacheWrite: number; output: number } | null;
	/** Non-token units, e.g. { "audio-seconds": 35 }. */
	units: Record<string, number>;
	/** Charged amount in USD, or null when not USD / missing. */
	billedUsd: number | null;
}

const expand = (p: string) => resolve(p.replace(/^~(?=$|[\\/])/, homedir()));

export function grokUnifiedSources(env: NodeJS.ProcessEnv = process.env, opts: GrokUnifiedOptions = {}): string[] {
	const fromEnv = (env.AGENTBURN_GROK_CSV ?? '').split(',').map((s) => s.trim()).filter(Boolean);
	const importDir = env.AGENTBURN_IMPORTS_DIR?.trim()
		? join(expand(env.AGENTBURN_IMPORTS_DIR.trim()), 'grok')
		: join(homedir(), '.agentburn', 'imports', 'grok');
	return [...new Set([...(opts.csv ?? []), ...fromEnv].map(expand).concat(importDir))];
}

const normKey = (k: string) => k.trim().toLowerCase().replace(/[\s_]+/g, '-');
const int = (v: unknown) => parseCount(String(v ?? ''));
/** "0.0291435" or a spreadsheet-localized "0,0291435" / "1.234,50" -> number. */
export function parseAmount(v: string | undefined): number {
	let t = String(v ?? '').trim().replace(/^\$|\s/g, '');
	if (!t) return NaN;
	if (t.includes(',') && (!t.includes('.') || t.lastIndexOf(',') > t.lastIndexOf('.'))) t = t.replace(/\./g, '').replace(',', '.');
	else t = t.replace(/,/g, '');
	return Number(t);
}

const TOKEN_KEYS = ['prompt-text-tokens', 'cached-prompt-text-tokens', 'cache-write-text-tokens', 'completion-text-tokens'];

export function parseGrokUnifiedCsv(text: string, stats: AdapterScanStats, seen: Set<string>): GrokUnifiedRow[] {
	const rows = parseCsv(text.replace(/^\uFEFF/, ''));
	if (!rows.length) return [];
	const header = rows[0]!.map((h) => h.trim().toLowerCase());
	const col = (n: string) => header.indexOf(n.toLowerCase());
	const c = {
		id: col('Billing Item ID'),
		time: col('Event Time'),
		product: col('Product'),
		usageType: col('Usage Type'),
		usage: col('Usage'),
		currency: col('Pricing Currency'),
		charged: col('Pricing Contracted'),
		model: col('Model')
	};
	if (c.time < 0 || c.product < 0 || c.usage < 0) {
		stats.malformedLines += rows.length; // not a Grok usage export
		return [];
	}
	const out: GrokUnifiedRow[] = [];
	for (const r of rows.slice(1)) {
		stats.lines++;
		const ts = Date.parse(r[c.time] ?? '');
		let usage: Record<string, unknown>;
		try {
			usage = JSON.parse(r[c.usage] || '{}');
			if (!usage || typeof usage !== 'object') throw new Error('not an object');
		} catch {
			stats.malformedLines++;
			continue;
		}
		if (Number.isNaN(ts)) {
			stats.malformedLines++;
			continue;
		}
		const u = Object.fromEntries(Object.entries(usage).map(([k, v]) => [normKey(k), int(v)]));
		const isTokens = TOKEN_KEYS.some((k) => k in u);
		const units = Object.fromEntries(Object.entries(u).filter(([k]) => !TOKEN_KEYS.includes(k)));
		const id = (c.id >= 0 && r[c.id]?.trim()) || [r[c.time], r[c.product], r[c.model] ?? '', r[c.usage]].join('|');
		if (seen.has(id)) {
			stats.duplicatesDropped++; // overlapping exports
			continue;
		}
		seen.add(id);
		const currency = c.currency >= 0 ? (r[c.currency] ?? '').trim().toUpperCase() : 'USD';
		const charged = c.charged >= 0 ? parseAmount(r[c.charged]) : NaN;
		out.push({
			id,
			timestamp: ts,
			product: (r[c.product] ?? '').trim().toLowerCase() || 'unknown',
			usageType: c.usageType >= 0 ? (r[c.usageType] ?? '').trim().toLowerCase() : '',
			model: (c.model >= 0 ? r[c.model] ?? '' : '').trim(),
			tokens: isTokens
				? {
						input: u['prompt-text-tokens'] ?? 0,
						cacheRead: u['cached-prompt-text-tokens'] ?? 0,
						cacheWrite: u['cache-write-text-tokens'] ?? 0,
						output: u['completion-text-tokens'] ?? 0
					}
				: null,
			units,
			billedUsd: (currency === 'USD' || currency === '') && Number.isFinite(charged) ? charged : null
		});
	}
	return out;
}

/** Read every export under the given sources. Rows are deduped by Billing Item ID. */
export async function loadGrokUnified(env: NodeJS.ProcessEnv = process.env, opts: GrokUnifiedOptions = {}) {
	const stats = emptyStats();
	const seen = new Set<string>();
	const rows: GrokUnifiedRow[] = [];
	for (const src of grokUnifiedSources(env, opts)) {
		const st = await stat(src).catch(() => null);
		const files = !st ? [] : st.isDirectory() ? await findFiles(src, '.csv') : [src];
		for (const f of files.sort()) {
			stats.files++;
			try {
				rows.push(...parseGrokUnifiedCsv(await readFile(f, 'utf8'), stats, seen));
			} catch {
				stats.malformedLines++;
			}
		}
	}
	return { rows, stats };
}
