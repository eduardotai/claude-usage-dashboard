import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { claudeLogRoots, createClaudeAdapter, parseClaudeLine } from '../src/adapters/claude.js';
import { CLAUDE_FIXTURES } from './helpers.js';

describe('Claude Code adapter', async () => {
	const { records, stats } = await createClaudeAdapter({ CLAUDE_LOGS_DIR: CLAUDE_FIXTURES }).load();
	const byModel = (m: string) => records.filter((r) => r.model === m);

	it('scans every jsonl file, including subagent transcripts', () => {
		expect(stats.files).toBe(3);
	});

	it('counts a split assistant response (same message.id + requestId) once', () => {
		const opus = byModel('claude-opus-4-8');
		expect(opus).toHaveLength(1);
		// Keeps the most complete entry (the partial streamed line had output_tokens=10).
		expect(opus[0]).toMatchObject({ inputTokens: 100, outputTokens: 50, cacheWriteTokens: 1000, cacheWrite1hTokens: 400, cacheReadTokens: 2000 });
	});

	it('dedupes across files (resumed sessions, subagent mirrors) and keeps first-seen identity', () => {
		expect(records.find((r) => r.model === 'claude-opus-4-8')).toMatchObject({ session: 'sess-a', project: 'alpha' });
		const sonnet = byModel('claude-sonnet-4-6');
		expect(sonnet).toHaveLength(1);
		expect(sonnet[0]!.sidechain).toBe(false);
		// 2 extra split lines + 1 resumed copy of msg_1, 1 subagent mirror of msg_2
		expect(stats.duplicatesDropped).toBe(4);
	});

	it('counts subagent calls as real usage and flags them as sidechain', () => {
		const haiku = records.filter((r) => r.model === 'claude-haiku-4-5-20251001' && r.sidechain);
		expect(haiku).toHaveLength(1);
		expect(haiku[0]).toMatchObject({ session: 'sess-a', project: 'alpha', inputTokens: 10, outputTokens: 20 });
		expect(stats.sidechainRecords).toBe(1);
	});

	it('keeps entries without ids, skips zero-usage synthetic and malformed lines', () => {
		expect(byModel('<synthetic>')).toHaveLength(0);
		expect(records.filter((r) => r.model === 'claude-haiku-4-5-20251001' && !r.sidechain)).toHaveLength(1);
		expect(stats.malformedLines).toBe(1);
		expect(records).toHaveLength(6);
		expect(stats.records).toBe(6);
	});

	it('derives project names from POSIX and Windows cwd paths', () => {
		expect(new Set(records.map((r) => r.project))).toEqual(new Set(['alpha', 'beta']));
	});

	it('tags token counts as measured', () => {
		expect(records.every((r) => r.agent === 'claude-code' && r.tokens === 'measured')).toBe(true);
	});

	it('returns nothing (not an error) when the directory does not exist', async () => {
		const res = await createClaudeAdapter({ CLAUDE_LOGS_DIR: join(CLAUDE_FIXTURES, 'nope') }).load();
		expect(res.records).toEqual([]);
		expect(res.stats.files).toBe(0);
	});
});

describe('claudeLogRoots', () => {
	it('supports comma-separated CLAUDE_LOGS_DIR', () => {
		expect(claudeLogRoots({ CLAUDE_LOGS_DIR: '/a, /b' })).toEqual([resolve('/a'), resolve('/b')]);
	});
	it('maps CLAUDE_CONFIG_DIR to its projects folder', () => {
		expect(claudeLogRoots({ CLAUDE_CONFIG_DIR: '/cfg' })).toEqual([join(resolve('/cfg'), 'projects')]);
	});
	it('defaults to ~/.claude/projects and ~/.config/claude/projects', () => {
		const roots = claudeLogRoots({});
		expect(roots[0]).toMatch(/\.claude[\\/]projects$/);
		expect(roots[1]).toMatch(/\.config[\\/]claude[\\/]projects$/);
	});
});

describe('parseClaudeLine', () => {
	it('ignores non-assistant lines and lines without usage', () => {
		expect(parseClaudeLine('{"type":"user","message":{"content":"x"}}', 'f.jsonl')).toBeNull();
		expect(parseClaudeLine('{"type":"summary","usage":1}', 'f.jsonl')).toBeNull();
	});
	it('flags unparseable usage lines as malformed', () => {
		expect(parseClaudeLine('{"usage": nope', 'f.jsonl')).toBe('malformed');
	});
});
