import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

/** Recursively list files under `root` whose name ends with `ext`. Sorted, symlink-safe. */
export async function findFiles(root: string, ext: string): Promise<string[]> {
	const out: string[] = [];
	async function walk(dir: string): Promise<void> {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return; // missing or unreadable directory: nothing to scan
		}
		for (const e of entries) {
			const p = join(dir, e.name);
			if (e.isDirectory()) await walk(p);
			else if (e.isFile() && e.name.endsWith(ext)) out.push(p);
		}
	}
	await walk(root);
	return out.sort();
}

export async function isDirectory(p: string): Promise<boolean> {
	try {
		return (await stat(p)).isDirectory();
	} catch {
		return false;
	}
}

/** Stream a text file line by line without loading it into memory. */
export async function* readLines(file: string): AsyncGenerator<string> {
	const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
	try {
		for await (const line of rl) yield line;
	} finally {
		rl.close();
	}
}

/** Basename of a POSIX or Windows path, whatever the host OS. */
export function projectNameFromPath(cwd: string | undefined | null): string | null {
	if (!cwd) return null;
	const cleaned = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
	const name = cleaned.slice(cleaned.lastIndexOf('/') + 1);
	return name || null;
}
