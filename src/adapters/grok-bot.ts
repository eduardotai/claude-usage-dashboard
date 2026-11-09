/**
 * Grok Bot and other grok.com products, from the Grok unified usage export
 * (see ./grok-unified.ts for the format and how it was verified).
 *
 * - `grok-bot` rows -> agent "Grok Bot". Grok Bot runs in the cloud and keeps no local logs, so
 *   the export is the only source. Rows carry no model id.
 * - `grok-chat`, `grok-voice`, `grok-imagine` (and any other non-Cursor product) -> "Grok apps".
 *   Voice (audio seconds) and Imagine (images) have no tokens: they count as calls with tokens
 *   `unavailable`.
 * - `cursor` rows are handled by the Cursor adapter.
 *
 * Costs: `Pricing Contracted` is what xAI actually charged -> `billedUsd` (measured; $0 for
 * plan-included usage). The API-equivalent estimate needs a model:
 * - rows with a model (grok-chat) are priced from LiteLLM as usual;
 * - Grok Bot rows have none. `finalize` looks at the export's own on-demand charges and checks
 *   which xAI list prices reproduce every one of them exactly. If they all point to one rate
 *   card, Grok Bot is estimated at that rate (labelled in the UI); otherwise its estimate stays
 *   `unavailable`. No guessing from model names.
 */
import type { PriceBook } from '../pricing/litellm.js';
import type { Adapter, AdapterResult, AgentId, RawUsageRecord } from '../core/types.js';
import { grokUnifiedSources, loadGrokUnified, type GrokUnifiedOptions, type GrokUnifiedRow } from './grok-unified.js';

export const GROK_EXPORT_PROJECT = '(grok.com export)';
export const GROK_BOT_MODEL = 'grok-bot (model not logged)';

export function unifiedRowToRecord(row: GrokUnifiedRow, agent: AgentId, project: string): RawUsageRecord {
	const t = row.tokens;
	const model = row.model || (agent === 'grok-bot' ? GROK_BOT_MODEL : row.product);
	const rec: RawUsageRecord = {
		agent,
		project,
		session: `grok-export:${row.product}`,
		model,
		timestamp: row.timestamp,
		inputTokens: t?.input ?? 0,
		outputTokens: t?.output ?? 0,
		cacheReadTokens: t?.cacheRead ?? 0,
		cacheWriteTokens: t?.cacheWrite ?? 0,
		cacheWrite1hTokens: 0,
		sidechain: false,
		tokens: 'measured',
		calls: 1,
		billedUsd: row.billedUsd
	};
	// A token row whose counts are all 0 is a measured zero (the bill says so), not missing data.
	if (!t) rec.tokens = 'unavailable';
	return rec;
}

/**
 * Which xAI price card reproduces every billed row? Returns the chosen key (or null) and all
 * keys with that same card.
 */
export function matchBilledRate(records: RawUsageRecord[], prices: PriceBook): { key: string | null; matches: string[]; billed: number; reason?: string } {
	const billed = records.filter((r) => r.tokens === 'measured' && typeof r.billedUsd === 'number' && r.billedUsd > 0);
	if (!billed.length) return { key: null, matches: [], billed: 0, reason: 'no on-demand charges in the export' };
	const cards = new Map<string, string[]>();
	for (const key of prices.keys()) {
		if (!key.startsWith('xai/')) continue;
		const ok = billed.every((r) => {
			const c = prices.cost({ ...r, model: key });
			return c !== null && Math.abs(c - r.billedUsd!) <= Math.max(1e-6, r.billedUsd! * 0.005);
		});
		if (!ok) continue;
		const entry = prices.resolve(key)!.entry;
		const card = JSON.stringify(Object.entries(entry).filter(([k]) => k.includes('cost')).sort());
		cards.set(card, [...(cards.get(card) ?? []), key]);
	}
	if (cards.size !== 1) return { key: null, matches: [...cards.values()].flat(), billed: billed.length, reason: cards.size ? 'charges match several different xAI rates' : 'charges match no xAI list price' };
	const matches = [...cards.values()][0]!.sort((a, b) => a.length - b.length || b.localeCompare(a, 'en', { numeric: true }));
	return { key: matches[0]!, matches, billed: billed.length };
}

function unifiedAdapter(
	id: AgentId,
	label: string,
	source: string,
	pick: (row: GrokUnifiedRow) => boolean,
	env: NodeJS.ProcessEnv,
	opts: GrokUnifiedOptions,
	extra: Partial<Adapter> = {}
): Adapter {
	return {
		id,
		label,
		status: 'available',
		source,
		dataPaths: () => grokUnifiedSources(env, opts),
		async load(): Promise<AdapterResult> {
			const { rows, stats } = await loadGrokUnified(env, opts);
			const records = rows.filter(pick).map((r) => unifiedRowToRecord(r, id, GROK_EXPORT_PROJECT));
			return { records, stats: { ...stats, records: records.length } };
		},
		...extra
	};
}

export function createGrokBotAdapter(env: NodeJS.ProcessEnv = process.env, opts: GrokUnifiedOptions = {}): Adapter {
	return unifiedAdapter('grok-bot', 'Grok Bot', 'grok.com usage export (CSV), product grok-bot', (r) => r.product === 'grok-bot', env, opts, {
		note: 'Grok Bot runs in the cloud and keeps no local logs. Export your usage at grok.com/dashboard → Usage and drop the CSV into ~/.agentburn/imports/grok/.',
		finalize(records, prices) {
			const unmodelled = records.filter((r) => r.model === GROK_BOT_MODEL);
			if (!unmodelled.length) return [];
			const m = matchBilledRate(unmodelled, prices);
			if (!m.key) return [`Grok Bot rows have no model, so their API-equivalent cost is unavailable (${m.reason}).`];
			for (const r of unmodelled) r.pricingModel = m.key;
			const also = m.matches.length > 1 ? ` (same rate as ${m.matches.slice(1, 4).join(', ')})` : '';
			return [
				`Grok Bot rows have no model. Their API-equivalent cost uses ${m.key} list prices${also}, which exactly reproduce the ${m.billed} on-demand ${m.billed === 1 ? 'charge' : 'charges'} in your export.`
			];
		}
	});
}

const GROK_APPS = (r: GrokUnifiedRow) => r.product !== 'grok-bot' && r.product !== 'cursor';

export function createGrokAppsAdapter(env: NodeJS.ProcessEnv = process.env, opts: GrokUnifiedOptions = {}): Adapter {
	return unifiedAdapter('grok-apps', 'Grok apps', 'grok.com usage export (CSV): chat, voice, imagine', GROK_APPS, env, opts, {
		note: 'Grok chat, voice and imagine from the grok.com usage export. Voice seconds and generated images are counted as calls, without tokens.'
	});
}

