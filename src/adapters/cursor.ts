/**
 * Cursor adapter. Two sources, best first:
 *
 * 1. Usage CSV export (authoritative tokens). Exported from the usage dashboard: one row per
 *    model call. Header (resolved by NAME, Cursor adds columns over time), e.g.
 *      Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost
 *    newer: Date,User,Cloud Agent ID,Automation ID,Kind,Model,...
 *    "Input (w/ Cache Write)" is the cache-WRITE count on its own; "Input (w/o Cache Write)" is
 *    plain input; the four buckets are disjoint and sum to Total Tokens.
 *    Sources (read 2026-11-09): whospentit.com/blog/cursor-usage-csv-export (verified 601-row header),
 *    docs.rs/tokmesh-core sessions::cursor (v1/v2/v3 headers), github.com/miiiiiiich/agent-walker docs/cursor.md.
 *    AgentBurn never downloads it for you (that needs your Cursor session token); you export it
 *    and drop it in ~/.agentburn/imports/cursor/ (or pass --cursor-csv).
 *    Rows have no project/session: they show as project "(cursor export)".
 *
 * 2. Local state DB, read-only, as a fallback for calls the CSV does not cover:
 *    `<Cursor User dir>/globalStorage/state.vscdb`, table `cursorDiskKV`:
 *      composerData:<composerId>              -> { createdAt, modelConfig.modelName, fullConversationHeadersOnly[] }
 *      bubbleId:<composerId>:<bubbleId>       -> { type: 1 user | 2 assistant, createdAt?, tokenCount: {inputTokens, outputTokens} }
 *    and per-workspace `workspaceStorage/<id>/{workspace.json, state.vscdb}` (ItemTable
 *    `composer.composerData` -> allComposers[].composerId) to map conversations to projects.
 *    Sources: docs.rs/skiagram-core adapters::cursor (schema verified on real data 2026-06-16),
 *    github.com/pppp606/cursor-efficiency docs/vscdbRelation.md (paths per OS, key layout).
 *    Cursor staff confirm `tokenCount` is best-effort and usually 0/0
 *    (forum.cursor.com/t/155984). So each user request becomes one call; when its tokens are
 *    0/0 they are marked `unavailable` (never 0) and only the call is counted.
 *    Needs `node:sqlite` (Node 22.5+); the DB is copied to a temp dir first, never opened in place.
 *
 * 3. Cursor rows of the Grok unified usage export (X Subscription; see ./grok-unified.ts). Same
 *    token buckets, no Max Mode/Kind detail, plus the amount actually charged.
 *
 * Precedence when sources overlap in time: Cursor CSV > Grok export > local DB. A lower source's
 * rows are dropped inside the time span covered by a higher source's rows (rows can't be matched
 * one-to-one: the two exports round timestamps differently and the DB has no request ids that
 * appear in either).
 */
import { copyFile, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findFiles, isDirectory, projectNameFromPath } from './fs.js';
import { parseCsv } from './csv.js';
import { grokUnifiedSources, loadGrokUnified } from './grok-unified.js';
import { emptyStats, type Adapter, type AdapterResult, type AdapterScanStats, type RawUsageRecord } from '../core/types.js';

export interface CursorOptions {
	/** CSV files or directories with CSVs (in addition to the default import dir). */
	csv?: string[];
	/** Grok unified usage exports, whose `cursor` rows are Cursor usage. */
	grokCsv?: string[];
}

const expand = (p: string) => resolve(p.replace(/^~(?=$|[\\/])/, homedir()));

/** Cursor's `User` directory per OS (override with CURSOR_USER_DIR). */
export function cursorUserDir(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string {
	if (env.CURSOR_USER_DIR?.trim()) return expand(env.CURSOR_USER_DIR.trim());
	if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Cursor', 'User');
	if (platform === 'win32') return join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Cursor', 'User');
	return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'Cursor', 'User');
}

export function cursorCsvSources(env: NodeJS.ProcessEnv = process.env, opts: CursorOptions = {}): string[] {
	const fromEnv = (env.AGENTBURN_CURSOR_CSV ?? '').split(',').map((s) => s.trim()).filter(Boolean);
	const importDir = env.AGENTBURN_IMPORTS_DIR?.trim()
		? join(expand(env.AGENTBURN_IMPORTS_DIR.trim()), 'cursor')
		: join(homedir(), '.agentburn', 'imports', 'cursor');
	return [...new Set([...(opts.csv ?? []), ...fromEnv].map(expand).concat(importDir))];
}

// --- Model aliases (exact renames only; no family guessing) ----------------

/**
 * Cursor names Claude models family-last (`claude-4.5-sonnet`) and adds `-thinking[-effort]`
 * (thinking is billed as output at the same rate). Map those to the API id. Cursor's own
 * models (composer-*, cursor-grok-*, "default"/"auto") have no public per-token price and stay
 * unpriced, which the UI flags.
 */
export function cursorPricingModel(model: string): string | undefined {
	let m = model.trim().toLowerCase();
	m = m.replace(/-thinking(-(low|medium|high|xhigh|max))?$/, '');
	const flip = m.match(/^claude-(\d+(?:\.\d+)?)-(opus|sonnet|haiku)$/);
	if (flip) m = `claude-${flip[2]}-${flip[1]!.replace('.', '-')}`;
	return m !== model ? m : undefined;
}

// --- CSV --------------------------------------------------------------------

export { parseCsv };

const toInt = (v: string | undefined) => {
	const x = Number(String(v ?? '').replace(/[, ]/g, ''));
	return Number.isFinite(x) && x > 0 ? Math.round(x) : 0;
};

export function parseCursorCsv(text: string, stats: AdapterScanStats, seen: Set<string>): RawUsageRecord[] {
	const rows = parseCsv(text.replace(/^\uFEFF/, ''));
	if (!rows.length) return [];
	const header = rows[0]!.map((h) => h.trim().toLowerCase());
	const col = (name: string) => header.indexOf(name.toLowerCase());
	const c = {
		date: col('Date'),
		model: col('Model'),
		kind: col('Kind'),
		cacheWrite: col('Input (w/ Cache Write)'),
		input: col('Input (w/o Cache Write)'),
		cacheRead: col('Cache Read'),
		output: col('Output Tokens'),
		cloudAgent: col('Cloud Agent ID')
	};
	if (c.date < 0 || c.model < 0 || (c.input < 0 && c.output < 0)) {
		stats.malformedLines += rows.length; // not a Cursor usage export
		return [];
	}
	const out: RawUsageRecord[] = [];
	for (const r of rows.slice(1)) {
		stats.lines++;
		const ts = Date.parse(r[c.date] ?? '');
		if (Number.isNaN(ts)) {
			stats.malformedLines++;
			continue;
		}
		const model = (r[c.model] ?? '').trim() || 'unknown';
		const rec: RawUsageRecord = {
			agent: 'cursor',
			project: '(cursor export)',
			session: c.cloudAgent >= 0 && r[c.cloudAgent] ? `cloud-agent:${r[c.cloudAgent]}` : 'cursor-export',
			model,
			pricingModel: cursorPricingModel(model),
			timestamp: ts,
			inputTokens: toInt(r[c.input]),
			outputTokens: toInt(r[c.output]),
			cacheReadTokens: toInt(r[c.cacheRead]),
			cacheWriteTokens: toInt(r[c.cacheWrite]),
			cacheWrite1hTokens: 0,
			sidechain: false,
			tokens: 'measured',
			calls: 1
		};
		const sum = rec.inputTokens + rec.outputTokens + rec.cacheReadTokens + rec.cacheWriteTokens;
		if (sum === 0) rec.tokens = 'unavailable'; // e.g. errored rows: count the call, not fake zeros
		// Overlapping exports (possibly from different header versions) repeat rows: dedupe on
		// columns every version has.
		const key = [ts, model, rec.inputTokens, rec.outputTokens, rec.cacheReadTokens, rec.cacheWriteTokens].join('|');
		if (seen.has(key)) {
			stats.duplicatesDropped++;
			continue;
		}
		seen.add(key);
		out.push(rec);
	}
	return out;
}

// --- state.vscdb -------------------------------------------------------------

type Db = { prepare(sql: string): { all(...a: unknown[]): unknown[] }; close(): void };

async function openSqliteCopy(file: string): Promise<{ db: Db; cleanup: () => Promise<void> } | 'no-sqlite' | null> {
	let DatabaseSync: (new (path: string, opts?: object) => Db) | undefined;
	try {
		// createRequire: `node:sqlite` is missing on Node < 22.5, and bundlers mangle a dynamic import of it.
		({ DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: new (p: string, o?: object) => Db });
	} catch {
		return 'no-sqlite';
	}
	if (!(await stat(file).catch(() => null))) return null;
	const dir = await mkdtemp(join(tmpdir(), 'agentburn-cursor-'));
	const cleanup = () => rm(dir, { recursive: true, force: true });
	try {
		const copy = join(dir, 'state.vscdb');
		await copyFile(file, copy);
		for (const ext of ['-wal', '-shm']) await copyFile(file + ext, copy + ext).catch(() => {});
		return { db: new DatabaseSync(copy, { readOnly: true }), cleanup };
	} catch {
		await cleanup();
		return null;
	}
}

const tsOf = (v: unknown): number | null => {
	if (typeof v === 'number' && v > 1e11) return v;
	if (typeof v === 'string') {
		const t = Date.parse(v);
		return Number.isNaN(t) ? null : t;
	}
	return null;
};

/** composerId -> project name, from per-workspace DBs. */
async function workspaceProjects(userDir: string): Promise<Map<string, string>> {
	const map = new Map<string, string>();
	const wsRoot = join(userDir, 'workspaceStorage');
	let dirs: string[] = [];
	try {
		dirs = await readdir(wsRoot);
	} catch {
		return map;
	}
	for (const d of dirs) {
		let folder: string | null = null;
		try {
			const ws = JSON.parse(await readFile(join(wsRoot, d, 'workspace.json'), 'utf8'));
			const uri: string | undefined = ws.folder ?? ws.workspace;
			if (uri) folder = uri.startsWith('file:') ? fileURLToPath(uri) : decodeURIComponent(uri);
		} catch {
			continue;
		}
		const opened = await openSqliteCopy(join(wsRoot, d, 'state.vscdb'));
		if (!opened || opened === 'no-sqlite') continue;
		try {
			const row = opened.db.prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerData'").all()[0] as { value?: string } | undefined;
			const data = row?.value ? JSON.parse(String(row.value)) : null;
			const name = projectNameFromPath(folder) ?? 'unknown';
			for (const c of data?.allComposers ?? []) if (c?.composerId) map.set(c.composerId, name);
		} catch {
			/* ignore */
		} finally {
			opened.db.close();
			await opened.cleanup();
		}
	}
	return map;
}

export async function parseCursorStateDb(userDir: string, stats: AdapterScanStats): Promise<{ records: RawUsageRecord[]; warning?: string }> {
	const opened = await openSqliteCopy(join(userDir, 'globalStorage', 'state.vscdb'));
	if (opened === 'no-sqlite') return { records: [], warning: 'Cursor’s local database needs Node 22.5+ (node:sqlite). Import a usage CSV instead, or upgrade Node.' };
	if (!opened) return { records: [] };
	stats.files++;
	const projects = await workspaceProjects(userDir);
	const records: RawUsageRecord[] = [];
	try {
		const parse = (v: unknown) => {
			try {
				return JSON.parse(typeof v === 'string' ? v : Buffer.from(v as Uint8Array).toString('utf8'));
			} catch {
				stats.malformedLines++;
				return null;
			}
		};
		const bubbles = new Map<string, Map<string, any>>();
		for (const row of opened.db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'").all() as { key: string; value: unknown }[]) {
			stats.lines++;
			const [, composerId, bubbleId] = row.key.split(':');
			const b = parse(row.value);
			if (!composerId || !bubbleId || !b) continue;
			if (!bubbles.has(composerId)) bubbles.set(composerId, new Map());
			bubbles.get(composerId)!.set(bubbleId, b);
		}
		for (const row of opened.db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'").all() as { key: string; value: unknown }[]) {
			stats.lines++;
			const composerId = row.key.slice('composerData:'.length);
			const c = parse(row.value);
			if (!c) continue;
			const own = bubbles.get(composerId) ?? new Map<string, any>();
			const order: string[] = Array.isArray(c.fullConversationHeadersOnly)
				? c.fullConversationHeadersOnly.map((h: any) => h?.bubbleId).filter(Boolean)
				: [...own.keys()];
			const model = String(c.modelConfig?.modelName || 'default');
			const baseTs = tsOf(c.createdAt);
			let req: RawUsageRecord | null = null;
			const flush = () => {
				if (!req) return;
				req.tokens = req.inputTokens + req.outputTokens > 0 ? 'measured' : 'unavailable';
				records.push(req);
				req = null;
			};
			for (const id of order) {
				const b = own.get(id);
				if (!b) continue;
				const ts: number | null = tsOf(b.createdAt) ?? (req as RawUsageRecord | null)?.timestamp ?? baseTs;
				if (b.type === 1) {
					flush();
					if (ts === null) {
						stats.malformedLines++;
						continue;
					}
					req = {
						agent: 'cursor',
						project: projects.get(composerId) ?? 'unknown',
						session: composerId,
						model,
						pricingModel: cursorPricingModel(model),
						timestamp: ts,
						inputTokens: 0,
						outputTokens: 0,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						cacheWrite1hTokens: 0,
						sidechain: false,
						tokens: 'unavailable',
						calls: 1
					};
				} else if (b.type === 2 && req) {
					const r = req as RawUsageRecord;
					r.inputTokens += Math.max(0, Math.round(Number(b.tokenCount?.inputTokens) || 0));
					r.outputTokens += Math.max(0, Math.round(Number(b.tokenCount?.outputTokens) || 0));
				}
			}
			flush();
		}
	} finally {
		opened.db.close();
		await opened.cleanup();
	}
	return { records };
}

export function createCursorAdapter(env: NodeJS.ProcessEnv = process.env, opts: CursorOptions = {}): Adapter {
	return {
		id: 'cursor',
		label: 'Cursor',
		status: 'available',
		source: 'Usage CSV export or grok.com export (tokens) + local state.vscdb (requests)',
		dataPaths: () => [...cursorCsvSources(env, opts), ...grokUnifiedSources(env, { csv: opts.grokCsv }), join(cursorUserDir(env), 'globalStorage', 'state.vscdb')],
		async load(): Promise<AdapterResult> {
			const stats = emptyStats();
			const warnings: string[] = [];
			const seen = new Set<string>();
			const csvRecords: RawUsageRecord[] = [];
			for (const src of cursorCsvSources(env, opts)) {
				const st = await stat(src).catch(() => null);
				const files = !st ? [] : st.isDirectory() ? await findFiles(src, '.csv') : [src];
				for (const f of files) {
					stats.files++;
					try {
						csvRecords.push(...parseCursorCsv(await readFile(f, 'utf8'), stats, seen));
					} catch {
						stats.malformedLines++;
					}
				}
			}
			let dbRecords: RawUsageRecord[] = [];
			const userDir = cursorUserDir(env);
			if (await isDirectory(userDir)) {
				const res = await parseCursorStateDb(userDir, stats);
				dbRecords = res.records;
				if (res.warning) warnings.push(res.warning);
			}
			// Cursor rows from the Grok unified export (X Subscription).
			const grok = await loadGrokUnified(env, { csv: opts.grokCsv });
			stats.files += grok.stats.files;
			let grokRecords: RawUsageRecord[] = grok.rows
				.filter((r) => r.product === 'cursor')
				.map((r) => {
					const t = r.tokens ?? { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
					const model = r.model || 'unknown';
					const rec: RawUsageRecord = {
						agent: 'cursor',
						project: '(cursor export)',
						session: 'grok-export:cursor',
						model,
						pricingModel: cursorPricingModel(model),
						timestamp: r.timestamp,
						inputTokens: t.input,
						outputTokens: t.output,
						cacheReadTokens: t.cacheRead,
						cacheWriteTokens: t.cacheWrite,
						cacheWrite1hTokens: 0,
						sidechain: false,
						tokens: r.tokens ? 'measured' : 'unavailable',
						calls: 1,
						billedUsd: r.billedUsd
					};
					return rec;
				});
			const span = (rs: RawUsageRecord[]) => {
				let min = Infinity;
				let max = -Infinity;
				for (const r of rs) {
					min = Math.min(min, r.timestamp);
					max = Math.max(max, r.timestamp);
				}
				return { min, max };
			};
			const outside = (rs: RawUsageRecord[], ...spans: { min: number; max: number }[]) => {
				const kept = rs.filter((r) => spans.every((s) => r.timestamp < s.min || r.timestamp > s.max));
				stats.duplicatesDropped += rs.length - kept.length;
				return kept;
			};
			const csvSpan = span(csvRecords);
			grokRecords = outside(grokRecords, csvSpan);
			dbRecords = outside(dbRecords, csvSpan, span(grokRecords));
			const records = [...csvRecords, ...grokRecords, ...dbRecords];
			stats.records = records.length;
			return { records, stats, warnings };
		}
	};
}
