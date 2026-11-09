/**
 * In-memory store: scans every available adapter once, prices the records,
 * and serves all aggregations from memory. `refresh()` re-scans disk.
 */
import type { Adapter, AdapterScanStats, UsageRecord } from './types.js';
import type { PriceBook } from '../pricing/litellm.js';

export interface AgentStatus {
	id: string;
	label: string;
	status: 'available' | 'planned';
	/** True when the adapter found at least one usage record. */
	detected: boolean;
	data_paths: string[];
	scan: AdapterScanStats | null;
}

export class UsageStore {
	private records: UsageRecord[] = [];
	private scans = new Map<string, AdapterScanStats>();
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
		for (const a of this.adapters) {
			if (a.status !== 'available') continue;
			const res = await a.load();
			scans.set(a.id, res.stats);
			for (const r of res.records) {
				const costEst = this.prices.cost(r);
				records.push({ ...r, costEst, cost: costEst === null ? 'unavailable' : 'estimated' });
			}
		}
		records.sort((a, b) => a.timestamp - b.timestamp);
		this.records = records;
		this.scans = scans;
		this.loaded = true;
		this.generatedAt = new Date().toISOString();
	}

	agentStatuses(): AgentStatus[] {
		return this.adapters.map((a) => {
			const scan = this.scans.get(a.id) ?? null;
			return {
				id: a.id,
				label: a.label,
				status: a.status,
				detected: !!scan && scan.records > 0,
				data_paths: a.dataPaths(),
				scan
			};
		});
	}
}
