<script lang="ts">
	import type { AgentInfo } from '$lib/types';
	import { compact, grouped, money, pct } from '$lib/format';
	import { agentColor } from '$lib/palette';
	import ProvenanceBadge from './ProvenanceBadge.svelte';

	interface Props {
		agents: AgentInfo[];
		selected: string | null;
		onselect: (id: string) => void;
	}
	let { agents, selected, onselect }: Props = $props();

	/** How to get data in, per agent, when nothing was found. */
	const HINTS: Record<string, string> = {
		'claude-code': 'Use Claude Code, or point at another folder with --claude-dir.',
		codex: 'Use Codex CLI, or set --codex-home / CODEX_HOME.',
		cursor: 'In Cursor’s web dashboard open Usage and export the CSV, then drop it into ~/.agentburn/imports/cursor/ (or pass --cursor-csv).',
		'grok-build': 'Use Grok Build, or set --grok-home / GROK_HOME.'
	};

	type State = 'detected' | 'idle' | 'missing' | 'planned';
	const stateOf = (a: AgentInfo): State =>
		a.status === 'planned' ? 'planned' : !a.detected ? 'missing' : a.usage && a.usage.calls > 0 ? 'detected' : 'idle';
	const STATE_LABEL: Record<State, string> = {
		detected: 'Detected',
		idle: 'No usage in range',
		missing: 'Not found',
		planned: 'Planned'
	};
	const shortPath = (p: string) => p.replace(/^\/(home|Users)\/[^/]+/, '~').replace(/^[A-Z]:\\Users\\[^\\]+/i, '~');
</script>

<div class="grid">
	{#each agents as a (a.id)}
		{@const st = stateOf(a)}
		{@const u = a.usage}
		{@const clickable = st === 'detected' || st === 'idle'}
		<svelte:element
			this={clickable ? 'button' : 'div'}
			class="card panel {st}"
			class:selected={selected === a.id}
			style="--agent: {agentColor(a.id)}"
			onclick={clickable ? () => onselect(a.id) : undefined}
			title={clickable ? (selected === a.id ? 'Show all agents' : `Only ${a.label}`) : undefined}
			role={clickable ? undefined : 'group'}
			aria-label={a.label}
		>
			<div class="top">
				<span class="name"><span class="swatch" aria-hidden="true"></span>{a.label}</span>
				<span class="state">{STATE_LABEL[st]}</span>
			</div>

			{#if (st === 'detected' || st === 'idle') && u}
				<div class="figures">
					<div>
						<span class="fig num">{u.unmeasured_calls === u.calls ? '—' : compact(u.tokens)}</span>
						<span class="cap">tokens</span>
					</div>
					<div>
						<span class="fig num">{u.cost === null ? 'n/a' : money(u.cost)}</span>
						<span class="cap">{u.cost_provenance === 'measured' ? 'recorded cost' : 'est. API cost'}</span>
					</div>
					<div>
						<span class="fig num">{grouped(u.calls)}</span>
						<span class="cap">calls</span>
					</div>
				</div>
				<div class="meta">
					<span class="pair">
						<span class="tag">tokens</span>
						<ProvenanceBadge kind={u.token_coverage > 0 ? 'measured' : 'unavailable'} title={u.token_coverage < 1 ? `Tokens are recorded for ${pct(u.token_coverage)} of calls; the rest are counted as calls only.` : undefined} />
					</span>
					<span class="pair">
						<span class="tag">cost</span>
						<ProvenanceBadge kind={u.cost_provenance} />
					</span>
				</div>
				{#if u.token_coverage < 1}
					<p class="cov num">Tokens recorded for {pct(u.token_coverage)} of calls · {grouped(u.unmeasured_calls)} counted as calls only</p>
				{/if}
			{:else if st === 'detected' || st === 'idle'}
				<p class="hint">No usage in this range.</p>
			{:else if st === 'missing'}
				<p class="hint">{HINTS[a.id] ?? 'No logs found.'}</p>
				<p class="paths">Looked in {#each a.data_paths as p, i}{i ? ', ' : ''}<code>{shortPath(p)}</code>{/each}</p>
			{:else}
				<p class="hint">{a.note ?? 'Support is on the roadmap.'}</p>
			{/if}

			<p class="source">{a.source}</p>
			{#each a.warnings as w}
				<p class="warn">{w}</p>
			{/each}
		</svelte:element>
	{/each}
</div>

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
		gap: 1.1rem;
	}
	.card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		padding: 1.2rem 1.3rem 1.1rem;
		text-align: left;
		font: inherit;
		color: inherit;
		overflow: hidden;
		transition:
			border-color 0.25s var(--ease-out-soft),
			transform 0.25s var(--ease-out-soft);
	}
	.card::before {
		content: '';
		position: absolute;
		inset: 0 0 auto 0;
		height: 2px;
		background: var(--agent);
		opacity: 0.85;
	}
	.card.missing::before,
	.card.planned::before {
		opacity: 0.2;
	}
	button.card {
		cursor: pointer;
	}
	button.card:hover {
		border-color: color-mix(in srgb, var(--agent) 45%, transparent);
		transform: translateY(-1px);
	}
	button.card:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--agent) 70%, transparent);
		outline-offset: 2px;
	}
	.card.selected {
		border-color: color-mix(in srgb, var(--agent) 70%, transparent);
		background: linear-gradient(180deg, color-mix(in srgb, var(--agent) 9%, transparent), transparent 70%), var(--color-ink-900);
	}
	.top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.6rem;
	}
	.name {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		font-weight: 500;
		font-size: 0.95rem;
		color: var(--color-cream);
	}
	.missing .name,
	.planned .name {
		color: var(--color-cream-dim);
	}
	.swatch {
		width: 9px;
		height: 9px;
		border-radius: 3px;
		background: var(--agent);
	}
	.missing .swatch,
	.planned .swatch {
		background: transparent;
		border: 1.5px solid var(--agent);
		opacity: 0.6;
	}
	.state {
		font-family: var(--font-mono);
		font-size: 0.58rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		padding: 0.12rem 0.5rem;
		border-radius: 999px;
		border: 1px solid rgba(244, 237, 227, 0.1);
		color: var(--color-faint);
		white-space: nowrap;
	}
	.detected .state {
		color: var(--agent);
		border-color: color-mix(in srgb, var(--agent) 40%, transparent);
	}
	.figures {
		display: grid;
		grid-template-columns: repeat(3, auto);
		justify-content: space-between;
		gap: 0.6rem;
	}
	.figures div {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.fig {
		font-size: 1.15rem;
		font-weight: 500;
		color: var(--color-cream);
	}
	.cap {
		font-size: 0.62rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-faint);
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.45rem 0.9rem;
	}
	.tag {
		font-family: var(--font-mono);
		font-size: 0.6rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-faint);
	}
	.pair {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		white-space: nowrap;
	}
	.cov {
		margin: 0;
		font-size: 0.68rem;
		line-height: 1.5;
		color: var(--color-muted);
	}
	.hint {
		margin: 0;
		font-size: 0.8rem;
		line-height: 1.55;
		color: var(--color-muted);
	}
	.paths {
		margin: 0;
		font-size: 0.7rem;
		line-height: 1.6;
		color: var(--color-faint);
		word-break: break-word;
	}
	code {
		font-family: var(--font-mono);
		font-size: 0.68rem;
		color: var(--color-cream-dim);
		background: var(--color-ink-800);
		padding: 0.02rem 0.3rem;
		border-radius: 4px;
	}
	.source {
		margin: auto 0 0;
		padding-top: 0.6rem;
		border-top: 1px solid rgba(244, 237, 227, 0.06);
		font-family: var(--font-mono);
		font-size: 0.64rem;
		color: var(--color-faint);
	}
	.warn {
		margin: 0;
		font-size: 0.7rem;
		line-height: 1.5;
		color: var(--color-amber);
		opacity: 0.85;
	}
</style>
