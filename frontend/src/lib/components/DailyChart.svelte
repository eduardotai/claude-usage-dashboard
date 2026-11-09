<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Chart, type ChartDataset } from 'chart.js/auto';
	import type { DailyPoint } from '$lib/types';
	import { compact, grouped, money, shortDate } from '$lib/format';
	import { agentColor, alpha } from '$lib/palette';

	interface Props {
		data: DailyPoint[];
		/** Agents to stack, bottom to top. */
		agents: string[];
		/** Display names for agent ids. */
		labels?: Record<string, string>;
		/** What the bars show: measured tokens or estimated API-equivalent cost. */
		metric?: 'tokens' | 'cost';
	}
	let { data, agents, labels = {}, metric = 'tokens' }: Props = $props();

	const valueOf = (d: DailyPoint, agent: string) => {
		const s = d.by_agent?.[agent];
		return s ? (metric === 'cost' ? s.cost : s.tokens) : 0;
	};
	const fmtTick = (v: number) => (metric === 'cost' ? money(v) : compact(v));
	const fmtVal = (v: number) => (metric === 'cost' ? money(v) : `${grouped(v)} tokens`);

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;

	function gradientFor(ctx: CanvasRenderingContext2D, hex: string) {
		const g = ctx.createLinearGradient(0, 0, 0, canvas.offsetHeight || 320);
		g.addColorStop(0, alpha(hex, 0.95));
		g.addColorStop(1, alpha(hex, 0.45));
		return g;
	}

	const stackOrder = () => (agents.length ? agents : ['claude-code']);

	function datasets(ctx: CanvasRenderingContext2D): ChartDataset<'bar'>[] {
		const list = stackOrder();
		return list.map((id, i) => ({
			label: labels[id] ?? id,
			data: data.map((d) => valueOf(d, id)),
			backgroundColor: gradientFor(ctx, agentColor(id)),
			hoverBackgroundColor: agentColor(id),
			// Round only the top segment of each stack.
			borderRadius: i === list.length - 1 ? { topLeft: 5, topRight: 5 } : 0,
			borderSkipped: false,
			maxBarThickness: 26,
			stack: 'burn'
		}));
	}

	function build() {
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		chart = new Chart(ctx, {
			type: 'bar',
			data: { labels: data.map((d) => shortDate(d.date)), datasets: datasets(ctx) },
			options: {
				responsive: true,
				maintainAspectRatio: false,
				animation: { duration: 700, easing: 'easeOutQuart' },
				interaction: { mode: 'index', intersect: false },
				plugins: {
					legend: { display: false },
					tooltip: {
						backgroundColor: '#1b1613',
						borderColor: 'rgba(217,119,87,0.4)',
						borderWidth: 1,
						padding: 12,
						titleColor: '#f4ede3',
						titleFont: { family: 'IBM Plex Mono', size: 11 },
						bodyColor: '#c8bcae',
						bodyFont: { family: 'IBM Plex Mono', size: 12 },
						footerColor: '#e88a66',
						footerFont: { family: 'IBM Plex Mono', size: 12, weight: 600 },
						boxWidth: 8,
						boxHeight: 8,
						boxPadding: 4,
						usePointStyle: true,
						filter: (item) => Number(item.parsed.y) > 0,
						itemSort: (a, b) => Number(b.parsed.y) - Number(a.parsed.y),
						callbacks: {
							title: (items) => shortDate(data[items[0].dataIndex].date),
							label: (item) => ` ${item.dataset.label}  ${fmtVal(Number(item.parsed.y))}`,
							footer: (items) => {
								if (!items.length) return '';
								const d = data[items[0].dataIndex];
								const total = metric === 'cost' ? d.cost : d.tokens;
								return `Total  ${fmtVal(total)}${metric === 'cost' ? ' est.' : ''}`;
							},
							labelPointStyle: () => ({ pointStyle: 'rectRounded', rotation: 0 }),
							labelColor: (item) => {
								const c = agentColor(stackOrder()[item.datasetIndex] ?? '');
								return { borderColor: c, backgroundColor: c, borderWidth: 0, borderRadius: 2 };
							}
						}
					}
				},
				scales: {
					x: {
						stacked: true,
						grid: { display: false },
						border: { display: false },
						ticks: { color: '#6f6357', font: { family: 'IBM Plex Mono', size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 }
					},
					y: {
						stacked: true,
						grid: { color: 'rgba(244,237,227,0.05)' },
						border: { display: false },
						ticks: { color: '#6f6357', font: { family: 'IBM Plex Mono', size: 9 }, maxTicksLimit: 5, callback: (v) => fmtTick(Number(v)) }
					}
				}
			}
		});
	}

	onMount(build);

	$effect(() => {
		// Track inputs; rebuild datasets when data, agents or metric change.
		void [data, agents, metric];
		if (chart && canvas) {
			const ctx = canvas.getContext('2d');
			if (!ctx) return;
			chart.data.labels = data.map((d) => shortDate(d.date));
			chart.data.datasets = datasets(ctx);
			chart.update();
		}
	});

	onDestroy(() => chart?.destroy());
</script>

<div class="wrap">
	<canvas bind:this={canvas}></canvas>
</div>

<style>
	.wrap {
		position: relative;
		height: 320px;
		width: 100%;
	}
</style>
