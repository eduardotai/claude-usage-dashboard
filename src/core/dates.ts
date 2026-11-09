/** Local calendar-day helpers. Days are bucketed in the machine's local timezone. */

export function localISODate(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Strict yyyy-mm-dd parser; returns null for anything else. */
export function parseISODate(v: string | null | undefined): string | null {
	if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
	const [y, m, d] = v.split('-').map(Number) as [number, number, number];
	const dt = new Date(y, m - 1, d);
	return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? v : null;
}

export function addDays(iso: string, days: number): string {
	const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
	return localISODate(new Date(y, m - 1, d + days).getTime());
}

/** Inclusive day count between two ISO dates. */
export function daySpan(start: string, end: string): number {
	const [y1, m1, d1] = start.split('-').map(Number) as [number, number, number];
	const [y2, m2, d2] = end.split('-').map(Number) as [number, number, number];
	return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000) + 1;
}
