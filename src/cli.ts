#!/usr/bin/env node
/**
 * `npx agentburn` — scan local agent logs, serve the dashboard on localhost, open the browser.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { AddressInfo } from 'node:net';
import { createAdapters } from './adapters/index.js';
import { UsageStore } from './core/store.js';
import { loadPriceBook } from './pricing/litellm.js';
import { createAppServer } from './server.js';
import { UI_DIR } from './paths.js';
import { VERSION } from './version.js';

const HELP = `AgentBurn ${VERSION} — local dashboard of AI coding agent usage and API-equivalent cost

Usage: agentburn [options]

Options:
  -p, --port <n>        Port to listen on (default 4317; next free port if taken)
      --host <addr>     Interface to bind (default 127.0.0.1)
      --no-open         Do not open the browser
      --offline         Never download prices; use cached/bundled LiteLLM table
      --claude-dir <p>  Claude Code logs dir (default ~/.claude/projects; env CLAUDE_LOGS_DIR)
      --codex-home <p>  Codex home (default ~/.codex; env CODEX_HOME)
      --grok-home <p>   Grok Build home (default ~/.grok; env GROK_HOME)
      --cursor-csv <p>  Cursor usage CSV export, file or folder (repeatable;
                        also read from ~/.agentburn/imports/cursor/)
      --cursor-dir <p>  Cursor "User" settings dir (env CURSOR_USER_DIR)
      --grok-csv <p>    grok.com usage export (Grok Bot, Cursor on the X Subscription,
                        Grok apps), file or folder (repeatable; also read from
                        ~/.agentburn/imports/grok/)
  -v, --version         Print version
  -h, --help            Show this help

Environment:
  CLAUDE_LOGS_DIR       Comma-separated Claude Code log roots
  CODEX_HOME            Comma-separated Codex homes
  GROK_HOME             Grok Build home
  AGENTBURN_CURSOR_CSV  Comma-separated Cursor CSV files or folders
  CURSOR_USER_DIR       Cursor "User" dir (holds globalStorage/state.vscdb)
  AGENTBURN_GROK_CSV    Comma-separated grok.com usage exports (files or folders)
  AGENTBURN_IMPORTS_DIR Import drop folder (default ~/.agentburn/imports)
  AGENTBURN_OFFLINE=1   Same as --offline
  AGENTBURN_CACHE_DIR   Where the downloaded price table is cached

Everything runs on this machine. The only network request is an optional
download of LiteLLM's public price table (disable with --offline).`;

function openBrowser(url: string) {
	const [cmd, args] =
		process.platform === 'darwin'
			? ['open', [url]]
			: process.platform === 'win32'
				? ['cmd', ['/c', 'start', '""', url]]
				: ['xdg-open', [url]];
	try {
		const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
		child.on('error', () => {});
		child.unref();
	} catch {
		/* no browser available: the URL is printed anyway */
	}
}

async function listen(server: ReturnType<typeof createAppServer>, port: number, host: string, tries = 20): Promise<number> {
	for (let i = 0; i < tries; i++) {
		try {
			await new Promise<void>((resolveListen, reject) => {
				const onError = (err: NodeJS.ErrnoException) => {
					server.off('listening', onListening);
					reject(err);
				};
				const onListening = () => {
					server.off('error', onError);
					resolveListen();
				};
				server.once('error', onError);
				server.once('listening', onListening);
				server.listen(port + i, host);
			});
			return (server.address() as AddressInfo).port;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' || port === 0) throw err;
		}
	}
	throw new Error(`No free port in ${port}-${port + tries - 1}`);
}

/** Node 22 flags `node:sqlite` (used read-only for Cursor's DB) as experimental; keep the CLI output clean. */
function hideSqliteWarning() {
	const emit = process.emitWarning.bind(process);
	process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
		const msg = typeof warning === 'string' ? warning : warning?.message;
		if (/SQLite is an experimental feature/i.test(String(msg))) return;
		return (emit as (...a: unknown[]) => void)(warning, ...rest);
	}) as typeof process.emitWarning;
}

async function main() {
	hideSqliteWarning();
	const { values } = parseArgs({
		options: {
			port: { type: 'string', short: 'p', default: process.env.PORT ?? '4317' },
			host: { type: 'string', default: '127.0.0.1' },
			'no-open': { type: 'boolean', default: false },
			offline: { type: 'boolean', default: false },
			'claude-dir': { type: 'string' },
			'codex-home': { type: 'string' },
			'grok-home': { type: 'string' },
			'cursor-csv': { type: 'string', multiple: true },
			'cursor-dir': { type: 'string' },
			'grok-csv': { type: 'string', multiple: true },
			version: { type: 'boolean', short: 'v', default: false },
			help: { type: 'boolean', short: 'h', default: false }
		},
		strict: true
	});
	const v = values as unknown as Record<string, string | boolean | undefined>;

	if (v.help) return console.log(HELP);
	if (v.version) return console.log(VERSION);

	const port = Number(v.port);
	if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid --port: ${v.port}`);
	const host = String(v.host);
	const offline = v.offline === true || process.env.AGENTBURN_OFFLINE === '1';
	const env = { ...process.env };
	if (typeof v['claude-dir'] === 'string') env.CLAUDE_LOGS_DIR = v['claude-dir'];
	if (typeof v['codex-home'] === 'string') env.CODEX_HOME = v['codex-home'];
	if (typeof v['grok-home'] === 'string') env.GROK_HOME = v['grok-home'];
	if (typeof v['cursor-dir'] === 'string') env.CURSOR_USER_DIR = v['cursor-dir'];
	const cursorCsv = (values as { 'cursor-csv'?: string[] })['cursor-csv'] ?? [];
	const grokCsv = (values as { 'grok-csv'?: string[] })['grok-csv'] ?? [];

	const t0 = Date.now();
	const prices = await loadPriceBook({ offline });
	const store = new UsageStore(createAdapters(env, { cursor: { csv: cursorCsv }, grokCsv }), prices);
	await store.refresh();
	const records = await store.all();

	const uiDir = existsSync(join(UI_DIR, 'index.html')) ? UI_DIR : null;
	const server = createAppServer({ store, uiDir, allowedHosts: host === '127.0.0.1' || host === 'localhost' ? [] : [host] });
	const actualPort = await listen(server, port, host);
	const shownHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host === '127.0.0.1' ? 'localhost' : host;
	const url = `http://${shownHost}:${actualPort}`;

	const dim = (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
	const clay = (s: string) => (process.stdout.isTTY ? `\x1b[38;2;217;119;87m${s}\x1b[0m` : s);
	console.log(`\n  ${clay('● AgentBurn')} ${dim(`v${VERSION}`)}\n`);
	for (const a of store.agentStatuses().filter((s) => s.status === 'available')) {
		const s = a.scan;
		console.log(`  ${a.label.padEnd(12)} ${s ? `${s.records.toLocaleString()} records from ${s.files} ${s.files === 1 ? 'file' : 'files'}` : 'no data'}${s?.duplicatesDropped ? dim(` (${s.duplicatesDropped.toLocaleString()} duplicate entries dropped)`) : ''}`);
		if (!a.detected) console.log(dim(`               looked in ${a.data_paths.join(', ')}`));
		const unmeasured = records.filter((r) => r.agent === a.id && r.tokens === 'unavailable').length;
		if (unmeasured) console.log(dim(`               ${unmeasured.toLocaleString()} requests without token counts (counted as calls only)`));
		for (const w of a.warnings) console.log(dim(`               ! ${w}`));
	}
	console.log(dim(`  Prices       LiteLLM (${prices.info.source}, ${prices.info.models} models)`));
	console.log(dim(`  Ready in ${Date.now() - t0}ms · ${records.length.toLocaleString()} records`));
	console.log(`\n  ${clay('➜')}  ${url}\n`);
	if (!uiDir) console.log(dim('  UI build not found — API only. Run `npm run build`.\n'));

	if (v['no-open'] !== true && !process.env.CI) openBrowser(url);

	const shutdown = () => server.close(() => process.exit(0));
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
}

main().catch((err) => {
	console.error(`agentburn: ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
});
