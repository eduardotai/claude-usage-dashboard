/** Mirrors the JSON API in src/server.ts + src/core/stats.ts. */
export type Provenance = 'measured' | 'estimated' | 'unavailable';

export interface UnpricedModel {
	model: string;
	agent: string;
	tokens: number;
	messages: number;
}

export interface Summary {
	total_tokens: number;
	breakdown: {
		input: number;
		output: number;
		cache_creation: number;
		cache_read: number;
	};
	estimated_cost: number;
	cost_coverage: number;
	unpriced_models: UnpricedModel[];
	total_messages: number;
	sidechain_messages: number;
	total_sessions: number;
	total_projects: number;
	total_models: number;
	total_agents: number;
	active_days: number;
	avg_tokens_per_active_day: number;
	first_date: string | null;
	last_date: string | null;
	provenance: { tokens: Provenance; cost: Provenance };
	generated_at: string | null;
}

export interface DailyPoint {
	date: string;
	tokens: number;
	input: number;
	output: number;
	cache: number;
	cost: number;
}

export interface DailyResponse {
	start: string;
	end: string;
	daily: DailyPoint[];
}

interface Costed {
	tokens: number;
	messages: number;
	cost: number | null;
	cost_provenance: Provenance;
	cost_coverage: number;
	share: number;
	agents: string[];
}

export interface ModelStat extends Costed {
	model: string;
}

export interface ProjectStat extends Costed {
	project: string;
	sessions: number;
}

export interface HeatmapCell {
	date: string;
	tokens: number;
	count: number;
	cost: number;
}

export interface HeatmapResponse {
	start: string;
	end: string;
	max_tokens: number;
	cells: HeatmapCell[];
}

export interface AgentInfo {
	id: string;
	label: string;
	status: 'available' | 'planned';
	detected: boolean;
	data_paths: string[];
	usage: { tokens: number; messages: number; cost: number | null } | null;
}

export interface Meta {
	name: string;
	version: string;
	generated_at: string | null;
	pricing: { source: 'live' | 'cache' | 'stale-cache' | 'bundled'; fetched_at: string | null; models: number; url: string };
}

export interface DashboardData {
	summary: Summary;
	daily: DailyResponse;
	models: ModelStat[];
	projects: ProjectStat[];
	heatmap: HeatmapResponse;
	agents: AgentInfo[];
	meta: Meta;
}
