<script lang="ts">
	import { onMount } from 'svelte';
	import { fetchDashboard, refreshLogs } from '$lib/api';
	import type { DashboardData } from '$lib/types';
	import { compact, grouped, full, money, longDate, relativeTime } from '$lib/format';
	import { rangeToDates, RANGE_NOUN, type RangeKey } from '$lib/ranges';

	import KpiCard from '$lib/components/KpiCard.svelte';
	import DailyChart from '$lib/components/DailyChart.svelte';
	import ModelDonut from '$lib/components/ModelDonut.svelte';
	import Heatmap from '$lib/components/Heatmap.svelte';
	import ProjectList from '$lib/components/ProjectList.svelte';
	import RefreshButton from '$lib/components/RefreshButton.svelte';
	import RangeSelector from '$lib/components/RangeSelector.svelte';

	let data = $state<DashboardData | null>(null);
	let error = $state<string | null>(null);
	let refreshing = $state(false);
	let updating = $state(false);

	let range = $state<RangeKey>('30d');
	let project = $state<string | null>(null);

	async function load(showOverlay = false) {
		if (showOverlay) updating = true;
		try {
			error = null;
			const { start, end } = rangeToDates(range);
			data = await fetchDashboard({ start, end, project });
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load data';
		} finally {
			updating = false;
		}
	}

	function setRange(key: RangeKey) {
		if (key === range) return;
		range = key;
		load(true);
	}

	function selectProject(p: string) {
		project = project === p ? null : p; // toggle off if same
		load(true);
	}

	function clearProject() {
		project = null;
		load(true);
	}

	async function refresh() {
		refreshing = true;
		try {
			await refreshLogs();
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Refresh failed';
		} finally {
			refreshing = false;
		}
	}

	onMount(() => load());
</script>

<svelte:head>
	<title>Claude Usage Dashboard</title>
</svelte:head>

<main class="page">
	<!-- Header -->
	<header class="masthead rise">
		<div class="brand">
			<span class="mark" aria-hidden="true"></span>
			<div>
				<h1 class="serif title">Usage Observatory</h1>
				<p class="tagline">Your Claude Code activity, parsed locally · nothing leaves this machine</p>
			</div>
		</div>
		<div class="head-actions">
			{#if data?.summary.generated_at}
				<span class="stamp num">updated {relativeTime(data.summary.generated_at)}</span>
			{/if}
			<RefreshButton busy={refreshing} onrefresh={refresh} />
		</div>
	</header>

	{#if error}
		<div class="panel error rise">
			<strong>Couldn't reach the backend.</strong>
			<span>{error}</span>
			<span class="hint">Make sure the API is running: <code>uvicorn main:app --port 8000</code></span>
			<button class="retry" onclick={() => load()}>Try again</button>
		</div>
	{:else if !data}
		<section class="kpis">
			{#each Array(4) as _}
				<div class="panel skel-card"><div class="shimmer"></div></div>
			{/each}
		</section>
		<div class="panel skel-wide"><div class="shimmer"></div></div>
		<div class="loading-note num">Reading your logs…</div>
	{:else}
		<!-- Controls: range + active project filter -->
		<div class="controls rise" style="animation-delay: 40ms">
			<RangeSelector value={range} onchange={setRange} />
			{#if project}
				<button class="chip" onclick={clearProject} title="Clear project filter">
					<span class="chip-label">filtered</span>
					<span class="chip-name">{project}</span>
					<span class="chip-x" aria-hidden="true">✕</span>
				</button>
			{/if}
			{#if updating}
				<span class="updating num">updating…</span>
			{/if}
		</div>

		<div class="content" class:dim={updating}>
			<!-- Hero -->
			<section class="hero rise" style="animation-delay: 60ms">
				<div class="hero-main panel">
					<span class="eyebrow">
						Total tokens · {RANGE_NOUN[range]}{project ? ` · ${project}` : ''}
					</span>
					<div class="hero-number num">{full(data.summary.total_tokens)}</div>
					<div class="hero-break">
						{#each [['Input', data.summary.breakdown.input], ['Output', data.summary.breakdown.output], ['Cache write', data.summary.breakdown.cache_creation], ['Cache read', data.summary.breakdown.cache_read]] as [label, val]}
							<div class="break-item">
								<span class="break-label">{label}</span>
								<span class="break-val num">{compact(Number(val))}</span>
							</div>
						{/each}
					</div>
					<p class="hero-foot">
						{data.summary.first_date ? `${longDate(data.summary.first_date)} → ${longDate(data.summary.last_date)}` : 'No activity in range'}
						· {data.summary.active_days} active days
					</p>
				</div>
			</section>

			<!-- KPI row (range + project aware) -->
			<section class="kpis">
				<KpiCard label="Estimated cost" value={money(data.summary.estimated_cost)} sub="API-equivalent, not a bill" accent delay={120} />
				<KpiCard label="Avg / active day" value={compact(data.summary.avg_tokens_per_active_day)} sub="tokens" delay={170} />
				<KpiCard label="Messages" value={grouped(data.summary.total_messages)} sub="{data.summary.total_sessions} sessions" delay={220} />
				<KpiCard label="Projects" value={grouped(data.summary.total_projects)} sub="{data.summary.total_models} models used" delay={270} />
			</section>

			<!-- Daily chart -->
			<section class="panel block rise" style="animation-delay: 200ms">
				<div class="block-head">
					<div>
						<span class="eyebrow">{RANGE_NOUN[range]}</span>
						<h2 class="serif block-title">Daily consumption</h2>
					</div>
				</div>
				<DailyChart data={data.daily.daily} />
			</section>

			<!-- Models + Projects -->
			<section class="split">
				<div class="panel block rise" style="animation-delay: 260ms">
					<div class="block-head">
						<div>
							<span class="eyebrow">Distribution · est. cost</span>
							<h2 class="serif block-title">By model</h2>
						</div>
					</div>
					{#if data.models.length}
						<ModelDonut models={data.models} />
					{:else}
						<p class="empty">No usage in this range.</p>
					{/if}
				</div>

				<div class="panel block rise" style="animation-delay: 320ms">
					<div class="block-head">
						<div>
							<span class="eyebrow">Click to filter</span>
							<h2 class="serif block-title">Top projects</h2>
						</div>
					</div>
					<ProjectList projects={data.projects} selected={project} onselect={selectProject} />
				</div>
			</section>

			<!-- Heatmap -->
			<section class="panel block rise" style="animation-delay: 380ms">
				<div class="block-head">
					<div>
						<span class="eyebrow">Activity · trailing year{project ? ` · ${project}` : ''}</span>
						<h2 class="serif block-title">The last year</h2>
					</div>
				</div>
				<Heatmap data={data.heatmap} />
			</section>

			<footer class="foot">
				<span>Claude Usage Dashboard · local &amp; private · cost figures are estimates, not billing</span>
			</footer>
		</div>
	{/if}
</main>

<style>
	.page {
		position: relative;
		z-index: 1;
		max-width: 1180px;
		margin: 0 auto;
		padding: 3rem 1.5rem 5rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	/* Header */
	.masthead {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1.5rem;
		flex-wrap: wrap;
		margin-bottom: 0.5rem;
	}
	.brand {
		display: flex;
		gap: 1rem;
		align-items: center;
	}
	.mark {
		width: 38px;
		height: 38px;
		border-radius: 12px;
		background: radial-gradient(circle at 35% 30%, var(--color-clay-bright), var(--color-clay-deep));
		box-shadow: 0 0 28px -4px rgba(217, 119, 87, 0.6);
		flex-shrink: 0;
	}
	.title {
		font-size: clamp(1.7rem, 3.2vw, 2.4rem);
		font-weight: 600;
		line-height: 1;
		letter-spacing: -0.01em;
		margin: 0;
		color: var(--color-cream);
	}
	.tagline {
		margin: 0.4rem 0 0;
		font-size: 0.82rem;
		color: var(--color-muted);
	}
	.head-actions {
		display: flex;
		align-items: center;
		gap: 0.9rem;
	}
	.stamp {
		font-size: 0.68rem;
		color: var(--color-faint);
	}

	/* Controls */
	.controls {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		flex-wrap: wrap;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.8rem;
		border-radius: 999px;
		border: 1px solid rgba(217, 119, 87, 0.4);
		background: rgba(217, 119, 87, 0.1);
		color: var(--color-clay-bright);
		font-size: 0.76rem;
		cursor: pointer;
		transition: background 0.25s var(--ease-out-soft);
	}
	.chip:hover {
		background: rgba(217, 119, 87, 0.18);
	}
	.chip-label {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--color-faint);
	}
	.chip-name {
		font-weight: 500;
		color: var(--color-cream);
	}
	.chip-x {
		font-size: 0.7rem;
		opacity: 0.8;
	}
	.updating {
		font-size: 0.68rem;
		color: var(--color-faint);
		letter-spacing: 0.08em;
	}

	/* Content (dims while refetching) */
	.content {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		transition: opacity 0.25s ease;
	}
	.content.dim {
		opacity: 0.45;
		pointer-events: none;
	}

	/* Hero */
	.hero-main {
		padding: 2rem 2.2rem;
		overflow: hidden;
	}
	.hero-number {
		font-size: clamp(2.6rem, 8vw, 5.2rem);
		font-weight: 600;
		line-height: 0.95;
		color: var(--color-cream);
		margin: 0.6rem 0 1.4rem;
		background: linear-gradient(120deg, #f4ede3 30%, var(--color-clay-bright));
		-webkit-background-clip: text;
		background-clip: text;
		-webkit-text-fill-color: transparent;
	}
	.hero-break {
		display: flex;
		gap: 2.4rem;
		flex-wrap: wrap;
		padding-top: 1.2rem;
		border-top: 1px solid rgba(244, 237, 227, 0.08);
	}
	.break-item {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.break-label {
		font-size: 0.68rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-faint);
	}
	.break-val {
		font-size: 1.15rem;
		color: var(--color-cream-dim);
		font-weight: 500;
	}
	.hero-foot {
		margin: 1.3rem 0 0;
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--color-faint);
	}

	/* KPI grid */
	.kpis {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1.1rem;
	}

	/* Blocks */
	.block {
		padding: 1.6rem 1.7rem;
	}
	.block-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 1.4rem;
	}
	.block-title {
		font-size: 1.4rem;
		font-weight: 500;
		margin: 0.3rem 0 0;
		color: var(--color-cream);
	}
	.split {
		display: grid;
		grid-template-columns: 0.85fr 1.15fr;
		gap: 1.1rem;
	}
	.empty {
		color: var(--color-faint);
		font-size: 0.85rem;
		text-align: center;
		padding: 2rem 0;
	}

	/* Error */
	.error {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1.6rem 1.7rem;
		border-color: rgba(217, 119, 87, 0.4);
	}
	.error strong {
		color: var(--color-clay-bright);
		font-size: 1.05rem;
	}
	.error span {
		color: var(--color-muted);
		font-size: 0.85rem;
	}
	.error code {
		font-family: var(--font-mono);
		color: var(--color-cream-dim);
		background: var(--color-ink-800);
		padding: 0.1rem 0.4rem;
		border-radius: 5px;
	}
	.retry {
		align-self: flex-start;
		margin-top: 0.6rem;
		padding: 0.45rem 1rem;
		border-radius: 999px;
		border: 1px solid rgba(217, 119, 87, 0.4);
		background: transparent;
		color: var(--color-clay-bright);
		font-family: var(--font-mono);
		font-size: 0.78rem;
		cursor: pointer;
	}
	.retry:hover {
		background: rgba(217, 119, 87, 0.12);
	}

	/* Loading */
	.skel-card {
		height: 110px;
	}
	.skel-wide {
		height: 320px;
	}
	.shimmer {
		width: 100%;
		height: 100%;
		border-radius: 14px;
		background: linear-gradient(
			100deg,
			var(--color-ink-850) 30%,
			var(--color-ink-800) 50%,
			var(--color-ink-850) 70%
		);
		background-size: 200% 100%;
		animation: shimmer 1.4s ease-in-out infinite;
	}
	@keyframes shimmer {
		to {
			background-position: -200% 0;
		}
	}
	.loading-note {
		text-align: center;
		color: var(--color-faint);
		font-size: 0.8rem;
		letter-spacing: 0.1em;
	}

	/* Footer */
	.foot {
		margin-top: 1.5rem;
		text-align: center;
		font-family: var(--font-mono);
		font-size: 0.7rem;
		color: var(--color-faint);
	}

	@media (max-width: 860px) {
		.kpis {
			grid-template-columns: repeat(2, 1fr);
		}
		.split {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 520px) {
		.page {
			padding: 2rem 1rem 4rem;
		}
		.kpis {
			grid-template-columns: 1fr;
		}
		.hero-break {
			gap: 1.4rem;
		}
	}
</style>
