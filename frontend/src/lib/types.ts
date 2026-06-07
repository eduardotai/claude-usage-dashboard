export interface Summary {
	total_tokens: number;
	breakdown: {
		input: number;
		output: number;
		cache_creation: number;
		cache_read: number;
	};
	estimated_cost: number;
	total_messages: number;
	total_sessions: number;
	total_projects: number;
	total_models: number;
	active_days: number;
	avg_tokens_per_active_day: number;
	first_date: string | null;
	last_date: string | null;
	generated_at: string | null;
}

export interface DailyPoint {
	date: string;
	tokens: number;
	input: number;
	output: number;
	cache: number;
}

export interface DailyResponse {
	start: string;
	end: string;
	daily: DailyPoint[];
}

export interface ModelStat {
	model: string;
	tokens: number;
	messages: number;
	cost: number;
	share: number;
}

export interface ProjectStat {
	project: string;
	tokens: number;
	messages: number;
	cost: number;
	sessions: number;
	share: number;
}

export interface HeatmapCell {
	date: string;
	tokens: number;
	count: number;
}

export interface HeatmapResponse {
	start: string;
	end: string;
	max_tokens: number;
	cells: HeatmapCell[];
}

export interface DashboardData {
	summary: Summary;
	daily: DailyResponse;
	models: ModelStat[];
	projects: ProjectStat[];
	heatmap: HeatmapResponse;
}
