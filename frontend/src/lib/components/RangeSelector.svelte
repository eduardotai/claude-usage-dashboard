<script lang="ts">
	import { RANGES, type RangeKey } from '$lib/ranges';

	interface Props {
		value: RangeKey;
		onchange: (key: RangeKey) => void;
	}
	let { value, onchange }: Props = $props();
</script>

<div class="seg" role="tablist" aria-label="Time range">
	{#each RANGES as r}
		<button
			role="tab"
			aria-selected={value === r.key}
			class:active={value === r.key}
			onclick={() => onchange(r.key)}
		>
			{r.label}
		</button>
	{/each}
</div>

<style>
	.seg {
		display: inline-flex;
		padding: 3px;
		gap: 2px;
		background: var(--color-ink-850);
		border: 1px solid rgba(244, 237, 227, 0.07);
		border-radius: 999px;
	}
	button {
		padding: 0.4rem 0.85rem;
		border: none;
		background: transparent;
		color: var(--color-muted);
		font-family: var(--font-mono);
		font-size: 0.72rem;
		letter-spacing: 0.04em;
		border-radius: 999px;
		cursor: pointer;
		transition:
			color 0.25s var(--ease-out-soft),
			background 0.25s var(--ease-out-soft);
	}
	button:hover {
		color: var(--color-cream-dim);
	}
	button.active {
		background: linear-gradient(180deg, rgba(217, 119, 87, 0.22), rgba(217, 119, 87, 0.08));
		color: var(--color-clay-bright);
		box-shadow: 0 1px 0 rgba(255, 255, 255, 0.05) inset;
	}
</style>
