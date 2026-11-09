import { beforeAll, describe, expect, it } from 'vitest';
import { createAdapters } from '../src/adapters/index.js';
import { UsageStore } from '../src/core/store.js';
import * as stats from '../src/core/stats.js';
import type { UsageRecord } from '../src/core/types.js';
import { fixturesEnv, testBook } from './helpers.js';

let records: UsageRecord[];
let store: UsageStore;
beforeAll(async () => {
	store = new UsageStore(createAdapters(fixturesEnv()), testBook());
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
		expect(st.find((a) => a.id === 'codex')).toMatchObject({ status: 'available', detected: false });
		expect(st.find((a) => a.id === 'gemini-cli')).toMatchObject({ status: 'planned', detected: false });
		expect(st.find((a) => a.id === 'grok-bot')).toMatchObject({ status: 'available', detected: false });
		expect(st.find((a) => a.id === 'grok-bot')!.note).toMatch(/cloud/);
	});
});

describe('multi-agent aggregations', () => {
	let all: UsageRecord[];
	beforeAll(async () => {
		const { CODEX_HOME_FIXTURE, GROK_HOME_FIXTURE, CURSOR_FIXTURES } = await import('./helpers.js');
		const { join } = await import('node:path');
		const env = fixturesEnv({ CODEX_HOME: CODEX_HOME_FIXTURE, GROK_HOME: GROK_HOME_FIXTURE, AGENTBURN_IMPORTS_DIR: join(CURSOR_FIXTURES, 'imports') });
		all = await new UsageStore(createAdapters(env), testBook()).all();
	});

	it('daily points break tokens, cost and calls down by agent', () => {
		const d = stats.daily(all, { start: '2026-11-03', end: '2026-11-05' });
		expect(d.agents).toEqual(['claude-code', 'codex', 'cursor', 'grok-build']);
		const nov3 = d.daily[0]!;
		const sum = Object.values(nov3.by_agent).reduce((s, a) => s + a.tokens, 0);
		expect(sum).toBe(nov3.tokens);
		expect(Object.keys(nov3.by_agent).sort()).toEqual(['claude-code', 'codex', 'grok-build']);
		expect(nov3.by_agent['grok-build']!.calls).toBe(6);
	});

	it('counts calls separately from records and reports token coverage', () => {
		const s = stats.summary(all);
		expect(s.total_agents).toBe(4);
		expect(s.total_calls).toBeGreaterThan(s.total_messages); // Grok turns aggregate several calls
		expect(s.unmeasured_calls).toBe(1); // the errored Cursor row
		const cursor = stats.agents(all).agents.find((a) => a.agent === 'cursor')!;
		expect(cursor.unmeasured_calls).toBe(1);
		expect(cursor.token_coverage).toBeCloseTo(4 / 5, 10);
	});

	it('filters every aggregation by agent', () => {
		const codexOnly = stats.applyFilters(all, { agent: 'codex' });
		expect(new Set(codexOnly.map((r) => r.agent))).toEqual(new Set(['codex']));
		expect(stats.projects(codexOnly).projects.map((p) => p.project).sort()).toEqual(['api-server', 'web-app']);
	});
});
