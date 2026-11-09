/**
 * In-memory store: scans every available adapter once, prices the records,
 * and serves all aggregations from memory. `refresh()` re-scans disk.
 */
import type { Adapter, AdapterScanStats, RawUsageRecord, UsageRecord } from './types.js';
import type { PriceBook } from '../pricing/litellm.js';

export interface AgentStatus {
	id: string;
	label: string;
	status: 'available' | 'planned';
	/** Where the adapter reads from, in plain words. */
	source: string;
	/** Why a planned adapter isn't available, or other caveats. */
	note: string | null;
	warnings: string[];
	/** True when the adapter found at least one usage record. */
	detected: boolean;
	data_paths: string[];
	scan: AdapterScanStats | null;
}

export class UsageStore {
	private records: UsageRecord[] = [];
	private scans = new Map<string, AdapterScanStats>();
	private warnings = new Map<string, string[]>();
	private loading: Promise<void> | null = null;
	private loaded = false;
	generatedAt: string | null = null;

	constructor(
		private readonly adapters: Adapter[],
		private prices: PriceBook
	) {}

	get pricing() {
		return this.prices.info;
	}

	async all(): Promise<UsageRecord[]> {
		if (!this.loaded) await this.refresh();
		return this.records;
	}

	/** Re-scan all adapters. Concurrent callers share one scan. */
	refresh(prices?: PriceBook): Promise<void> {
		if (prices) this.prices = prices;
		this.loading ??= this.scan().finally(() => (this.loading = null));
		return this.loading;
	}

	private async scan(): Promise<void> {
		const records: UsageRecord[] = [];
		const scans = new Map<string, AdapterScanStats>();
		const warnings = new Map<string, string[]>();
		for (const a of this.adapters) {
			if (a.status !== 'available') continue;
			let res;
			try {
				res = await a.load();
			} catch (e) {
				warnings.set(a.id, [`Scan failed: ${(e as Error).message}`]);
				continue;
			}
			scans.set(a.id, res.stats);
			if (res.warnings?.length) warnings.set(a.id, res.warnings);
			for (const r of res.records) records.push(this.price(r));
		}
		records.sort((a, b) => a.timestamp - b.timestamp);
		this.records = records;
		this.scans = scans;
		this.warnings = warnings;
		this.loaded = true;
		this.generatedAt = new Date().toISOString();
	}

	/**
	 * Cost rules: a cost the agent itself recorded wins (`measured`); otherwise tokens x LiteLLM
	 * price (`estimated`); unknown model or unmeasured tokens -> `unavailable` (never $0).
	 */
	private price(r: RawUsageRecord): UsageRecord {
		if (r.tokens === 'unavailable') return { ...r, costEst: null, cost: 'unavailable' };
		if (typeof r.reportedCostUsd === 'number' && Number.isFinite(r.reportedCostUsd))
			return { ...r, costEst: r.reportedCostUsd, cost: 'measured' };
		const costEst = this.prices.cost({ ...r, model: r.pricingModel ?? r.model });
		return { ...r, costEst, cost: costEst === null ? 'unavailable' : 'estimated' };
	}

	agentStatuses(): AgentStatus[] {
		return this.adapters.map((a) => {
			const scan = this.scans.get(a.id) ?? null;
			return {
				id: a.id,
				label: a.label,
				status: a.status,
				source: a.source,
				note: a.note ?? null,
				warnings: this.warnings.get(a.id) ?? [],
				detected: !!scan && scan.records > 0,
				data_paths: a.dataPaths(),
				scan
			};
		});
	}
}
