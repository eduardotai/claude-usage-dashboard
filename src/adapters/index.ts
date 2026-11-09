import type { Adapter, AgentId } from '../core/types.js';
import { emptyStats } from '../core/types.js';
import { createClaudeAdapter } from './claude.js';
import { createCodexAdapter } from './codex.js';
import { createCursorAdapter, type CursorOptions } from './cursor.js';
import { createGrokBuildAdapter } from './grok-build.js';
import { createGrokAppsAdapter, createGrokBotAdapter } from './grok-bot.js';

/** Adapters on the roadmap. Listed so the UI and API can be honest about coverage. */
function planned(id: AgentId, label: string, source: string, note: string): Adapter {
	return {
		id,
		label,
		status: 'planned',
		source,
		note,
		dataPaths: () => [],
		load: async () => ({ records: [], stats: emptyStats() })
	};
}

export interface AdapterOptions {
	cursor?: CursorOptions;
	/** Grok unified usage exports (files or folders). */
	grokCsv?: string[];
}

export function createAdapters(env: NodeJS.ProcessEnv = process.env, opts: AdapterOptions = {}): Adapter[] {
	return [
		createClaudeAdapter(env),
		createCodexAdapter(env),
		createCursorAdapter(env, { ...opts.cursor, grokCsv: opts.grokCsv }),
		createGrokBuildAdapter(env),
		createGrokBotAdapter(env, { csv: opts.grokCsv }),
		createGrokAppsAdapter(env, { csv: opts.grokCsv }),
		planned('gemini-cli', 'Gemini CLI', '~/.gemini session files', 'Not implemented yet.')
	];
}
