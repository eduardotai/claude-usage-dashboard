/**
 * Pure aggregations over priced usage records. No I/O, so they are trivially testable.
 * Output keys are snake_case: they are the public JSON API.
 */
import { addDays, daySpan, localISODate, parseISODate } from './dates.js';
import { totalTokens, type Provenance, type UsageRecord } from './types.js';

export interface Filters {
	start?: string | null;
	end?: string | null;
	project?: string | null;
	agent?: string | null;
}

export function applyFilters(records: UsageRecord[], f: Filters): UsageRecord[] {
	const start = parseISODate(f.start);
	const end = parseISODate(f.end);
	if (!start && !end && !f.project && !f.agent) return records;
	return records.filter((r) => {
		if (f.agent && r.agent !== f.agent) return false;
		if (f.project && r.project !== f.project) return false;
		if (start || end) {
			const d = localISODate(r.timestamp);
			if (start && d < start) return false;
			if (end && d > end) return false;
		}
		return true;
	});
}

/** Costs keep 4 decimals so sub-cent usage is not shown as $0.00; the UI formats. */
const roundCost = (v: number) => Math.round(v * 10_000) / 10_000;

interface CostAcc {
	cost: number;
	pricedTokens: number;
	tokens: number;
	estimated: boolean;
	measured: boolean;
	calls: number;
	measuredCalls: number;
}
const newAcc = (): CostAcc => ({ cost: 0, pricedTokens: 0, tokens: 0, estimated: false, measured: false, calls: 0, measuredCalls: 0 });
function addCost(acc: CostAcc, r: UsageRecord) {
	const t = totalTokens(r);
	acc.tokens += t;
	acc.calls += r.calls;
	if (r.tokens === 'measured') acc.measuredCalls += r.calls;
	if (r.costEst !== null) {
		acc.cost += r.costEst;
		acc.pricedTokens += t;
		if (r.cost === 'measured') acc.measured = true;
		else acc.estimated = true;
	}
}
/**
 * Cost provenance for an aggregate: `estimated` as soon as any part is estimated,
 * `measured` only when every priced record carried its own recorded cost.
 */
function costProvenance(acc: CostAcc): Provenance {
	return acc.estimated ? 'estimated' : acc.measured ? 'measured' : 'unavailable';
}
/** Share of calls (0..1) whose token counts are on disk. 1 when there are no calls. */
const tokenCoverage = (acc: CostAcc) => (acc.calls ? acc.measuredCalls / acc.calls : 1);

export function summary(records: UsageRecord[]) {
	const breakdown = { input: 0, output: 0, cache_creation: 0, cache_read: 0 };
	const acc = newAcc();
	const sessions = new Set<string>();
	const projects = new Set<string>();
	const models = new Set<string>();
	const agents = new Set<string>();
	const days = new Set<string>();
	const unpriced = new Map<string, { model: string; agent: string; tokens: number; messages: number }>();
	let sidechain = 0;

	for (const r of records) {
		breakdown.input += r.inputTokens;
		breakdown.output += r.outputTokens;
		breakdown.cache_creation += r.cacheWriteTokens;
		breakdown.cache_read += r.cacheReadTokens;
		addCost(acc, r);
		sessions.add(`${r.agent}:${r.session}`);
		projects.add(r.project);
		models.add(r.model);
		agents.add(r.agent);
		days.add(localISODate(r.timestamp));
		if (r.sidechain) sidechain++;
		if (r.costEst === null && r.tokens === 'measured') {
			const u = unpriced.get(r.model) ?? { model: r.model, agent: r.agent, tokens: 0, messages: 0 };
			u.tokens += totalTokens(r);
			u.messages++;
			unpriced.set(r.model, u);
		}
	}
	const total = acc.tokens;
	const sortedDays = [...days].sort();
	return {
		total_tokens: total,
		breakdown,
		estimated_cost: roundCost(acc.cost),
		/** Share of tokens (0..1) that could be priced. 1 when there is no usage. */
		cost_coverage: total ? acc.pricedTokens / total : 1,
		unpriced_models: [...unpriced.values()].sort((a, b) => b.tokens - a.tokens),
		total_messages: records.length,
		/** Model calls / requests. Some records stand for several calls (e.g. a Grok Build turn). */
		total_calls: acc.calls,
		/** Calls whose tokens are not recorded anywhere on disk (counted, but 0 tokens shown). */
		unmeasured_calls: acc.calls - acc.measuredCalls,
		token_coverage: tokenCoverage(acc),
		sidechain_messages: sidechain,
		total_sessions: sessions.size,
		total_projects: projects.size,
		total_models: models.size,
		total_agents: agents.size,
		active_days: days.size,
		avg_tokens_per_active_day: days.size ? Math.round(total / days.size) : 0,
		first_date: sortedDays[0] ?? null,
		last_date: sortedDays[sortedDays.length - 1] ?? null,
		provenance: { tokens: acc.measuredCalls ? 'measured' : 'unavailable', cost: costProvenance(acc) } as {
			tokens: Provenance;
			cost: Provenance;
		}
	};
}

/**
 * Per-day series with zero-filled gaps.
 * Window: [start, end] when given; otherwise the trailing `days` ending today;
 * otherwise (no start, no days) it spans the data up to `end`/today.
 */
export function daily(records: UsageRecord[], f: Filters & { days?: number | null }, today = localISODate(Date.now())) {
	const end = parseISODate(f.end) ?? today;
	let start = parseISODate(f.start);
	if (!start) {
		if (f.days) start = addDays(end, -(f.days - 1));
		else {
			let min: string | null = null;
			for (const r of records) {
				const d = localISODate(r.timestamp);
				if (!min || d < min) min = d;
			}
			start = min && min < end ? min : end;
		}
	}
	type Slice = { tokens: number; cost: number; calls: number };
	type Bucket = { tokens: number; input: number; output: number; cache: number; cost: number; calls: number; by_agent: Record<string, Slice> };
	const empty = (): Bucket => ({ tokens: 0, input: 0, output: 0, cache: 0, cost: 0, calls: 0, by_agent: {} });
	const buckets = new Map<string, Bucket>();
	const agentsSeen = new Set<string>();
	for (const r of records) {
		const d = localISODate(r.timestamp);
		if (d < start || d > end) continue;
		const b = buckets.get(d) ?? empty();
		const t = totalTokens(r);
		b.tokens += t;
		b.input += r.inputTokens;
		b.output += r.outputTokens;
		b.cache += r.cacheReadTokens + r.cacheWriteTokens;
		b.cost += r.costEst ?? 0;
		b.calls += r.calls;
		const a = (b.by_agent[r.agent] ??= { tokens: 0, cost: 0, calls: 0 });
		a.tokens += t;
		a.cost += r.costEst ?? 0;
		a.calls += r.calls;
		agentsSeen.add(r.agent);
		buckets.set(d, b);
	}
	const span = Math.max(daySpan(start, end), 0);
	const series = [];
	for (let i = 0; i < span; i++) {
		const date = addDays(start, i);
		const b = buckets.get(date) ?? empty();
		const by_agent = Object.fromEntries(Object.entries(b.by_agent).map(([k, v]) => [k, { ...v, cost: roundCost(v.cost) }]));
		series.push({ date, ...b, cost: roundCost(b.cost), by_agent });
	}
	return { start, end, agents: [...agentsSeen].sort(), daily: series };
}

function groupBy(records: UsageRecord[], key: (r: UsageRecord) => string) {
	const groups = new Map<string, { acc: CostAcc; messages: number; sessions: Set<string>; agents: Set<string> }>();
	for (const r of records) {
		const k = key(r);
		let g = groups.get(k);
		if (!g) groups.set(k, (g = { acc: newAcc(), messages: 0, sessions: new Set(), agents: new Set() }));
		addCost(g.acc, r);
		g.messages++;
		g.sessions.add(`${r.agent}:${r.session}`);
		g.agents.add(r.agent);
	}
	const total = [...groups.values()].reduce((s, g) => s + g.acc.tokens, 0) || 1;
	return [...groups.entries()]
		.map(([k, g]) => ({
			key: k,
			tokens: g.acc.tokens,
			messages: g.messages,
			calls: g.acc.calls,
			unmeasured_calls: g.acc.calls - g.acc.measuredCalls,
			token_coverage: tokenCoverage(g.acc),
			sessions: g.sessions.size,
			agents: [...g.agents].sort(),
			cost: g.acc.pricedTokens > 0 ? roundCost(g.acc.cost) : null,
			cost_provenance: costProvenance(g.acc),
			cost_coverage: g.acc.tokens ? g.acc.pricedTokens / g.acc.tokens : 1,
			share: Math.round((g.acc.tokens / total) * 10_000) / 10_000
		}))
		.sort((a, b) => b.tokens - a.tokens);
}

export function models(records: UsageRecord[]) {
	return {
		models: groupBy(records, (r) => r.model).map(({ key, sessions: _s, ...rest }) => ({ model: key, ...rest }))
	};
}

export function projects(records: UsageRecord[]) {
	return { projects: groupBy(records, (r) => r.project).map(({ key, ...rest }) => ({ project: key, ...rest })) };
}

export function agents(records: UsageRecord[]) {
	return { agents: groupBy(records, (r) => r.agent).map(({ key, agents: _a, ...rest }) => ({ agent: key, ...rest })) };
}

export function heatmap(records: UsageRecord[], days = 365, today = localISODate(Date.now())) {
	const start = addDays(today, -(days - 1));
	const buckets = new Map<string, { tokens: number; count: number; cost: number }>();
	for (const r of records) {
		const d = localISODate(r.timestamp);
		if (d < start || d > today) continue;
		const b = buckets.get(d) ?? { tokens: 0, count: 0, cost: 0 };
		b.tokens += totalTokens(r);
		b.count += r.calls;
		b.cost += r.costEst ?? 0;
		buckets.set(d, b);
	}
	const cells = [...buckets.entries()]
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([date, b]) => ({ date, tokens: b.tokens, count: b.count, cost: roundCost(b.cost) }));
	return { start, end: today, max_tokens: cells.reduce((m, c) => Math.max(m, c.tokens), 0), cells };
}
