import type {
	Summary,
	DailyResponse,
	ModelStat,
	ProjectStat,
	HeatmapResponse,
	DashboardData
} from './types';

const BASE = 'http://localhost:8000';

export interface DashboardFilters {
	/** Inclusive start date, ISO yyyy-mm-dd. Omit for open-ended (all time). */
	start?: string | null;
	/** Inclusive end date, ISO yyyy-mm-dd. */
	end?: string | null;
	/** Restrict to a single project. */
	project?: string | null;
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
	const { start, end, project } = filters;
	const scoped = qs({ start, end, project });
	// Projects list spans all projects (so the user can switch) but honors dates.
	const dateOnly = qs({ start, end });
	// Heatmap stays a trailing-year view; it only narrows by project for context.
	const heatScope = qs({ project });

	const [summary, daily, modelsRes, projectsRes, heatmap] = await Promise.all([
		getJSON<Summary>(`/api/stats/summary${scoped}`),
		getJSON<DailyResponse>(`/api/stats/daily${scoped}`),
		getJSON<{ models: ModelStat[] }>(`/api/stats/models${scoped}`),
		getJSON<{ projects: ProjectStat[] }>(`/api/stats/projects${dateOnly}`),
		getJSON<HeatmapResponse>(`/api/stats/heatmap${heatScope}`)
	]);
	return {
		summary,
		daily,
		models: modelsRes.models,
		projects: projectsRes.projects,
		heatmap
	};
}

/** Ask the backend to re-scan logs. */
export async function refreshLogs(): Promise<void> {
	const res = await fetch(`${BASE}/api/refresh`, { method: 'POST' });
	if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
}
