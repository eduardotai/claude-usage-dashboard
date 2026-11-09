<script lang="ts">
	import type { AgentInfo } from '$lib/types';

	interface Props {
		agents: AgentInfo[];
		value: string | null;
		onchange: (agent: string | null) => void;
	}
	let { agents, value, onchange }: Props = $props();
</script>

<div class="seg" role="tablist" aria-label="Agent">
	<button role="tab" aria-selected={value === null} class:active={value === null} onclick={() => onchange(null)}>
		All agents
	</button>
	{#each agents as a (a.id)}
		{@const planned = a.status === 'planned'}
		<button
			role="tab"
			aria-selected={value === a.id}
			class:active={value === a.id}
			disabled={planned}
			title={planned
				? `${a.label} support is on the roadmap`
				: a.detected
					? `Only ${a.label}`
					: `No ${a.label} logs found in ${a.data_paths.join(', ')}`}
			onclick={() => onchange(value === a.id ? null : a.id)}
		>
			<span class="dot" class:live={a.detected} aria-hidden="true"></span>
			{a.label}
			{#if planned}<span class="soon">soon</span>{/if}
		</button>
	{/each}
</div>

<style>
	.seg {
		display: inline-flex;
		max-width: 100%;
		overflow-x: auto;
		scrollbar-width: none;
		padding: 3px;
		gap: 2px;
		background: var(--color-ink-850);
		border: 1px solid rgba(244, 237, 227, 0.07);
		border-radius: 999px;
	}
	.seg::-webkit-scrollbar {
		display: none;
	}
	button {
		flex-shrink: 0;
		white-space: nowrap;
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.4rem 0.85rem;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--color-muted);
		font-family: var(--font-sans);
		font-size: 0.76rem;
		font-weight: 500;
		cursor: pointer;
		transition:
			background 0.25s var(--ease-out-soft),
			color 0.25s var(--ease-out-soft);
	}
	button:hover:not(:disabled):not(.active) {
		color: var(--color-cream);
		background: rgba(244, 237, 227, 0.04);
	}
	button.active {
		background: var(--color-ink-700);
		color: var(--color-cream);
		box-shadow: 0 1px 0 rgba(255, 255, 255, 0.05) inset;
	}
	button:disabled {
		cursor: not-allowed;
		color: var(--color-faint);
		opacity: 0.7;
	}
	button:focus-visible {
		outline: 2px solid rgba(217, 119, 87, 0.6);
		outline-offset: 1px;
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-ink-600);
	}
	.dot.live {
		background: var(--color-clay);
		box-shadow: 0 0 8px rgba(217, 119, 87, 0.7);
	}
	.soon {
		font-family: var(--font-mono);
		font-size: 0.56rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		padding: 0.05rem 0.35rem;
		border-radius: 999px;
		border: 1px solid rgba(244, 237, 227, 0.1);
		color: var(--color-faint);
	}
</style>
