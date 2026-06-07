<script lang="ts">
	interface Props {
		busy: boolean;
		onrefresh: () => void;
	}
	let { busy, onrefresh }: Props = $props();
</script>

<button class="refresh" onclick={onrefresh} disabled={busy} aria-label="Re-scan logs">
	<svg
		class:spin={busy}
		width="15"
		height="15"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2.2"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path d="M21 12a9 9 0 1 1-2.64-6.36" />
		<path d="M21 3v6h-6" />
	</svg>
	<span>{busy ? 'Scanning…' : 'Refresh'}</span>
</button>

<style>
	.refresh {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.55rem 1rem;
		border-radius: 999px;
		border: 1px solid rgba(217, 119, 87, 0.35);
		background: linear-gradient(180deg, rgba(217, 119, 87, 0.16), rgba(217, 119, 87, 0.06));
		color: var(--color-clay-bright);
		font-family: var(--font-mono);
		font-size: 0.78rem;
		letter-spacing: 0.04em;
		cursor: pointer;
		transition:
			border-color 0.3s var(--ease-out-soft),
			background 0.3s var(--ease-out-soft),
			transform 0.3s var(--ease-out-soft);
	}
	.refresh:hover:not(:disabled) {
		border-color: var(--color-clay);
		background: linear-gradient(180deg, rgba(217, 119, 87, 0.26), rgba(217, 119, 87, 0.1));
		transform: translateY(-1px);
	}
	.refresh:disabled {
		opacity: 0.7;
		cursor: progress;
	}
	.spin {
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
