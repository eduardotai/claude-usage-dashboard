import type { Adapter, AgentId } from '../core/types.js';
import { createClaudeAdapter } from './claude.js';

/** Adapters on the roadmap. Listed so the UI and API can be honest about coverage. */
function planned(id: AgentId, label: string): Adapter {
	return {
		id,
		label,
		status: 'planned',
		dataPaths: () => [],
		load: async () => ({
			records: [],
			stats: { files: 0, lines: 0, records: 0, duplicatesDropped: 0, sidechainRecords: 0, malformedLines: 0 }
		})
	};
}

export function createAdapters(env: NodeJS.ProcessEnv = process.env): Adapter[] {
	return [
		createClaudeAdapter(env),
		planned('codex', 'Codex CLI'),
		planned('cursor', 'Cursor'),
		planned('gemini-cli', 'Gemini CLI')
	];
}
