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
  -v, --version         Print version
  -h, --help            Show this help

Environment:
  CLAUDE_LOGS_DIR       Comma-separated Claude Code log roots
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

async function main() {
	const { values } = parseArgs({
		options: {
			port: { type: 'string', short: 'p', default: process.env.PORT ?? '4317' },
			host: { type: 'string', default: '127.0.0.1' },
			'no-open': { type: 'boolean', default: false },
			offline: { type: 'boolean', default: false },
			'claude-dir': { type: 'string' },
			version: { type: 'boolean', short: 'v', default: false },
			help: { type: 'boolean', short: 'h', default: false }
		},
		strict: true
	});
	const v = values as Record<string, string | boolean | undefined>;

	if (v.help) return console.log(HELP);
	if (v.version) return console.log(VERSION);

	const port = Number(v.port);
	if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid --port: ${v.port}`);
	const host = String(v.host);
	const offline = v.offline === true || process.env.AGENTBURN_OFFLINE === '1';
	const env = { ...process.env };
	if (typeof v['claude-dir'] === 'string') env.CLAUDE_LOGS_DIR = v['claude-dir'];

	const t0 = Date.now();
	const prices = await loadPriceBook({ offline });
	const store = new UsageStore(createAdapters(env), prices);
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
		console.log(`  ${a.label.padEnd(12)} ${s ? `${s.records.toLocaleString()} calls from ${s.files} files` : 'no data'}${s?.duplicatesDropped ? dim(` (${s.duplicatesDropped.toLocaleString()} duplicate entries dropped)`) : ''}`);
		if (!a.detected) console.log(dim(`               looked in ${a.data_paths.join(', ')}`));
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
