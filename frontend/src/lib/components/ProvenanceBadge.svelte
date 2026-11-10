<script lang="ts">
	import type { Provenance } from '$lib/types';

	interface Props {
		kind: Provenance;
		/** Optional override for the hover explanation. */
		title?: string;
	}
	let { kind, title }: Props = $props();

	const EXPLAIN: Record<Provenance, string> = {
		measured: 'Measured: read directly from the agent’s own logs or your usage export.',
		estimated: 'Estimated: computed by Burnboard from measured tokens × public API prices (LiteLLM). Not your bill.',
		unavailable: 'Unavailable: the agent does not record this, or the model has no public price.'
	};
</script>

<span class="badge {kind}" title={title ?? EXPLAIN[kind]}>
	<span class="dot" aria-hidden="true"></span>{kind}
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.12rem 0.5rem 0.12rem 0.42rem;
		border-radius: 999px;
		font-family: var(--font-mono);
		font-size: 0.6rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		border: 1px solid currentColor;
		line-height: 1.4;
		cursor: help;
		white-space: nowrap;
	}
	.dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: currentColor;
	}
	.measured {
		color: var(--color-sage);
		border-color: rgba(143, 166, 126, 0.35);
		background: rgba(143, 166, 126, 0.08);
	}
	.estimated {
		color: var(--color-amber);
		border-color: rgba(224, 164, 88, 0.35);
		background: rgba(224, 164, 88, 0.08);
	}
	.unavailable {
		color: var(--color-faint);
		border-color: rgba(154, 141, 126, 0.3);
		background: rgba(154, 141, 126, 0.06);
	}
</style>
