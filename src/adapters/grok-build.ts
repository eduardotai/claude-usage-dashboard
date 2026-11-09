/**
 * Grok Build (xAI's coding agent CLI) adapter.
 *
 * Layout: `$GROK_HOME/sessions/<url-encoded-cwd>/<session-id>/updates.jsonl` (+ optional
 * `summary.json` with `info.{id,cwd}` and `current_model_id`). GROK_HOME defaults to `~/.grok`.
 *
 * Only `turn_completed` updates carry billable usage:
 *   {"timestamp": <unix seconds>, "method": "_x.ai/session/update",
 *    "params": {"sessionId": "...",
 *               "update": {"sessionUpdate": "turn_completed",
 *                          "usage": {"inputTokens", "outputTokens", "cachedReadTokens",
 *                                    "cacheCreationTokens"?, "reasoningTokens", "totalTokens",
 *                                    "costUsdTicks"?, "modelCalls"?,
 *                                    "modelUsage": {"<model>": {same fields}}}},
 *               "_meta": {"eventId": "...", "agentTimestampMs"?: <ms>}}}
 *
 * Sources (read 2026-11-09): ccusage Grok guide (ccusage.com/guide/grok) and parser
 * (github.com/ccusage/ccusage rust/adapters/grok/src/parser.rs, incl. its fixtures);
 * TokenTracker issue #362 (real `turn_completed` sample; `_meta.totalTokens` on stream events is
 * context-window occupancy, NOT spend, so we ignore it); tokscale issue #1387 (`modelCalls`).
 *
 * Rules:
 * - `inputTokens` INCLUDES `cachedReadTokens` (and `cacheCreationTokens`): split them out.
 * - `reasoningTokens` are a subset of `outputTokens`: not added again.
 * - `costUsdTicks` is the price Grok recorded for the turn, in 1e-10 USD. When present we use it
 *   (cost provenance `measured`); otherwise we estimate from LiteLLM.
 * - A turn aggregates several model calls (`modelCalls`); `calls` reflects that.
 * - In-progress or killed turns never write `turn_completed`, so their usage is not on disk.
 * - Dedupe on session id + `_meta.eventId` (event ids are per session).
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { findFiles, isDirectory, projectNameFromPath, readLines } from './fs.js';
import { emptyStats, type Adapter, type AdapterResult, type RawUsageRecord } from '../core/types.js';

export function grokHome(env: NodeJS.ProcessEnv = process.env): string {
	const v = env.GROK_HOME?.trim();
	return v ? resolve(v.replace(/^~(?=$|[\\/])/, homedir())) : join(homedir(), '.grok');
}

/** `grok-4.5-build` / `grok-4.5-build-free` are Grok Build's names for public `grok-4.5`. */
export function grokPricingModel(model: string): string | undefined {
	const m = model.replace(/^\[grok\]\s*/, '').trim();
	const base = m.replace(/-build(-free)?$/, '');
	return base !== model ? base : undefined;
}

interface GrokTokens {
	inputTokens?: number;
	outputTokens?: number;
	cachedReadTokens?: number;
	cacheCreationTokens?: number;
	costUsdTicks?: number;
	modelCalls?: number;
}
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

interface Summary {
	info?: { id?: string; cwd?: string };
	current_model_id?: string;
}

export async function parseGrokUpdates(
	file: string,
	seen: Set<string>,
	stats = emptyStats()
): Promise<RawUsageRecord[]> {
	let summary: Summary = {};
	try {
		summary = JSON.parse(await readFile(join(dirname(file), 'summary.json'), 'utf8')) as Summary;
	} catch {
		/* optional */
	}
	const sessionDir = basename(dirname(file));
	let encodedCwd = basename(dirname(dirname(file)));
	try {
		encodedCwd = decodeURIComponent(encodedCwd);
	} catch {
		/* keep raw */
	}
	const project = projectNameFromPath(summary.info?.cwd) ?? projectNameFromPath(encodedCwd) ?? 'unknown';
	const out: RawUsageRecord[] = [];

	for await (const line of readLines(file)) {
		if (!line.trim()) continue;
		stats.lines++;
		if (!line.includes('"turn_completed"')) continue;
		let obj: any;
		try {
			obj = JSON.parse(line);
		} catch {
			stats.malformedLines++;
			continue;
		}
		const params = obj?.params;
		const update = params?.update;
		if (update?.sessionUpdate !== 'turn_completed' || !update.usage) continue;
		const usage = update.usage as GrokTokens & { modelUsage?: Record<string, GrokTokens> };

		const session: string = params?.sessionId || summary.info?.id || sessionDir;
		const eventId: string | undefined = params?._meta?.eventId;
		if (eventId) {
			const key = `${session}\u0000${eventId}`;
			if (seen.has(key)) {
				stats.duplicatesDropped++;
				continue;
			}
			seen.add(key);
		}
		const ms = n(params?._meta?.agentTimestampMs) || n(obj.timestamp) * 1000;
		if (!ms) {
			stats.malformedLines++; // no usable time: don't invent one
			continue;
		}
		const perModel: [string, GrokTokens][] =
			usage.modelUsage && Object.keys(usage.modelUsage).length
				? Object.entries(usage.modelUsage)
				: [[summary.current_model_id || 'unknown', usage]];
		const totalCalls = n(usage.modelCalls) || 1;

		perModel.forEach(([model, u], i) => {
			const input = n(u.inputTokens);
			const cacheRead = Math.min(n(u.cachedReadTokens), input);
			const cacheWrite = Math.min(n(u.cacheCreationTokens), input - cacheRead);
			// Prefer per-model ticks; use the turn's ticks only when there is a single model.
			const ticks = n(u.costUsdTicks) || (perModel.length === 1 ? n(usage.costUsdTicks) : 0);
			const rec: RawUsageRecord = {
				agent: 'grok-build',
				project,
				session,
				model,
				pricingModel: grokPricingModel(model),
				timestamp: ms,
				inputTokens: input - cacheRead - cacheWrite,
				outputTokens: n(u.outputTokens),
				cacheReadTokens: cacheRead,
				cacheWriteTokens: cacheWrite,
				cacheWrite1hTokens: 0,
				sidechain: false,
				tokens: 'measured',
				// Attribute the turn's call count to its first model; others count as 1 if present.
				calls: n(u.modelCalls) || (i === 0 ? totalCalls : 1),
				reportedCostUsd: ticks ? ticks / 1e10 : null
			};
			if (rec.inputTokens + rec.outputTokens + rec.cacheReadTokens + rec.cacheWriteTokens > 0) out.push(rec);
		});
	}
	return out;
}

export function createGrokBuildAdapter(env: NodeJS.ProcessEnv = process.env): Adapter {
	return {
		id: 'grok-build',
		label: 'Grok Build',
		status: 'available',
		source: 'Session updates (JSONL), one turn_completed per turn',
		dataPaths: () => [join(grokHome(env), 'sessions')],
		async load(): Promise<AdapterResult> {
			const stats = emptyStats();
			const records: RawUsageRecord[] = [];
			const root = join(grokHome(env), 'sessions');
			if (!(await isDirectory(root))) return { records, stats };
			const seen = new Set<string>();
			const files = (await findFiles(root, '.jsonl')).filter((f) => basename(f) === 'updates.jsonl');
			for (const f of files) {
				stats.files++;
				try {
					records.push(...(await parseGrokUpdates(f, seen, stats)));
				} catch {
					/* skip unreadable */
				}
			}
			stats.records = records.length;
			return { records, stats };
		}
	};
}
