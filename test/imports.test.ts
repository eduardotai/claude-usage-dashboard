import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createCursorAdapter, cursorCsvSources } from '../src/adapters/cursor.js';
import { grokUnifiedSources, loadGrokUnified } from '../src/adapters/grok-unified.js';
import { defaultCacheDir, defaultImportDirs, envVar } from '../src/imports.js';
import { CURSOR_FIXTURES, GROK_UNIFIED_FIXTURES, fixturesEnv } from './helpers.js';

const homes: string[] = [];
afterAll(() => homes.forEach((d) => rmSync(d, { recursive: true, force: true })));

const tempHome = () => {
	const home = mkdtempSync(join(tmpdir(), 'burnboard-home-'));
	homes.push(home);
	return home;
};

/** No imports-dir override, so the adapter falls back to ~/.burnboard and ~/.agentburn under HOME. */
const homeEnv = (home: string, over: Record<string, string> = {}) =>
	fixturesEnv({ HOME: home, USERPROFILE: home, BURNBOARD_IMPORTS_DIR: '', ...over });

describe('default import and cache paths', () => {
	it('prefers BURNBOARD_* env vars and falls back to the old AGENTBURN_* names', () => {
		expect(envVar({ BURNBOARD_CACHE_DIR: ' /new ', AGENTBURN_CACHE_DIR: '/old' }, 'CACHE_DIR')).toBe('/new');
		expect(envVar({ AGENTBURN_CACHE_DIR: '/old' }, 'CACHE_DIR')).toBe('/old');
		expect(envVar({ BURNBOARD_CACHE_DIR: '  ' }, 'CACHE_DIR')).toBeUndefined();
	});

	it('defaults to ~/.burnboard/imports and still lists the legacy ~/.agentburn/imports', () => {
		const home = join(tmpdir(), 'fake-home');
		const env = { HOME: home };
		expect(defaultImportDirs('cursor', env)).toEqual([
			join(home, '.burnboard', 'imports', 'cursor'),
			join(home, '.agentburn', 'imports', 'cursor')
		]);
		expect(defaultImportDirs('grok', env)).toEqual([
			join(home, '.burnboard', 'imports', 'grok'),
			join(home, '.agentburn', 'imports', 'grok')
		]);
		expect(cursorCsvSources(env)).toEqual(defaultImportDirs('cursor', env));
		expect(grokUnifiedSources(env)).toEqual(defaultImportDirs('grok', env));
	});

	it('uses only BURNBOARD_IMPORTS_DIR when it is set, not the legacy home path', () => {
		const home = join(tmpdir(), 'fake-home');
		const custom = join(tmpdir(), 'custom-imports');
		const env = { HOME: home, BURNBOARD_IMPORTS_DIR: custom };
		expect(defaultImportDirs('cursor', env)).toEqual([join(custom, 'cursor')]);
		expect(cursorCsvSources(env)).toEqual([join(custom, 'cursor')]);
	});

	it('caches prices under ~/.cache/burnboard, honoring BURNBOARD_CACHE_DIR', () => {
		const home = join(tmpdir(), 'fake-home');
		expect(defaultCacheDir({ HOME: home })).toBe(join(home, '.cache', 'burnboard'));
		expect(defaultCacheDir({ BURNBOARD_CACHE_DIR: '/custom/cache' })).toBe('/custom/cache');
		expect(defaultCacheDir({ AGENTBURN_CACHE_DIR: '/legacy/cache' })).toBe('/legacy/cache');
	});
});

describe('legacy ~/.agentburn/imports fallback', () => {
	it('loads Cursor CSVs that only exist under the pre-rename drop folder', async () => {
		const home = tempHome();
		const dest = join(home, '.agentburn', 'imports', 'cursor');
		mkdirSync(dest, { recursive: true });
		const src = join(CURSOR_FIXTURES, 'imports', 'cursor');
		for (const f of readdirSync(src)) copyFileSync(join(src, f), join(dest, f));

		const viaLegacy = await createCursorAdapter(homeEnv(home)).load();
		const viaOverride = await createCursorAdapter(
			fixturesEnv({ BURNBOARD_IMPORTS_DIR: join(CURSOR_FIXTURES, 'imports') })
		).load();
		expect(viaLegacy.stats.files).toBe(viaOverride.stats.files);
		expect(viaLegacy.records).toEqual(viaOverride.records);
		expect(viaLegacy.records.length).toBeGreaterThan(0);
	});

	it('loads grok.com exports that only exist under the pre-rename drop folder', async () => {
		const home = tempHome();
		const dest = join(home, '.agentburn', 'imports', 'grok');
		mkdirSync(dest, { recursive: true });
		for (const f of readdirSync(GROK_UNIFIED_FIXTURES)) {
			if (!f.endsWith('.csv')) continue;
			copyFileSync(join(GROK_UNIFIED_FIXTURES, f), join(dest, f));
		}

		const viaLegacy = await loadGrokUnified(homeEnv(home));
		const viaOverride = await loadGrokUnified(fixturesEnv(), { csv: [GROK_UNIFIED_FIXTURES] });
		expect(viaLegacy.stats.files).toBe(viaOverride.stats.files);
		expect(viaLegacy.rows).toEqual(viaOverride.rows);
		expect(viaLegacy.rows.length).toBeGreaterThan(0);
	});
});
