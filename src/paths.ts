import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Walk up from this file to the agentburn package root (works from src/ and dist/server/). */
function findPackageRoot(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (;;) {
		const pkg = join(dir, 'package.json');
		if (existsSync(pkg)) {
			try {
				if (JSON.parse(readFileSync(pkg, 'utf8')).name === 'agentburn') return dir;
			} catch {
				/* keep walking */
			}
		}
		const parent = dirname(dir);
		if (parent === dir) throw new Error('agentburn package root not found');
		dir = parent;
	}
}

export const PACKAGE_ROOT = findPackageRoot();
export const UI_DIR = join(PACKAGE_ROOT, 'dist', 'ui');
export const SNAPSHOT_PATH = join(PACKAGE_ROOT, 'pricing', 'litellm-snapshot.json');
