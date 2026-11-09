import type { AgentInfo, DailyResponse, DashboardData, HeatmapResponse, Meta, ModelStat, ProjectStat, Summary } from './types';

// Same origin as the AgentBurn server (Vite proxies /api in dev).
const BASE = '';

export interface DashboardFilters {
	/** Inclusive start date, ISO yyyy-mm-dd. Omit for open-ended (all time). */
	start?: string | null;
	/** Inclusive end date, ISO yyyy-mm-dd. */
	end?: string | null;
	/** Restrict to a single project. */
	project?: string | null;
	/** Restrict to a single agent id, e.g. "claude-code". */
	agent?: string | null;
}

function qs(params: Record<string, string | null | undefined>): string {
	const search = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v) search.set(k, v);
	}
	const s = search.toString();
	return s ? `?${s}` : '';
}

async function getJSON<T>(path: string): Promise<T> {
	const res = await fetch(`${BASE}${path}`);
	if (!res.ok) throw new Error(`Request to ${path} failed (${res.status})`);
	return (await res.json()) as T;
}

/** Fetch everything the dashboard needs in parallel, scoped by filters. */
export async function fetchDashboard(filters: DashboardFilters = {}): Promise<DashboardData> {
	const { start, end, project, agent } = filters;
	const scoped = qs({ start, end, project, agent });
	// Projects list spans all projects (so the user can switch) but honors dates + agent.
	const noProject = qs({ start, end, agent });
	// Agent list spans all agents but honors dates + project.
	const noAgent = qs({ start, end, project });
	// Heatmap stays a trailing-year view; it only narrows by project/agent.
	const heatScope = qs({ project, agent });

	const [summary, daily, modelsRes, projectsRes, heatmap, agentsRes, meta] = await Promise.all([
		getJSON<Summary>(`/api/stats/summary${scoped}`),
		getJSON<DailyResponse>(`/api/stats/daily${scoped}`),
		getJSON<{ models: ModelStat[] }>(`/api/stats/models${scoped}`),
		getJSON<{ projects: ProjectStat[] }>(`/api/stats/projects${noProject}`),
		getJSON<HeatmapResponse>(`/api/stats/heatmap${heatScope}`),
		getJSON<{ agents: AgentInfo[] }>(`/api/agents${noAgent}`),
		getJSON<Meta>('/api/meta')
	]);
	return {
		summary,
		daily,
		models: modelsRes.models,
		projects: projectsRes.projects,
		heatmap,
		agents: agentsRes.agents,
		meta
	};
}

/** Ask the backend to re-scan logs. */
export async function refreshLogs(): Promise<void> {
	const res = await fetch(`${BASE}/api/refresh`, { method: 'POST' });
	if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
}
