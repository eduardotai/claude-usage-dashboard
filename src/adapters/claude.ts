/**
 * Claude Code adapter.
 *
 * Claude Code writes one JSONL transcript per session under
 * `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` (newer installs may use
 * `~/.config/claude/projects`). Subagent (Task tool) transcripts live either
 * inline with `isSidechain: true` or in `<session-id>/subagents/agent-*.jsonl`.
 *
 * Two things make naive summing wrong, and both are handled here:
 *
 * 1. Split entries. One API response is written as several lines (one per
 *    content block: thinking, text, tool_use...). Every line repeats the same
 *    `message.id`, `requestId` and `message.usage`. Summing lines double or
 *    triple counts. We dedupe on `message.id + requestId`, globally across all
 *    files (resumed sessions copy earlier messages into a new file), keeping
 *    the entry with the largest output token count (the most complete one if a
 *    streamed entry was written before usage was final).
 *
 * 2. Subagents. Sidechain calls are real, separately billed API calls; the
 *    parent transcript only holds the Task tool's result, not their usage. So
 *    we COUNT them, attribute them to the parent session/project, flag them
 *    `sidechain: true`, and rely on the same global dedupe so a call that shows
 *    up both inline and in a `subagents/` file is counted once.
 *
 * Lines without `message.id` or `requestId` cannot be deduped and are kept as is.
 */
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { findFiles, isDirectory, projectNameFromPath, readLines } from './fs.js';
import { emptyStats, totalTokens, type Adapter, type AdapterResult, type RawUsageRecord } from '../core/types.js';

/** Resolve the directories to scan. `CLAUDE_LOGS_DIR` (comma-separated) wins. */
export function claudeLogRoots(env: NodeJS.ProcessEnv = process.env): string[] {
	const explicit = env.CLAUDE_LOGS_DIR?.trim();
	if (explicit) return splitPaths(explicit);
	const config = env.CLAUDE_CONFIG_DIR?.trim();
	if (config) return splitPaths(config).map((p) => join(p, 'projects'));
	const home = homedir();
	return [join(home, '.claude', 'projects'), join(home, '.config', 'claude', 'projects')];
}

function splitPaths(v: string): string[] {
	return v
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.map((p) => resolve(p.replace(/^~(?=$|[\\/])/, homedir())));
}

interface ClaudeLine {
	type?: string;
	timestamp?: string;
	cwd?: string;
	sessionId?: string;
	requestId?: string;
	isSidechain?: boolean;
	message?: {
		id?: string;
		model?: string;
		usage?: {
			input_tokens?: number;
			output_tokens?: number;
			cache_creation_input_tokens?: number;
			cache_read_input_tokens?: number;
			cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
		};
	};
}

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/** Parse one JSONL line. Returns null for anything that is not a usage-bearing assistant entry. */
export function parseClaudeLine(
	line: string,
	file: string
): { record: RawUsageRecord; dedupeKey: string | null } | 'malformed' | null {
	if (!line.includes('"usage"')) return null; // cheap pre-filter: most lines are user/tool entries
	let obj: ClaudeLine;
	try {
		obj = JSON.parse(line) as ClaudeLine;
	} catch {
		return 'malformed';
	}
	if (obj?.type !== 'assistant') return null;
	const msg = obj.message;
	const usage = msg?.usage;
	if (!msg || !usage) return null;
	const ts = obj.timestamp ? Date.parse(obj.timestamp) : NaN;
	if (Number.isNaN(ts)) return 'malformed';

	const cacheWrite = n(usage.cache_creation_input_tokens);
	const record: RawUsageRecord = {
		agent: 'claude-code',
		project: projectNameFromPath(obj.cwd) ?? projectFromFile(file),
		session: obj.sessionId || basename(file, '.jsonl'),
		model: msg.model || 'unknown',
		timestamp: ts,
		inputTokens: n(usage.input_tokens),
		outputTokens: n(usage.output_tokens),
		cacheReadTokens: n(usage.cache_read_input_tokens),
		cacheWriteTokens: cacheWrite,
		cacheWrite1hTokens: Math.min(cacheWrite, n(usage.cache_creation?.ephemeral_1h_input_tokens)),
		sidechain: obj.isSidechain === true || /[\\/]subagents[\\/]/.test(file),
		tokens: 'measured'
	};
	const dedupeKey = msg.id && obj.requestId ? `${msg.id}:${obj.requestId}` : null;
	return { record, dedupeKey };
}

/** Fallback when an entry has no cwd: the encoded project directory name. */
function projectFromFile(file: string): string {
	const parts = file.split(/[\\/]/);
	const i = parts.lastIndexOf('projects');
	const dir = i >= 0 ? parts[i + 1] : parts[parts.length - 2];
	return dir && !dir.endsWith('.jsonl') ? dir : 'unknown';
}

/** Parse a set of Claude Code JSONL files into deduplicated usage records. */
export async function parseClaudeFiles(files: string[]): Promise<AdapterResult> {
	const stats = emptyStats();
	const records: RawUsageRecord[] = [];
	const byKey = new Map<string, number>(); // dedupe key -> index in `records`

	for (const file of files) {
		stats.files++;
		try {
			for await (const line of readLines(file)) {
				stats.lines++;
				const parsed = parseClaudeLine(line, file);
				if (parsed === null) continue;
				if (parsed === 'malformed') {
					stats.malformedLines++;
					continue;
				}
				const { record, dedupeKey } = parsed;
				if (totalTokens(record) === 0) continue; // e.g. "<synthetic>" placeholder messages
				if (dedupeKey) {
					const prev = byKey.get(dedupeKey);
					if (prev !== undefined) {
						stats.duplicatesDropped++;
						const existing = records[prev]!;
						if (record.outputTokens > existing.outputTokens) {
							// Keep the first-seen identity (session/sidechain) but the most complete usage.
							records[prev] = { ...record, session: existing.session, sidechain: existing.sidechain };
						}
						continue;
					}
					byKey.set(dedupeKey, records.length);
				}
				records.push(record);
			}
		} catch {
			// File vanished or is unreadable mid-scan: skip it, keep the rest.
		}
	}
	stats.records = records.length;
	stats.sidechainRecords = records.filter((r) => r.sidechain).length;
	return { records, stats };
}

export function createClaudeAdapter(env: NodeJS.ProcessEnv = process.env): Adapter {
	return {
		id: 'claude-code',
		label: 'Claude Code',
		status: 'available',
		dataPaths: () => claudeLogRoots(env),
		async load() {
			const files: string[] = [];
			for (const root of claudeLogRoots(env)) {
				if (await isDirectory(root)) files.push(...(await findFiles(root, '.jsonl')));
			}
			return parseClaudeFiles(files);
		}
	};
}
