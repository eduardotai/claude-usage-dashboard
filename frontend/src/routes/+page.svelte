<script lang="ts">
	import { onMount } from 'svelte';
	import { fetchDashboard, refreshLogs } from '$lib/api';
	import type { DashboardData } from '$lib/types';
	import { compact, grouped, full, money, longDate, pct, relativeTime } from '$lib/format';
	import { rangeToDates, RANGE_NOUN, type RangeKey } from '$lib/ranges';

	import KpiCard from '$lib/components/KpiCard.svelte';
	import DailyChart from '$lib/components/DailyChart.svelte';
	import ModelDonut from '$lib/components/ModelDonut.svelte';
	import Heatmap from '$lib/components/Heatmap.svelte';
	import ProjectList from '$lib/components/ProjectList.svelte';
	import RefreshButton from '$lib/components/RefreshButton.svelte';
	import RangeSelector from '$lib/components/RangeSelector.svelte';
	import AgentSelector from '$lib/components/AgentSelector.svelte';
	import ProvenanceBadge from '$lib/components/ProvenanceBadge.svelte';

	let data = $state<DashboardData | null>(null);
	let error = $state<string | null>(null);
	let refreshing = $state(false);
	let updating = $state(false);

	let range = $state<RangeKey>('30d');
	let project = $state<string | null>(null);
	let agent = $state<string | null>(null);
	let metric = $state<'tokens' | 'cost'>('tokens');

	const agentLabel = $derived(data?.agents.find((a) => a.id === agent)?.label ?? null);
	const scopeNote = $derived([agentLabel, project].filter(Boolean).join(' · '));
	const hasData = $derived((data?.agents ?? []).some((a) => a.detected));

	const PRICING_SOURCE: Record<string, string> = {
		live: 'downloaded just now',
		cache: 'cached today',
		'stale-cache': 'cached copy (offline)',
		bundled: 'bundled snapshot (offline)'
	};

	async function load(showOverlay = false) {
		if (showOverlay) updating = true;
		try {
			error = null;
			const { start, end } = rangeToDates(range);
			data = await fetchDashboard({ start, end, project, agent });
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

	function setAgent(id: string | null) {
		if (id === agent) return;
		agent = id;
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
	<title>AgentBurn{scopeNote ? ` · ${scopeNote}` : ''}</title>
</svelte:head>

<main class="page">
	<!-- Header -->
	<header class="masthead rise">
		<div class="brand">
			<span class="mark" aria-hidden="true">
				<svg viewBox="0 0 24 24" width="20" height="20" fill="none">
					<path
						d="M12 2.5c.6 3.1 2.6 4.9 4.2 6.8 1.5 1.8 2.3 3.6 2.3 5.6A6.5 6.5 0 0 1 12 21.5a6.5 6.5 0 0 1-6.5-6.6c0-2.3 1.1-4.1 2.6-5.6.2 1.7 1 2.9 2.2 3.5-.3-3.7.6-7.4 1.7-10.3Z"
						fill="rgba(255,240,228,0.92)"
					/>
				</svg>
			</span>
			<div>
				<h1 class="serif title">AgentBurn</h1>
				<p class="tagline">What your AI coding agents burn, in tokens and API-equivalent dollars · parsed locally, nothing leaves this machine</p>
			</div>
		</div>
		<div class="head-actions">
			{#if data?.summary.generated_at}
				<span class="stamp num">scanned {relativeTime(data.summary.generated_at)}</span>
			{/if}
			<RefreshButton busy={refreshing} onrefresh={refresh} />
		</div>
	</header>

	{#if error}
		<div class="panel error rise">
			<strong>Couldn't reach the AgentBurn server.</strong>
			<span>{error}</span>
			<span class="hint">Make sure it is running: <code>npx agentburn</code></span>
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
		<!-- Controls: agent + range + active project filter -->
		<div class="controls rise" style="animation-delay: 40ms">
			<AgentSelector agents={data.agents} value={agent} onchange={setAgent} />
			<RangeSelector value={range} onchange={setRange} />
			{#if project}
				<button class="chip" onclick={clearProject} title="Clear project filter">
					<span class="chip-label">project</span>
					<span class="chip-name">{project}</span>
					<span class="chip-x" aria-hidden="true">✕</span>
				</button>
			{/if}
			{#if updating}
				<span class="updating num">updating…</span>
			{/if}
		</div>

		{#if !hasData}
			<div class="panel onboarding rise" style="animation-delay: 60ms">
				<span class="eyebrow">No agent logs found</span>
				<h2 class="serif block-title">Nothing to burn yet</h2>
				<p>AgentBurn looked in:</p>
				<ul>
					{#each data.agents.filter((a) => a.status === 'available') as a}
						<li><strong>{a.label}</strong> <code>{a.data_paths.join(', ')}</code></li>
					{/each}
				</ul>
				<p>Use an agent for a bit and hit refresh, or point AgentBurn at another folder: <code>npx agentburn --claude-dir /path/to/projects</code></p>
			</div>
		{/if}

		{#if hasData}
			<div class="content" class:dim={updating}>
				<!-- Hero -->
				<section class="hero rise" style="animation-delay: 60ms">
					<div class="hero-main panel">
						<div class="hero-head">
							<span class="eyebrow">
								Total tokens · {RANGE_NOUN[range]}{scopeNote ? ` · ${scopeNote}` : ''}
							</span>
							<ProvenanceBadge kind={data.summary.provenance.tokens} />
						</div>
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
							{#if data.summary.sidechain_messages}
								· {grouped(data.summary.sidechain_messages)} subagent calls included
							{/if}
						</p>
					</div>
				</section>

				<!-- KPI row (range + project + agent aware) -->
				<section class="kpis">
					<KpiCard
						label="Est. API cost"
						value={data.summary.provenance.cost === 'unavailable' ? 'n/a' : money(data.summary.estimated_cost)}
						sub={data.summary.cost_coverage < 1 && data.summary.total_tokens > 0
							? `${pct(data.summary.cost_coverage)} of tokens priced · not your bill`
							: 'at public API prices · not your bill'}
						provenance={data.summary.provenance.cost}
						accent
						delay={120}
					/>
					<KpiCard label="Avg / active day" value={compact(data.summary.avg_tokens_per_active_day)} sub="tokens" delay={170} />
					<KpiCard label="Model calls" value={grouped(data.summary.total_messages)} sub="{grouped(data.summary.total_sessions)} sessions" delay={220} />
					<KpiCard label="Projects" value={grouped(data.summary.total_projects)} sub="{data.summary.total_models} models used" delay={270} />
				</section>

				{#if data.summary.unpriced_models.length}
					<aside class="panel notice rise" style="animation-delay: 160ms">
						<ProvenanceBadge kind="unavailable" />
						<p>
							<strong>{data.summary.unpriced_models.length === 1 ? '1 model has' : `${data.summary.unpriced_models.length} models have`} no public price</strong>
							and {data.summary.unpriced_models.length === 1 ? 'is' : 'are'} left out of the cost estimate instead of being counted as $0:
							{#each data.summary.unpriced_models.slice(0, 4) as m, i}
								{i ? ', ' : ''}<code>{m.model}</code> <span class="muted">({compact(m.tokens)} tokens)</span>
							{/each}{data.summary.unpriced_models.length > 4 ? ', …' : ''}
						</p>
					</aside>
				{/if}

				<!-- Daily chart -->
				<section class="panel block rise" style="animation-delay: 200ms">
					<div class="block-head">
						<div>
							<span class="eyebrow">{RANGE_NOUN[range]}</span>
							<h2 class="serif block-title">Daily burn</h2>
						</div>
						<div class="toggle" role="tablist" aria-label="Chart metric">
							<button role="tab" aria-selected={metric === 'tokens'} class:active={metric === 'tokens'} onclick={() => (metric = 'tokens')}>Tokens</button>
							<button role="tab" aria-selected={metric === 'cost'} class:active={metric === 'cost'} onclick={() => (metric = 'cost')}>Est. cost</button>
						</div>
					</div>
					<DailyChart data={data.daily.daily} {metric} />
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
						{#if data.projects.length}
							<ProjectList projects={data.projects} selected={project} onselect={selectProject} />
						{:else}
							<p class="empty">No projects in this range.</p>
						{/if}
					</div>
				</section>

				<!-- Heatmap -->
				<section class="panel block rise" style="animation-delay: 380ms">
					<div class="block-head">
						<div>
							<span class="eyebrow">Activity · trailing year{scopeNote ? ` · ${scopeNote}` : ''}</span>
							<h2 class="serif block-title">The last year</h2>
						</div>
					</div>
					<Heatmap data={data.heatmap} />
				</section>

				<footer class="foot">
					<span>AgentBurn v{data.meta.version} · open source (MIT) · local &amp; private</span>
					<span>
						Costs are API-equivalent estimates from
						<a href="https://github.com/BerriAI/litellm" target="_blank" rel="noreferrer">LiteLLM</a> prices
						({PRICING_SOURCE[data.meta.pricing.source] ?? data.meta.pricing.source}, {data.meta.pricing.models} models) — not your subscription bill.
					</span>
				</footer>
			</div>
		{/if}
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
		display: grid;
		place-items: center;
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
	.hero-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.notice {
		display: flex;
		align-items: flex-start;
		gap: 0.9rem;
		padding: 1rem 1.3rem;
		border-color: rgba(154, 141, 126, 0.18);
	}
	.notice p {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.6;
		color: var(--color-muted);
	}
	.notice strong {
		color: var(--color-cream-dim);
		font-weight: 500;
	}
	.notice code,
	.onboarding code {
		font-family: var(--font-mono);
		font-size: 0.76rem;
		color: var(--color-cream-dim);
		background: var(--color-ink-800);
		padding: 0.05rem 0.35rem;
		border-radius: 5px;
	}
	.muted {
		color: var(--color-faint);
	}
	.onboarding {
		padding: 1.6rem 1.7rem;
		color: var(--color-muted);
		font-size: 0.86rem;
		line-height: 1.6;
	}
	.onboarding ul {
		margin: 0.2rem 0 0.8rem;
		padding-left: 1.1rem;
	}
	.onboarding strong {
		color: var(--color-cream-dim);
		font-weight: 500;
		margin-right: 0.3rem;
	}
	.toggle {
		display: inline-flex;
		padding: 3px;
		gap: 2px;
		background: var(--color-ink-850);
		border: 1px solid rgba(244, 237, 227, 0.07);
		border-radius: 999px;
	}
	.toggle button {
		padding: 0.3rem 0.75rem;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--color-muted);
		font-family: var(--font-mono);
		font-size: 0.68rem;
		letter-spacing: 0.04em;
		cursor: pointer;
		transition: background 0.25s var(--ease-out-soft), color 0.25s var(--ease-out-soft);
	}
	.toggle button.active {
		background: var(--color-ink-700);
		color: var(--color-cream);
	}
	.toggle button:focus-visible {
		outline: 2px solid rgba(217, 119, 87, 0.6);
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
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		align-items: center;
		text-align: center;
		line-height: 1.6;
		font-family: var(--font-mono);
		font-size: 0.7rem;
		color: var(--color-faint);
	}

	.foot a {
		color: var(--color-muted);
		text-decoration: underline;
		text-decoration-color: rgba(154, 141, 126, 0.4);
		text-underline-offset: 2px;
	}
	.foot a:hover {
		color: var(--color-clay-bright);
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
