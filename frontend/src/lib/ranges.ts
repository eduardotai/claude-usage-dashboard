export type RangeKey = '7d' | '30d' | '90d' | 'all';

export interface RangeOption {
	key: RangeKey;
	label: string;
	days: number | null; // null = all time
}

export const RANGES: RangeOption[] = [
	{ key: '7d', label: '7D', days: 7 },
	{ key: '30d', label: '30D', days: 30 },
	{ key: '90d', label: '90D', days: 90 },
	{ key: 'all', label: 'All', days: null }
];

export const RANGE_NOUN: Record<RangeKey, string> = {
	'7d': 'last 7 days',
	'30d': 'last 30 days',
	'90d': 'last 90 days',
	all: 'all time'
};

function isoLocal(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Translate a range preset into inclusive {start,end} ISO dates (or open start). */
export function rangeToDates(key: RangeKey): { start: string | null; end: string | null } {
	const opt = RANGES.find((r) => r.key === key) ?? RANGES[1];
	if (opt.days === null) return { start: null, end: null };
	const end = new Date();
	const start = new Date();
	start.setDate(start.getDate() - (opt.days - 1));
	return { start: isoLocal(start), end: isoLocal(end) };
}
