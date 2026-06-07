<script lang="ts">
	interface Props {
		label: string;
		value: string;
		sub?: string;
		accent?: boolean;
		delay?: number;
	}
	let { label, value, sub = '', accent = false, delay = 0 }: Props = $props();
</script>

<div class="panel panel-hover rise kpi" style="animation-delay: {delay}ms" class:accent>
	<span class="eyebrow">{label}</span>
	<span class="num value">{value}</span>
	{#if sub}
		<span class="sub">{sub}</span>
	{/if}
	{#if accent}
		<div class="glow" aria-hidden="true"></div>
	{/if}
</div>

<style>
	.kpi {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		padding: 1.4rem 1.5rem;
		overflow: hidden;
	}
	.value {
		font-size: clamp(1.5rem, 2.4vw, 2.2rem);
		font-weight: 500;
		color: var(--color-cream);
		line-height: 1;
	}
	.sub {
		font-size: 0.8rem;
		color: var(--color-muted);
	}
	.accent .value {
		color: var(--color-clay-bright);
	}
	.accent {
		border-color: rgba(217, 119, 87, 0.28);
	}
	.glow {
		position: absolute;
		right: -40px;
		top: -40px;
		width: 160px;
		height: 160px;
		background: radial-gradient(circle, rgba(217, 119, 87, 0.22), transparent 70%);
		pointer-events: none;
	}
</style>
