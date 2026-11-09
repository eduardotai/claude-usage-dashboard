import type { Adapter, AgentId } from '../core/types.js';
import { emptyStats } from '../core/types.js';
import { createClaudeAdapter } from './claude.js';
import { createCodexAdapter } from './codex.js';
import { createCursorAdapter, type CursorOptions } from './cursor.js';
import { createGrokBuildAdapter } from './grok-build.js';

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
}

export function createAdapters(env: NodeJS.ProcessEnv = process.env, opts: AdapterOptions = {}): Adapter[] {
	return [
		createClaudeAdapter(env),
		createCodexAdapter(env),
		createCursorAdapter(env, opts.cursor),
		createGrokBuildAdapter(env),
		planned(
			'gemini-cli',
			'Gemini CLI',
			'~/.gemini session files',
			'Not implemented yet.'
		),
		planned(
			'grok-bot',
			'Grok Bot',
			'grok.com/dashboard → Usage → Export',
			'Grok Bot runs in the cloud and keeps no usage logs on your machine. Its usage is in the account-wide CSV export at grok.com/dashboard, but that file’s columns are not publicly documented, and users report no per-Bot breakdown. AgentBurn won’t guess a format it hasn’t seen.'
		)
	];
}
