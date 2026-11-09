/**
 * Codex CLI adapter.
 *
 * Codex writes one "rollout" per session: `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl`
 * (archived ones under `archived_sessions/`, optionally zstd-compressed as `.jsonl.zst`).
 * Every line is `{ timestamp, type, payload }`. The lines we use:
 *
 *   session_meta   payload.{id, cwd, forked_from_id?, source}      (once, at the top)
 *   turn_context   payload.{model, cwd}                            (model in effect for later usage)
 *   event_msg      payload.type == "token_count", payload.info.{total_token_usage, last_token_usage}
 *
 * `TokenUsage` = { input_tokens, cached_input_tokens, cache_write_input_tokens?, output_tokens,
 * reasoning_output_tokens, total_tokens }.
 * Source: openai/codex `codex-rs/protocol/src/protocol.rs` (structs SessionMeta, TurnContextItem,
 * TokenUsage, TokenUsageInfo, TokenCountEvent), read 2026-11-09.
 *
 * Accounting rules (see README "How counting works"):
 *
 * 1. Running totals. `total_token_usage` is cumulative per session. Codex re-emits `token_count`
 *    with an UNCHANGED total (UI / rate-limit refreshes), so summing `last_token_usage` per event
 *    overcounts. We count an event only when the cumulative total advances, and count the
 *    difference to the previous total. Refs: ccusage issues #876, #884, #1288
 *    (github.com/ccusage/ccusage/issues/1288 measured a ~67% overstatement on real data).
 * 2. Totals that go DOWN (a resumed or compacted session restarting its counter) start a new
 *    baseline; that event contributes its own `last_token_usage`.
 * 3. Forks / subagents (`session_meta.forked_from_id`) replay the parent's history as a dense
 *    burst of `token_count` events at the fork instant. That usage was already counted in the
 *    parent, so the leading burst (events < 1s apart, starting within 1s of the session start)
 *    only sets the baseline. Same heuristic as ccusage's `detect_rewritten_burst`
 *    (rust/adapters/codex/src/parser.rs, which measured bursts of 10–40ms followed by 5–15s pauses).
 * 4. Cache. OpenAI-style: `cached_input_tokens` (and `cache_write_input_tokens`) are INSIDE
 *    `input_tokens`. We split them out so input + cache read + cache write == input_tokens.
 *    Reasoning tokens are inside `output_tokens` and are not added again.
 * 5. Duplicates: archiving moves a rollout from `sessions/YYYY/MM/DD/` to `archived_sessions/`
 *    (and may compress it), so the same session can briefly exist twice. Rollout file names are
 *    unique (`rollout-<timestamp>-<session uuid>`), so within one CODEX_HOME we key on the
 *    file name: `sessions/` beats `archived_sessions/`, plain `.jsonl` beats `.jsonl.zst`.
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import * as zlib from 'node:zlib';
import { findFiles, isDirectory, projectNameFromPath, readLines } from './fs.js';
import { emptyStats, type Adapter, type AdapterResult, type RawUsageRecord } from '../core/types.js';

export function codexHomes(env: NodeJS.ProcessEnv = process.env): string[] {
	const v = env.CODEX_HOME?.trim();
	const list = v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [join(homedir(), '.codex')];
	return list.map((p) => resolve(p.replace(/^~(?=$|[\\/])/, homedir())));
}

interface Usage {
	input_tokens?: number;
	cached_input_tokens?: number;
	cache_write_input_tokens?: number;
	output_tokens?: number;
	reasoning_output_tokens?: number;
	total_tokens?: number;
}
const FIELDS = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'] as const;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
const norm = (u: Usage | undefined | null): Required<Usage> | null =>
	u && typeof u === 'object' ? (Object.fromEntries(FIELDS.map((f) => [f, num(u[f])])) as Required<Usage>) : null;
const same = (a: Required<Usage>, b: Required<Usage>) => FIELDS.every((f) => a[f] === b[f]);
const grew = (a: Required<Usage>, prev: Required<Usage>) => FIELDS.every((f) => a[f] >= prev[f]);
const minus = (a: Required<Usage>, b: Required<Usage>) =>
	Object.fromEntries(FIELDS.map((f) => [f, a[f] - b[f]])) as Required<Usage>;

const BURST_MS = 1000;

async function* fileLines(file: string, stats: { skippedFiles: number }): AsyncGenerator<string> {
	if (!file.endsWith('.zst')) {
		yield* readLines(file);
		return;
	}
	const zstd = (zlib as unknown as { zstdDecompressSync?: (b: Buffer) => Buffer }).zstdDecompressSync;
	if (!zstd) {
		stats.skippedFiles++; // Node < 22.15 has no zstd; reported in the UI
		return;
	}
	const text = zstd(await readFile(file)).toString('utf8');
	yield* text.split('\n');
}

/** Parse one rollout file into usage records (one per counted token_count event). */
export async function parseCodexRollout(file: string, stats = emptyStats()): Promise<RawUsageRecord[]> {
	const out: RawUsageRecord[] = [];
	let session = basename(file).replace(/\.jsonl(\.zst)?$/, '').replace(/^rollout-/, '');
	let cwd: string | null = null;
	let model = 'unknown';
	let forked = false;
	let sidechain = false;
	let sessionStart: number | null = null;
	let prev: Required<Usage> | null = null;
	let inBurst = true; // only meaningful for forked sessions
	let lastBurstTs: number | null = null;

	for await (const line of fileLines(file, stats)) {
		if (!line.trim()) continue;
		stats.lines++;
		if (!line.includes('session_meta') && !line.includes('turn_context') && !line.includes('token_count')) continue;
		let obj: { timestamp?: string; type?: string; payload?: any };
		try {
			obj = JSON.parse(line);
		} catch {
			stats.malformedLines++;
			continue;
		}
		const p = obj.payload ?? {};
		const ts = obj.timestamp ? Date.parse(obj.timestamp) : NaN;

		if (obj.type === 'session_meta') {
			if (typeof p.id === 'string') session = p.id;
			if (typeof p.cwd === 'string') cwd = p.cwd;
			forked = typeof p.forked_from_id === 'string' && p.forked_from_id.length > 0;
			sidechain = forked || (p.source && typeof p.source === 'object' && 'subagent' in p.source);
			const st = Date.parse(p.timestamp ?? obj.timestamp ?? '');
			sessionStart = Number.isNaN(st) ? null : st;
			continue;
		}
		if (obj.type === 'turn_context') {
			if (typeof p.model === 'string' && p.model) model = p.model;
			if (typeof p.cwd === 'string' && !cwd) cwd = p.cwd;
			continue;
		}
		if (obj.type !== 'event_msg' || p.type !== 'token_count') continue;
		const total = norm(p.info?.total_token_usage);
		const last = norm(p.info?.last_token_usage);
		if (!total && !last) continue; // rate-limit-only event (info: null)

		// Fork replay: the leading dense burst re-states the parent's usage.
		if (forked && inBurst && !Number.isNaN(ts)) {
			const startsAtFork = sessionStart === null || Math.abs(ts - sessionStart) <= BURST_MS;
			const dense = lastBurstTs === null ? startsAtFork : ts - lastBurstTs <= BURST_MS;
			if (dense) {
				lastBurstTs = ts;
				if (total) prev = total;
				stats.duplicatesDropped++;
				continue;
			}
		}
		inBurst = false;

		let delta: Required<Usage> | null;
		if (total) {
			if (prev && same(total, prev)) {
				stats.duplicatesDropped++; // re-emitted snapshot: no new usage
				continue;
			}
			delta = prev && grew(total, prev) ? minus(total, prev) : (last ?? total);
			prev = total;
		} else {
			delta = last; // very old builds without cumulative totals
		}
		if (!delta || Number.isNaN(ts)) {
			if (Number.isNaN(ts)) stats.malformedLines++;
			continue;
		}
		const cached = Math.min(delta.cached_input_tokens, delta.input_tokens);
		const write = Math.min(delta.cache_write_input_tokens, delta.input_tokens - cached);
		const rec: RawUsageRecord = {
			agent: 'codex',
			project: projectNameFromPath(cwd) ?? 'unknown',
			session,
			model,
			timestamp: ts,
			inputTokens: delta.input_tokens - cached - write,
			outputTokens: delta.output_tokens,
			cacheReadTokens: cached,
			cacheWriteTokens: write,
			cacheWrite1hTokens: 0,
			sidechain,
			tokens: 'measured',
			calls: 1
		};
		if (rec.inputTokens + rec.outputTokens + rec.cacheReadTokens + rec.cacheWriteTokens > 0) out.push(rec);
	}
	return out;
}

/** Rollout files across homes, applying the sessions > archived and .jsonl > .jsonl.zst rules. */
export async function findCodexRollouts(homes: string[]): Promise<string[]> {
	const files: string[] = [];
	for (const home of homes) {
		const chosen = new Map<string, string>(); // file name without .zst -> file
		let anyDir = false;
		for (const sub of ['sessions', 'archived_sessions']) {
			const dir = join(home, sub);
			if (!(await isDirectory(dir))) continue;
			anyDir = true;
			const found = [...(await findFiles(dir, '.jsonl')), ...(await findFiles(dir, '.jsonl.zst'))].filter((f) =>
				basename(f).startsWith('rollout-')
			);
			// plain files first so they win over .zst twins
			found.sort((a, b) => Number(a.endsWith('.zst')) - Number(b.endsWith('.zst')) || a.localeCompare(b));
			for (const f of found) {
				const key = basename(f).replace(/\.zst$/, '');
				if (!chosen.has(key)) chosen.set(key, f); // sessions/ is scanned first, so it wins
			}
		}
		if (anyDir) files.push(...[...chosen.values()].sort());
	}
	return files;
}

export function createCodexAdapter(env: NodeJS.ProcessEnv = process.env): Adapter {
	return {
		id: 'codex',
		label: 'Codex CLI',
		status: 'available',
		source: 'Session rollouts (JSONL), cumulative token_count events',
		dataPaths: () => codexHomes(env).flatMap((h) => [join(h, 'sessions'), join(h, 'archived_sessions')]),
		async load(): Promise<AdapterResult> {
			const stats = emptyStats();
			const records: RawUsageRecord[] = [];
			for (const f of await findCodexRollouts(codexHomes(env))) {
				stats.files++;
				try {
					records.push(...(await parseCodexRollout(f, stats)));
				} catch {
					/* unreadable file: skip */
				}
			}
			stats.records = records.length;
			stats.sidechainRecords = records.filter((r) => r.sidechain).length;
			const warnings = stats.skippedFiles
				? [`${stats.skippedFiles} compressed (.zst) rollouts skipped: this Node version has no zstd support (needs Node 22.15+).`]
				: [];
			return { records, stats, warnings };
		}
	};
}
