import { beforeAll, describe, expect, it } from 'vitest';
import { createAdapters } from '../src/adapters/index.js';
import { UsageStore } from '../src/core/store.js';
import * as stats from '../src/core/stats.js';
import type { UsageRecord } from '../src/core/types.js';
import { CLAUDE_FIXTURES, testBook } from './helpers.js';

let records: UsageRecord[];
let store: UsageStore;
beforeAll(async () => {
	store = new UsageStore(createAdapters({ CLAUDE_LOGS_DIR: CLAUDE_FIXTURES }), testBook());
	records = await store.all();
});

describe('aggregations', () => {
	it('summary separates measured tokens from estimated cost and flags unpriced models', () => {
		const s = stats.summary(records);
		expect(s.total_messages).toBe(6);
		expect(s.provenance).toEqual({ tokens: 'measured', cost: 'estimated' });
		expect(s.unpriced_models).toEqual([{ model: 'acme-coder-9', agent: 'claude-code', tokens: 2000, messages: 1 }]);
		expect(s.cost_coverage).toBeGreaterThan(0.5);
		expect(s.cost_coverage).toBeLessThan(1);
		expect(s.total_sessions).toBe(2);
		expect(s.total_projects).toBe(2);
		expect(s.sidechain_messages).toBe(1);
		expect(s.first_date).toBe('2026-11-01');
		expect(s.last_date).toBe('2026-11-03');
	});

	it('models list marks unpriced models with null cost, never $0', () => {
		const m = stats.models(records).models.find((x) => x.model === 'acme-coder-9')!;
		expect(m.cost).toBeNull();
		expect(m.cost_provenance).toBe('unavailable');
	});

	it('filters by agent, project and date', () => {
		expect(stats.applyFilters(records, { agent: 'codex' })).toHaveLength(0);
		expect(stats.applyFilters(records, { agent: 'claude-code' })).toHaveLength(6);
		expect(stats.applyFilters(records, { project: 'beta' })).toHaveLength(1);
		expect(stats.applyFilters(records, { start: '2026-11-02', end: '2026-11-03' })).toHaveLength(1);
	});

	it('daily spans the data when open-ended and zero-fills gaps', () => {
		const d = stats.daily(records, {}, '2026-11-04');
		expect(d.start).toBe('2026-11-01');
		expect(d.daily.map((x) => x.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
		expect(d.daily[1]!.tokens).toBe(0);
		expect(d.daily[2]!.tokens).toBe(10);
	});

	it('daily honours a trailing window', () => {
		expect(stats.daily(records, { days: 7 }, '2026-11-04').daily).toHaveLength(7);
	});

	it('heatmap covers the trailing window', () => {
		const h = stats.heatmap(records, 30, '2026-11-04');
		expect(h.cells.map((c) => c.date)).toEqual(['2026-11-01', '2026-11-03']);
		expect(h.max_tokens).toBe(h.cells[0]!.tokens);
	});

	it('reports per-agent statuses including planned adapters', () => {
		const st = store.agentStatuses();
		expect(st.find((a) => a.id === 'claude-code')).toMatchObject({ status: 'available', detected: true });
		expect(st.find((a) => a.id === 'codex')).toMatchObject({ status: 'planned', detected: false });
	});
});
