<script lang="ts">
	import type { HeatmapResponse } from '$lib/types';
	import { grouped, longDate } from '$lib/format';

	interface Props {
		data: HeatmapResponse;
	}
	let { data }: Props = $props();

	interface Day {
		iso: string;
		tokens: number;
		count: number;
		level: number;
		inRange: boolean;
	}

	function parseISO(iso: string): Date {
		const [y, m, d] = iso.split('-').map(Number);
		return new Date(y, m - 1, d);
	}
	function toISO(d: Date): string {
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	// Log-scaled intensity so a few huge days don't flatten everything else.
	function levelFor(tokens: number, max: number): number {
		if (tokens <= 0) return 0;
		if (max <= 0) return 1;
		const r = Math.log(tokens + 1) / Math.log(max + 1);
		return Math.min(4, Math.max(1, Math.ceil(r * 4)));
	}

	const weeks = $derived.by(() => {
		const tokensByDate = new Map(data.cells.map((c) => [c.date, c]));
		const start = parseISO(data.start);
		const end = parseISO(data.end);

		// Pad the start back to the previous Sunday so weeks form clean columns.
		const gridStart = new Date(start);
		gridStart.setDate(gridStart.getDate() - gridStart.getDay());

		const cols: Day[][] = [];
		let cursor = new Date(gridStart);
		while (cursor <= end) {
			const col: Day[] = [];
			for (let dow = 0; dow < 7; dow++) {
				const iso = toISO(cursor);
				const inRange = cursor >= start && cursor <= end;
				const cell = tokensByDate.get(iso);
				const tokens = cell?.tokens ?? 0;
				col.push({
					iso,
					tokens,
					count: cell?.count ?? 0,
					level: inRange ? levelFor(tokens, data.max_tokens) : 0,
					inRange
				});
				cursor.setDate(cursor.getDate() + 1);
			}
			cols.push(col);
		}
		return cols;
	});

	// Month labels positioned above the first week of each month.
	const monthLabels = $derived.by(() => {
		const labels: { col: number; text: string }[] = [];
		let lastMonth = -1;
		weeks.forEach((col, i) => {
			const first = col.find((d) => d.inRange) ?? col[0];
			const dt = parseISO(first.iso);
			if (dt.getMonth() !== lastMonth) {
				lastMonth = dt.getMonth();
				labels.push({ col: i, text: dt.toLocaleDateString('en-US', { month: 'short' }) });
			}
		});
		return labels;
	});

	const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

	let hovered = $state<Day | null>(null);
	let tipX = $state(0);
	let tipY = $state(0);

	function show(e: MouseEvent, day: Day) {
		if (!day.inRange) return;
		hovered = day;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const host = (e.currentTarget as HTMLElement).closest('.heatmap') as HTMLElement;
		const hostRect = host.getBoundingClientRect();
		tipX = rect.left - hostRect.left + rect.width / 2;
		tipY = rect.top - hostRect.top;
	}
</script>

<div class="heatmap">
	<div class="scroll">
		<div class="months" style="grid-template-columns: repeat({weeks.length}, 13px)">
			{#each monthLabels as l}
				<span class="month" style="grid-column: {l.col + 1}">{l.text}</span>
			{/each}
		</div>

		<div class="body">
			<div class="days">
				{#each dayLabels as d}
					<span class="day">{d}</span>
				{/each}
			</div>

			<div class="grid" style="grid-template-columns: repeat({weeks.length}, 13px)">
				{#each weeks as col}
					<div class="col">
						{#each col as day}
							<div
								class="cell lvl-{day.level}"
								class:out={!day.inRange}
								role="presentation"
								onmouseenter={(e) => show(e, day)}
								onmouseleave={() => (hovered = null)}
							></div>
						{/each}
					</div>
				{/each}
			</div>
		</div>
	</div>

	<div class="footer">
		<span class="hint">{grouped(data.max_tokens)} on the busiest day</span>
		<div class="scale">
			<span>less</span>
			<span class="cell lvl-0"></span>
			<span class="cell lvl-1"></span>
			<span class="cell lvl-2"></span>
			<span class="cell lvl-3"></span>
			<span class="cell lvl-4"></span>
			<span>more</span>
		</div>
	</div>

	{#if hovered}
		<div class="tip" style="left: {tipX}px; top: {tipY}px">
			<strong class="num">{grouped(hovered.tokens)}</strong> tokens
			<span class="tip-date">{longDate(hovered.iso)} · {hovered.count} msgs</span>
		</div>
	{/if}
</div>

<style>
	.heatmap {
		position: relative;
	}
	.scroll {
		overflow-x: auto;
		padding-bottom: 0.4rem;
	}
	.months {
		display: grid;
		margin-left: 30px;
		margin-bottom: 6px;
		height: 12px;
	}
	.month {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		color: var(--color-faint);
		grid-row: 1;
	}
	.body {
		display: flex;
		gap: 6px;
	}
	.days {
		display: grid;
		grid-template-rows: repeat(7, 13px);
		gap: 0;
		padding-top: 0;
	}
	.day {
		font-family: var(--font-mono);
		font-size: 0.58rem;
		color: var(--color-faint);
		line-height: 13px;
		height: 13px;
	}
	.grid {
		display: grid;
		gap: 0;
	}
	.col {
		display: grid;
		grid-template-rows: repeat(7, 13px);
	}
	.cell {
		width: 11px;
		height: 11px;
		margin: 1px;
		border-radius: 2.5px;
		background: var(--color-ink-800);
		transition: transform 0.12s ease;
	}
	.cell.lvl-0 {
		background: #211a16;
	}
	.cell.lvl-1 {
		background: rgba(217, 119, 87, 0.28);
	}
	.cell.lvl-2 {
		background: rgba(217, 119, 87, 0.5);
	}
	.cell.lvl-3 {
		background: rgba(217, 119, 87, 0.74);
	}
	.cell.lvl-4 {
		background: #f0a07e;
		box-shadow: 0 0 8px rgba(232, 138, 102, 0.5);
	}
	.cell.out {
		background: transparent;
	}
	.grid .cell:hover {
		transform: scale(1.35);
		outline: 1px solid rgba(244, 237, 227, 0.5);
	}
	.footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 0.9rem;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.hint {
		font-size: 0.72rem;
		color: var(--color-faint);
	}
	.scale {
		display: flex;
		align-items: center;
		gap: 4px;
		font-family: var(--font-mono);
		font-size: 0.6rem;
		color: var(--color-faint);
	}
	.scale .cell {
		margin: 0;
		transition: none;
	}
	.tip {
		position: absolute;
		transform: translate(-50%, calc(-100% - 8px));
		background: #0f0c0a;
		border: 1px solid rgba(217, 119, 87, 0.4);
		border-radius: 8px;
		padding: 0.5rem 0.7rem;
		font-size: 0.78rem;
		color: var(--color-cream-dim);
		white-space: nowrap;
		pointer-events: none;
		z-index: 20;
		box-shadow: 0 10px 30px -8px rgba(0, 0, 0, 0.8);
	}
	.tip strong {
		color: var(--color-clay-bright);
	}
	.tip-date {
		display: block;
		font-size: 0.66rem;
		color: var(--color-faint);
		margin-top: 0.15rem;
	}
</style>
