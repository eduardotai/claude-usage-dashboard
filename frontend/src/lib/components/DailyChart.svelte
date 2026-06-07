<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Chart } from 'chart.js/auto';
	import type { DailyPoint } from '$lib/types';
	import { compact, grouped, shortDate } from '$lib/format';

	interface Props {
		data: DailyPoint[];
	}
	let { data }: Props = $props();

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;

	function build() {
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		// Vertical clay gradient for the bars.
		const grad = ctx.createLinearGradient(0, 0, 0, canvas.offsetHeight || 320);
		grad.addColorStop(0, 'rgba(232, 138, 102, 0.95)');
		grad.addColorStop(1, 'rgba(184, 92, 62, 0.35)');

		chart = new Chart(ctx, {
			type: 'bar',
			data: {
				labels: data.map((d) => shortDate(d.date)),
				datasets: [
					{
						data: data.map((d) => d.tokens),
						backgroundColor: grad,
						hoverBackgroundColor: '#f0a07e',
						borderRadius: 5,
						borderSkipped: false,
						maxBarThickness: 26
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				animation: { duration: 700, easing: 'easeOutQuart' },
				plugins: {
					legend: { display: false },
					tooltip: {
						backgroundColor: '#1b1613',
						borderColor: 'rgba(217,119,87,0.4)',
						borderWidth: 1,
						padding: 12,
						titleColor: '#f4ede3',
						titleFont: { family: 'IBM Plex Mono', size: 11 },
						bodyColor: '#d97757',
						bodyFont: { family: 'IBM Plex Mono', size: 13, weight: 600 },
						displayColors: false,
						callbacks: {
							title: (items) => shortDate(data[items[0].dataIndex].date),
							label: (item) => `${grouped(Number(item.parsed.y))} tokens`
						}
					}
				},
				scales: {
					x: {
						grid: { display: false },
						border: { display: false },
						ticks: {
							color: '#6f6357',
							font: { family: 'IBM Plex Mono', size: 9 },
							maxRotation: 0,
							autoSkip: true,
							maxTicksLimit: 12
						}
					},
					y: {
						grid: { color: 'rgba(244,237,227,0.05)' },
						border: { display: false },
						ticks: {
							color: '#6f6357',
							font: { family: 'IBM Plex Mono', size: 9 },
							maxTicksLimit: 5,
							callback: (v) => compact(Number(v))
						}
					}
				}
			}
		});
	}

	onMount(build);

	$effect(() => {
		// Re-render when the dataset changes (e.g. after a refresh).
		if (chart) {
			chart.data.labels = data.map((d) => shortDate(d.date));
			chart.data.datasets[0].data = data.map((d) => d.tokens);
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
