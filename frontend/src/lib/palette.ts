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
