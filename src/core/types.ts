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
	/** Derived by AgentBurn (e.g. cost = tokens x public API price). */
	| 'estimated'
	/** The agent does not record it, or we cannot price it. */
	| 'unavailable';

export type AgentId = 'claude-code' | 'codex' | 'cursor' | 'gemini-cli';

/** One model call, normalized across agents. Tokens only; cost is applied later. */
export interface RawUsageRecord {
	agent: AgentId;
	/** Friendly project name (basename of the working directory). */
	project: string;
	/** Session / conversation identifier as recorded by the agent. */
	session: string;
	/** Model id exactly as the agent logged it. */
	model: string;
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
	/** Provenance of the token counts. */
	tokens: Provenance;
}

/** A record after pricing has been applied. */
export interface UsageRecord extends RawUsageRecord {
	/** API-equivalent USD estimate, or null when the model could not be priced. */
	costEst: number | null;
	cost: Provenance;
}

export interface AdapterScanStats {
	files: number;
	lines: number;
	records: number;
	duplicatesDropped: number;
	sidechainRecords: number;
	malformedLines: number;
}

export interface AdapterResult {
	records: RawUsageRecord[];
	stats: AdapterScanStats;
}

export interface Adapter {
	id: AgentId;
	label: string;
	/** `available` adapters are wired up; `planned` ones are shown in the UI as coming soon. */
	status: 'available' | 'planned';
	/** Directories this adapter reads (after env overrides). */
	dataPaths(): string[];
	load(): Promise<AdapterResult>;
}

export function totalTokens(r: RawUsageRecord): number {
	return r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens;
}

export function emptyStats(): AdapterScanStats {
	return { files: 0, lines: 0, records: 0, duplicatesDropped: 0, sidechainRecords: 0, malformedLines: 0 };
}
