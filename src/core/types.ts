/**
 * Core domain types shared by adapters, pricing and aggregation.
 *
 * Every adapter turns an agent's on-disk logs into `UsageRecord`s. Nothing
 * downstream knows which agent produced a record except through `agent`.
 */

/** Where a figure comes from. Surfaced in the API and the UI on purpose. */
export type Provenance =
	/** Read directly from the agent's own logs. */
	| 'measured'
	/** Derived by Burnboard (e.g. cost = tokens x public API price). */
	| 'estimated'
	/** The agent does not record it, or we cannot price it. */
	| 'unavailable';

export type AgentId = 'claude-code' | 'codex' | 'cursor' | 'grok-build' | 'grok-bot' | 'grok-apps' | 'gemini-cli';

/** One model call, normalized across agents. Tokens only; cost is applied later. */
export interface RawUsageRecord {
	agent: AgentId;
	/** Friendly project name (basename of the working directory). */
	project: string;
	/** Session / conversation identifier as recorded by the agent. */
	session: string;
	/** Model id exactly as the agent logged it (what the UI shows). */
	model: string;
	/**
	 * Price-table id when it differs from `model` by a documented, exact alias
	 * (e.g. Cursor's `claude-4.5-sonnet` -> `claude-sonnet-4-5`, Grok's `grok-4.5-build` -> `grok-4.5`).
	 */
	pricingModel?: string;
	/**
	 * Price `pricingModel` from the pinned (bundled) table instead of the active one: for rates
	 * inferred from a bill, which must not drift with the downloaded price list.
	 */
	pricingPinned?: boolean;
	/** Epoch milliseconds (UTC). */
	timestamp: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	/** Total cache-write tokens (all TTLs). */
	cacheWriteTokens: number;
	/** Portion of `cacheWriteTokens` written with a 1h TTL (priced higher), when known. */
	cacheWrite1hTokens: number;
	/** True for subagent / sidechain calls (still real API calls; see README). */
	sidechain: boolean;
	/** Provenance of the token counts. `unavailable` records carry zeros and only count as calls. */
	tokens: Provenance;
	/** Model calls this record stands for (1 unless the agent aggregates, e.g. a Grok Build turn). */
	calls: number;
	/** Cost the agent itself recorded at list price (USD), when it records one. */
	reportedCostUsd?: number | null;
	/**
	 * What the provider actually charged for this record (USD), from a billing export.
	 * Distinct from the API-equivalent estimate: subscription-included usage bills $0.
	 */
	billedUsd?: number | null;
}

/** A record after pricing has been applied. */
export interface UsageRecord extends RawUsageRecord {
	/** API-equivalent USD estimate, or null when the model could not be priced. */
	costEst: number | null;
	cost: Provenance;
}

export interface AdapterScanStats {
	files: number;
	/** Files found but not readable on this runtime (e.g. .zst without zstd support). */
	skippedFiles: number;
	lines: number;
	records: number;
	duplicatesDropped: number;
	sidechainRecords: number;
	malformedLines: number;
}

export interface Adapter {
	id: AgentId;
	label: string;
	/** `available` adapters are wired up; `planned` ones are shown in the UI as coming soon. */
	status: 'available' | 'planned';
	/** Where the numbers come from, in plain words (shown in the UI). */
	source: string;
	/** For planned/limited adapters: what is missing, shown verbatim in the UI. */
	note?: string;
	/** Directories this adapter reads (after env overrides). */
	dataPaths(): string[];
	load(): Promise<AdapterResult>;
	/**
	 * Optional step after loading, with the price table: lets an adapter choose a pricing
	 * basis from its own data (e.g. Grok Bot, which logs no model). Returns extra warnings.
	 */
	finalize?(records: RawUsageRecord[], prices: import('../pricing/litellm.js').PriceBook): string[];
}

export interface AdapterResult {
	records: RawUsageRecord[];
	stats: AdapterScanStats;
	/** Human-readable caveats from this scan (e.g. "node:sqlite unavailable"). */
	warnings?: string[];
}

export function totalTokens(r: RawUsageRecord): number {
	return r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;
}

export function emptyStats(): AdapterScanStats {
	return { files: 0, skippedFiles: 0, lines: 0, records: 0, duplicatesDropped: 0, sidechainRecords: 0, malformedLines: 0 };
}
