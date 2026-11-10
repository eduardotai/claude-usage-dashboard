/**
 * Product data paths and env vars.
 *
 * Default drop folder is ~/.burnboard/imports. The pre-rename ~/.agentburn/imports
 * is still read so existing setups keep working. Official env vars are BURNBOARD_*;
 * the old AGENTBURN_* names are accepted as a fallback.
 */
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const expand = (p: string, home: string) => resolve(p.replace(/^~(?=$|[\\/])/, home));

export type BurnboardEnvName = 'IMPORTS_DIR' | 'CACHE_DIR' | 'CURSOR_CSV' | 'GROK_CSV' | 'OFFLINE' | 'API';

/** Prefer the Burnboard env var, then the pre-rename AgentBurn name. */
export function envVar(env: NodeJS.ProcessEnv, name: BurnboardEnvName): string | undefined {
	const v = env[`BURNBOARD_${name}`] ?? env[`AGENTBURN_${name}`];
	const t = v?.trim();
	return t ? t : undefined;
}

/** Home used for default paths; tests can point this at a temp dir via HOME / USERPROFILE. */
export function envHome(env: NodeJS.ProcessEnv = process.env): string {
	const h = env.HOME?.trim() || env.USERPROFILE?.trim();
	return h ? resolve(h) : homedir();
}

/**
 * Import drop directories for a product subfolder (`cursor` or `grok`).
 * An explicit BURNBOARD_IMPORTS_DIR (or AGENTBURN_IMPORTS_DIR) replaces the defaults.
 */
export function defaultImportDirs(subdir: 'cursor' | 'grok', env: NodeJS.ProcessEnv = process.env): string[] {
	const override = envVar(env, 'IMPORTS_DIR');
	const home = envHome(env);
	if (override) return [join(expand(override, home), subdir)];
	return [join(home, '.burnboard', 'imports', subdir), join(home, '.agentburn', 'imports', subdir)];
}

export function defaultCacheDir(env: NodeJS.ProcessEnv = process.env): string {
	const override = envVar(env, 'CACHE_DIR');
	if (override) return override;
	if (process.platform === 'win32' && env.LOCALAPPDATA) return join(env.LOCALAPPDATA, 'burnboard', 'cache');
	return join(env.XDG_CACHE_HOME || join(envHome(env), '.cache'), 'burnboard');
}
