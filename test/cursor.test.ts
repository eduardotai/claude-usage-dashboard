import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createCursorAdapter, cursorPricingModel, cursorUserDir, parseCsv } from '../src/adapters/cursor.js';
import { UsageStore } from '../src/core/store.js';
import * as stats from '../src/core/stats.js';
import { CURSOR_FIXTURES, fixturesEnv, testBook } from './helpers.js';

const require = createRequire(import.meta.url);
let sqlite: any = null;
try {
	sqlite = require('node:sqlite');
} catch {
	/* Node < 22.5 */
}

const IMPORTS = join(CURSOR_FIXTURES, 'imports'); // contains cursor/*.csv
const env = (over: Record<string, string> = {}) => fixturesEnv({ AGENTBURN_IMPORTS_DIR: IMPORTS, ...over });

describe('cursor CSV import', async () => {
	const adapter = createCursorAdapter(env(), { csv: [join(CURSOR_FIXTURES, 'legacy-v1.csv'), join(CURSOR_FIXTURES, 'not-cursor.csv')] });
	const { records, stats: scan, warnings } = await adapter.load();

	it('reads every header version by column name and dedupes overlapping exports', () => {
		expect(scan.files).toBe(4);
		expect(records).toHaveLength(6); // 4 + 2 - 1 overlap + 1 legacy
		expect(scan.duplicatesDropped).toBe(1);
		expect(scan.malformedLines).toBe(2); // the non-Cursor CSV
	});

	it('maps the disjoint token buckets and strips thousands separators', () => {
		const r = records.find((x) => x.model === 'claude-4.5-sonnet-thinking')!;
		expect(r).toMatchObject({ inputTokens: 3410, cacheWriteTokens: 1204, cacheReadTokens: 52880, outputTokens: 1987, tokens: 'measured', project: '(cursor export)' });
		expect(records.find((x) => x.model === 'gpt-5')).toMatchObject({ inputTokens: 900, cacheWriteTokens: 100, cacheReadTokens: 4000, outputTokens: 300 });
	});

	it('marks zero-token rows as unavailable, not zero', () => {
		expect(records.find((x) => x.model === 'composer-2.5-fast')).toMatchObject({ tokens: 'unavailable', calls: 1 });
		expect(warnings).toEqual([]);
	});

	it('keeps the cloud agent id as the session', () => {
		expect(records.find((x) => x.model === 'cursor-grok-4.6-xhigh-fast')!.session).toBe('cloud-agent:bc-6a1f0e2d');
	});

	it('prices Claude models under their API id and leaves Cursor-only models unpriced', async () => {
		const all = await new UsageStore([adapter], testBook()).all();
		expect(all.find((x) => x.model === 'claude-4.5-sonnet-thinking')!.cost).toBe('estimated');
		expect(all.find((x) => x.model === 'cursor-grok-4.6-xhigh-fast')!.costEst).toBeNull();
		const s = stats.summary(all);
		expect(s.unpriced_models.map((u) => u.model)).not.toContain('composer-2.5-fast'); // no tokens: not "unpriced"
		expect(s.unmeasured_calls).toBe(1);
		expect(s.token_coverage).toBeCloseTo(5 / 6, 10);
	});

	it('normalizes Cursor model names only by exact rules', () => {
		expect(cursorPricingModel('claude-4.5-sonnet-thinking')).toBe('claude-sonnet-4-5');
		expect(cursorPricingModel('claude-opus-5-thinking-high')).toBe('claude-opus-5');
		expect(cursorPricingModel('gpt-5.5')).toBeUndefined();
		expect(cursorPricingModel('cursor-grok-4.6-xhigh-fast')).toBeUndefined();
	});

	it('parses quoted fields with commas, quotes and CRLF', () => {
		expect(parseCsv('a,"b, c","d ""e"""\r\n1,2,3\r\n')).toEqual([
			['a', 'b, c', 'd "e"'],
			['1', '2', '3']
		]);
	});

	it('knows the per-OS Cursor data dir', () => {
		expect(cursorUserDir({}, 'darwin')).toMatch(/Library[\\/]Application Support[\\/]Cursor[\\/]User$/);
		expect(cursorUserDir({ APPDATA: 'C:\\Users\\dev\\AppData\\Roaming' }, 'win32')).toMatch(/Roaming[\\/]Cursor[\\/]User$/);
		expect(cursorUserDir({}, 'linux')).toMatch(/\.config[\\/]Cursor[\\/]User$/);
	});
});

/** Builds a Cursor `User` dir with the cursorDiskKV / ItemTable layout documented in src/adapters/cursor.ts. */
function makeCursorUserDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'agentburn-cursor-test-'));
	const g = join(dir, 'globalStorage');
	mkdirSync(g, { recursive: true });
	const db = new sqlite.DatabaseSync(join(g, 'state.vscdb'));
	db.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB); CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);');
	const put = db.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)');
	const C1 = 'c0ffee00-0000-4000-8000-000000000001';
	const C2 = 'c0ffee00-0000-4000-8000-000000000002';
	put.run(`composerData:${C1}`, JSON.stringify({ composerId: C1, createdAt: Date.parse('2026-10-01T10:00:00Z'), modelConfig: { modelName: 'claude-4.5-sonnet' }, fullConversationHeadersOnly: [{ bubbleId: 'u1', type: 1 }, { bubbleId: 'a1', type: 2 }, { bubbleId: 'a2', type: 2 }, { bubbleId: 'u2', type: 1 }, { bubbleId: 'a3', type: 2 }] }));
	put.run(`bubbleId:${C1}:u1`, JSON.stringify({ type: 1, text: 'refactor', createdAt: '2026-10-01T10:00:00.000Z', tokenCount: { inputTokens: 0, outputTokens: 0 } }));
	put.run(`bubbleId:${C1}:a1`, JSON.stringify({ type: 2, tokenCount: { inputTokens: 1200, outputTokens: 80 } }));
	put.run(`bubbleId:${C1}:a2`, JSON.stringify({ type: 2, tokenCount: { inputTokens: 300, outputTokens: 20 } }));
	put.run(`bubbleId:${C1}:u2`, JSON.stringify({ type: 1, text: 'thanks', createdAt: '2026-10-01T10:05:00.000Z', tokenCount: { inputTokens: 0, outputTokens: 0 } }));
	put.run(`bubbleId:${C1}:a3`, JSON.stringify({ type: 2, tokenCount: { inputTokens: 0, outputTokens: 0 } }));
	// A composer inside the CSV's time range: the CSV wins.
	put.run(`composerData:${C2}`, JSON.stringify({ composerId: C2, createdAt: Date.parse('2026-11-05T12:00:00Z'), modelConfig: { modelName: 'default' }, fullConversationHeadersOnly: [{ bubbleId: 'u1', type: 1 }] }));
	put.run(`bubbleId:${C2}:u1`, JSON.stringify({ type: 1, text: 'hi' }));
	put.run('bubbleId:broken', 'not json');
	db.close();

	const ws = join(dir, 'workspaceStorage', 'a1b2c3');
	mkdirSync(ws, { recursive: true });
	writeFileSync(join(ws, 'workspace.json'), JSON.stringify({ folder: pathToFileURL('/home/dev/work/mobile-app').href }));
	const wdb = new sqlite.DatabaseSync(join(ws, 'state.vscdb'));
	wdb.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);');
	wdb.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run('composer.composerData', JSON.stringify({ allComposers: [{ composerId: C1 }] }));
	wdb.close();
	return dir;
}

describe.runIf(!!sqlite)('cursor state.vscdb', () => {
	const dirs: string[] = [];
	afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

	it('turns each user request into one call; best-effort tokens are measured only when nonzero', async () => {
		const userDir = makeCursorUserDir();
		dirs.push(userDir);
		const { records, warnings } = await createCursorAdapter(fixturesEnv({ CURSOR_USER_DIR: userDir })).load();
		expect(records).toHaveLength(3);
		const [first, second] = records.filter((r) => r.project === 'mobile-app');
		expect(first).toMatchObject({ model: 'claude-4.5-sonnet', inputTokens: 1500, outputTokens: 100, tokens: 'measured', calls: 1 });
		expect(second).toMatchObject({ inputTokens: 0, outputTokens: 0, tokens: 'unavailable' });
		expect(second!.timestamp).toBe(Date.parse('2026-10-01T10:05:00.000Z'));
		// no createdAt on the bubble: falls back to the conversation's createdAt
		expect(records.find((r) => r.model === 'default')).toMatchObject({ project: 'unknown', tokens: 'unavailable', timestamp: Date.parse('2026-11-05T12:00:00Z') });
		expect(records.filter((r) => r.tokens === 'unavailable')).toHaveLength(2);
		expect(warnings).toEqual([]);
	});

	it('drops DB requests already covered by an imported CSV', async () => {
		const userDir = makeCursorUserDir();
		dirs.push(userDir);
		const { records, stats: scan } = await createCursorAdapter(env({ CURSOR_USER_DIR: userDir })).load();
		expect(records.filter((r) => r.project === 'mobile-app')).toHaveLength(2); // October: outside CSV range
		expect(records.some((r) => r.model === 'default')).toBe(false);
		expect(scan.duplicatesDropped).toBe(2); // 1 overlapping CSV row + 1 covered DB request
	});

	it('never writes to the original database', async () => {
		const userDir = makeCursorUserDir();
		dirs.push(userDir);
		const { statSync } = await import('node:fs');
		const before = statSync(join(userDir, 'globalStorage', 'state.vscdb')).mtimeMs;
		await createCursorAdapter(fixturesEnv({ CURSOR_USER_DIR: userDir })).load();
		expect(statSync(join(userDir, 'globalStorage', 'state.vscdb')).mtimeMs).toBe(before);
	});
});
