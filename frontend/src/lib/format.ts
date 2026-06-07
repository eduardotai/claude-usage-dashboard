/** Compact token count, e.g. 928_535_391 -> "928.5M". */
export function compact(n: number): string {
	if (n === 0) return '0';
	const abs = Math.abs(n);
	if (abs >= 1e12) return (n / 1e12).toFixed(2) + 'T';
	if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
	if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
	if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K';
	return String(n);
}

/** Full grouped number, e.g. "928,535,391". */
export function grouped(n: number): string {
	return n.toLocaleString('en-US');
}

/** Split a number into grouped string segments for animated/styled rendering. */
export function full(n: number): string {
	return grouped(Math.round(n));
}

/** "Jun 7" style short date from an ISO yyyy-mm-dd string. */
export function shortDate(iso: string): string {
	const [y, m, d] = iso.split('-').map(Number);
	const date = new Date(y, m - 1, d);
	return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "June 7, 2026" style long date. */
export function longDate(iso: string | null): string {
	if (!iso) return '—';
	const [y, m, d] = iso.split('-').map(Number);
	const date = new Date(y, m - 1, d);
	return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/** Friendly relative time from an ISO timestamp. */
export function relativeTime(iso: string | null): string {
	if (!iso) return '—';
	const then = new Date(iso).getTime();
	const secs = Math.round((Date.now() - then) / 1000);
	if (secs < 60) return 'just now';
	if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
	if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
	return `${Math.floor(secs / 86400)}d ago`;
}

/** USD money formatter, compact for large figures. e.g. 917.8 -> "$917.80". */
export function money(n: number): string {
	if (n >= 10000) return '$' + (n / 1000).toFixed(1) + 'K';
	return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Tidy up a raw model id for display: claude-opus-4-8 -> "Opus 4.8". */
export function modelLabel(model: string): string {
	const m = model.toLowerCase();
	const family = m.includes('opus') ? 'Opus' : m.includes('sonnet') ? 'Sonnet' : m.includes('haiku') ? 'Haiku' : null;
	if (!family) return model;
	// Pull the version digits that follow the family name (e.g. "4-8" or "4-5-2025...").
	const match = m.match(/(opus|sonnet|haiku)-(\d+)-(\d+)/);
	if (match) return `${family} ${match[2]}.${match[3]}`;
	return family;
}
