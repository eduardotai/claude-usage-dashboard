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
	/** Model calls / requests; a record can stand for several calls. */
	total_calls: number;
	/** Calls whose tokens are not recorded on disk (counted, never shown as 0 tokens). */
	unmeasured_calls: number;
	/** Share of calls with measured tokens (0..1). */
	token_coverage: number;
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
	calls: number;
	by_agent: Record<string, { tokens: number; cost: number; calls: number }>;
}

export interface DailyResponse {
	start: string;
	end: string;
	/** Agents with usage in the window, for the stacked chart. */
	agents: string[];
	daily: DailyPoint[];
}

interface Costed {
	tokens: number;
	messages: number;
	calls: number;
	unmeasured_calls: number;
	token_coverage: number;
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

export interface ScanStats {
	files: number;
	lines: number;
	records: number;
	duplicatesDropped: number;
	malformedLines: number;
	sidechainRecords: number;
	skippedFiles: number;
}

export interface AgentInfo {
	id: string;
	label: string;
	status: 'available' | 'planned';
	source: string;
	note: string | null;
	warnings: string[];
	detected: boolean;
	data_paths: string[];
	scan: ScanStats | null;
	usage: {
		tokens: number;
		messages: number;
		calls: number;
		unmeasured_calls: number;
		token_coverage: number;
		sessions: number;
		cost: number | null;
		cost_provenance: Provenance;
	} | null;
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
