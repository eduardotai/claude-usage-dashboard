<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Chart } from 'chart.js/auto';
	import type { ModelStat } from '$lib/types';
	import { compact, grouped, modelLabel, money } from '$lib/format';
	import { colorAt } from '$lib/palette';

	interface Props {
		models: ModelStat[];
	}
	let { models }: Props = $props();

	let canvas: HTMLCanvasElement;
	let chart: Chart | null = null;

	const total = $derived(models.reduce((s, m) => s + m.tokens, 0));

	function build() {
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		chart = new Chart(ctx, {
			type: 'doughnut',
			data: {
				labels: models.map((m) => modelLabel(m.model)),
				datasets: [
					{
						data: models.map((m) => m.tokens),
						backgroundColor: models.map((_, i) => colorAt(i)),
						borderColor: '#16120f',
						borderWidth: 3,
						hoverOffset: 8
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				cutout: '68%',
				animation: { animateRotate: true, duration: 800, easing: 'easeOutQuart' },
				plugins: {
					legend: { display: false },
					tooltip: {
						backgroundColor: '#1b1613',
						borderColor: 'rgba(217,119,87,0.4)',
						borderWidth: 1,
						padding: 12,
						titleColor: '#f4ede3',
						titleFont: { family: 'IBM Plex Sans', size: 12, weight: 600 },
						bodyColor: '#c8bcae',
						bodyFont: { family: 'IBM Plex Mono', size: 12 },
						displayColors: false,
						callbacks: {
							label: (item) => {
								const pct = ((item.parsed / total) * 100).toFixed(1);
								return `${grouped(item.parsed)} · ${pct}%`;
							}
						}
					}
				}
			}
		});
	}

	onMount(build);

	$effect(() => {
		if (chart) {
			chart.data.labels = models.map((m) => modelLabel(m.model));
			chart.data.datasets[0].data = models.map((m) => m.tokens);
			chart.data.datasets[0].backgroundColor = models.map((_, i) => colorAt(i));
			chart.update();
		}
	});

	onDestroy(() => chart?.destroy());
</script>

<div class="donut-layout">
	<div class="donut">
		<canvas bind:this={canvas}></canvas>
		<div class="center">
			<span class="num big">{compact(total)}</span>
			<span class="lbl">tokens</span>
		</div>
	</div>

	<ul class="legend">
		{#each models as m, i (m.model)}
			<li>
				<span class="dot" style="background: {colorAt(i)}"></span>
				<span class="name">{modelLabel(m.model)}</span>
				<span class="num cost" class:na={m.cost === null} title={m.cost === null ? 'No public price for this model: excluded from cost' : 'API-equivalent estimate'}>{money(m.cost)}</span>
				<span class="num pct">{(m.share * 100).toFixed(1)}%</span>
			</li>
		{/each}
	</ul>
</div>

<style>
	.donut-layout {
		display: flex;
		flex-direction: column;
		gap: 1.4rem;
		align-items: center;
	}
	.donut {
		position: relative;
		width: 100%;
		max-width: 220px;
		height: 220px;
	}
	.center {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		pointer-events: none;
	}
	.big {
		font-size: 1.7rem;
		font-weight: 600;
		color: var(--color-cream);
	}
	.lbl {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: var(--color-faint);
		margin-top: 0.2rem;
	}
	.legend {
		list-style: none;
		margin: 0;
		padding: 0;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.85rem;
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 3px;
		flex-shrink: 0;
	}
	.name {
		color: var(--color-cream-dim);
	}
	.cost.na {
		color: var(--color-faint);
		font-style: italic;
	}
	.cost {
		margin-left: auto;
		color: var(--color-clay-bright);
		font-size: 0.78rem;
	}
	.pct {
		color: var(--color-muted);
		font-size: 0.8rem;
		min-width: 3.2em;
		text-align: right;
	}
</style>
