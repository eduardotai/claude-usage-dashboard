/** Categorical palette — warm-leaning, calm, clay-anchored. */
export const CATEGORICAL = [
	'#d97757', // clay
	'#e0a458', // amber
	'#8fa67e', // sage
	'#7c93a6', // dust
	'#a98499', // mauve
	'#c98a6a', // soft clay
	'#9aa37e' // olive
];

export function colorAt(i: number): string {
	return CATEGORICAL[i % CATEGORICAL.length];
}

/** One stable color per agent, so the chart, cards and selector agree. */
const AGENT_COLORS: Record<string, string> = {
	'claude-code': '#d97757', // clay
	codex: '#8fa67e', // sage
	cursor: '#7c93a6', // dust
	'grok-build': '#e0a458', // amber
	'gemini-cli': '#a98499', // mauve
	'grok-bot': '#9aa37e' // olive
};

export function agentColor(id: string): string {
	return AGENT_COLORS[id] ?? '#9a8d7e';
}

/** `#rrggbb` + alpha -> rgba(). */
export function alpha(hex: string, a: number): string {
	const n = parseInt(hex.slice(1), 16);
	return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
