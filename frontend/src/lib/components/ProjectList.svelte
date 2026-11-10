<script lang="ts">
	import type { ProjectStat } from '$lib/types';
	import { compact, grouped, money } from '$lib/format';

	interface Props {
		projects: ProjectStat[];
		limit?: number;
		selected?: string | null;
		onselect?: (project: string) => void;
	}
	let { projects, limit = 8, selected = null, onselect }: Props = $props();

	const shown = $derived(projects.slice(0, limit));
	const max = $derived(shown.length ? shown[0].tokens : 1);
</script>

<ul class="list">
	{#each shown as p, i (p.project)}
		<li>
			<button
				class="row"
				class:selected={selected === p.project}
				style="animation-delay: {i * 45}ms"
				onclick={() => onselect?.(p.project)}
				title="Filter dashboard by {p.project}"
			>
				<div class="meta">
					<span class="rank num">{String(i + 1).padStart(2, '0')}</span>
					<span class="name">{p.project}</span>
					<span class="num tok">{compact(p.tokens)}</span>
				</div>
				<div class="track">
					<div class="fill" style="width: {Math.max((p.tokens / max) * 100, 1.5)}%"></div>
				</div>
				<div class="detail">
					<span>{grouped(p.tokens)} tokens · {p.sessions} {p.sessions === 1 ? 'session' : 'sessions'}</span>
					<span class="cost" title={p.cost === null ? 'No priced models in this project' : p.cost_coverage < 1 ? 'Partial: some models in this project have no public price' : 'API-equivalent estimate'}>{money(p.cost)}{p.cost !== null && p.cost_coverage < 1 ? '*' : ''}</span>
				</div>
			</button>
		</li>
	{/each}
</ul>

<style>
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.row {
		display: block;
		width: 100%;
		text-align: left;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 12px;
		padding: 0.55rem 0.7rem;
		cursor: pointer;
		opacity: 0;
		animation: rowin 0.6s var(--ease-out-soft) forwards;
		transition:
			background 0.25s var(--ease-out-soft),
			border-color 0.25s var(--ease-out-soft);
	}
	.row:hover {
		background: var(--color-ink-850);
		border-color: rgba(244, 237, 227, 0.08);
	}
	.row.selected {
		background: rgba(217, 119, 87, 0.08);
		border-color: rgba(217, 119, 87, 0.35);
	}
	@keyframes rowin {
		from {
			opacity: 0;
			transform: translateX(-8px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}
	.meta {
		display: flex;
		align-items: baseline;
		gap: 0.7rem;
		margin-bottom: 0.4rem;
	}
	.rank {
		font-size: 0.7rem;
		color: var(--color-faint);
	}
	.name {
		font-size: 0.92rem;
		color: var(--color-cream);
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tok {
		margin-left: auto;
		font-size: 0.82rem;
		color: var(--color-clay-bright);
		font-weight: 500;
	}
	.track {
		height: 6px;
		border-radius: 999px;
		background: var(--color-ink-800);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		border-radius: 999px;
		background: linear-gradient(90deg, var(--color-clay-deep), var(--color-clay-bright));
		transition: width 0.8s var(--ease-out-soft);
	}
	.detail {
		display: flex;
		justify-content: space-between;
		margin-top: 0.35rem;
		font-size: 0.72rem;
		color: var(--color-faint);
	}
	.detail .cost {
		color: var(--color-muted);
	}
	@media (prefers-reduced-motion: reduce) {
		.row {
			animation: none;
			opacity: 1;
		}
	}
</style>
