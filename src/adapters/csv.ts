/**
 * The header line's delimiter: `,` normally, `;` when a spreadsheet re-saved the export in a
 * locale that uses decimal commas (e.g. pt-BR or de-DE Excel), tab for TSV. Quotes are skipped.
 */
export function detectDelimiter(text: string): string {
	const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
	let q = false;
	for (const c of text) {
		if (c === '"') q = !q;
		else if (!q && (c === '\n' || c === '\r')) break;
		else if (!q && c in counts) counts[c]!++;
	}
	const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]!;
	return n > 0 ? best : ',';
}

/** Token count cell: "1204", "1,204", "1.204" or "1 204" (grouping separators) -> 1204. */
export function parseCount(v: string | undefined): number {
	const t = String(v ?? '').trim().replace(/[\s\u00a0']/g, '');
	const n = /^\d{1,3}([.,]\d{3})+$/.test(t) ? Number(t.replace(/[.,]/g, '')) : Number(t.replace(/,/g, ''));
	return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** Minimal RFC 4180 parser (quoted fields, escaped quotes, CRLF), any single-char delimiter. */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let q = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i]!;
		if (q) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else q = false;
			} else field += c;
		} else if (c === '"') q = true;
		else if (c === delimiter) {
			row.push(field);
			field = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else field += c;
	}
	if (field !== '' || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows.filter((r) => r.some((f) => f.trim() !== ''));
}
