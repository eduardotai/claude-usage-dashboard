/**
 * One local HTTP server: JSON API under /api, the built SvelteKit UI everywhere else.
 * Zero runtime dependencies (node:http only).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import * as stats from './core/stats.js';
import type { UsageStore } from './core/store.js';
import { VERSION } from './version.js';

const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.txt': 'text/plain; charset=utf-8'
};

/** Only answer requests addressed to loopback names (blocks DNS-rebinding from web pages). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
function isLocalHost(host: string | undefined, extra: Set<string>): boolean {
	if (!host) return false;
	const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]!;
	return LOCAL_HOSTS.has(name.toLowerCase()) || extra.has(name.toLowerCase());
}

class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
	}
}

function send(res: ServerResponse, status: number, body: unknown) {
	const json = JSON.stringify(body);
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
		'x-content-type-options': 'nosniff'
	});
	res.end(json);
}

function intParam(q: URLSearchParams, name: string, def: number | null, min: number, max: number): number | null {
	const raw = q.get(name);
	if (raw === null || raw === '') return def;
	const v = Number(raw);
	if (!Number.isInteger(v) || v < min || v > max) throw new HttpError(400, `${name} must be an integer in [${min}, ${max}]`);
	return v;
}

export interface ServerOptions {
	store: UsageStore;
	/** Directory with the built UI (index.html). Optional: API-only when missing. */
	uiDir?: string | null;
	/** Extra Host names to accept (e.g. when binding to a LAN address on purpose). */
	allowedHosts?: string[];
}

export function createAppServer({ store, uiDir, allowedHosts = [] }: ServerOptions): Server {
	const extraHosts = new Set(allowedHosts.map((h) => h.toLowerCase()));
	const uiRoot = uiDir ? resolve(uiDir) : null;

	async function api(req: IncomingMessage, url: URL, res: ServerResponse) {
		const q = url.searchParams;
		const filters = { start: q.get('start'), end: q.get('end'), project: q.get('project'), agent: q.get('agent') };
		const route = `${req.method} ${url.pathname}`;

		switch (route) {
			case 'GET /api/health':
				return send(res, 200, { status: 'ok', name: 'burnboard', version: VERSION });
			case 'GET /api/meta':
				await store.all();
				return send(res, 200, {
					name: 'Burnboard',
					version: VERSION,
					generated_at: store.generatedAt,
					pricing: {
						source: store.pricing.source,
						fetched_at: store.pricing.fetchedAt,
						models: store.pricing.models,
						url: store.pricing.url
					},
					agents: store.agentStatuses()
				});
			case 'GET /api/agents': {
				const records = stats.applyFilters(await store.all(), { ...filters, agent: null });
				const usage = new Map(stats.agents(records).agents.map((a) => [a.agent, a]));
				return send(res, 200, {
					agents: store.agentStatuses().map((s) => ({ ...s, usage: usage.get(s.id as never) ?? null }))
				});
			}
			case 'GET /api/stats/summary': {
				const s = stats.summary(stats.applyFilters(await store.all(), filters));
				return send(res, 200, { ...s, generated_at: store.generatedAt });
			}
			case 'GET /api/stats/daily': {
				const days = intParam(q, 'days', null, 1, 3650);
				return send(res, 200, stats.daily(stats.applyFilters(await store.all(), filters), { ...filters, days }));
			}
			case 'GET /api/stats/models':
				return send(res, 200, stats.models(stats.applyFilters(await store.all(), filters)));
			case 'GET /api/stats/projects':
				// Spans all projects (so the UI can switch) but honors dates + agent.
				return send(res, 200, stats.projects(stats.applyFilters(await store.all(), { ...filters, project: null })));
			case 'GET /api/stats/heatmap': {
				const days = intParam(q, 'days', 365, 30, 730)!;
				const records = stats.applyFilters(await store.all(), { project: filters.project, agent: filters.agent });
				return send(res, 200, stats.heatmap(records, days));
			}
			case 'POST /api/refresh': {
				await store.refresh();
				const records = await store.all();
				return send(res, 200, { status: 'ok', records: records.length, generated_at: store.generatedAt });
			}
			default:
				throw new HttpError(404, `No route for ${route}`);
		}
	}

	async function staticFile(url: URL, res: ServerResponse) {
		if (!uiRoot) {
			res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
			return res.end('Burnboard UI is not built. Run `npm run build`.');
		}
		let rel: string;
		try {
			rel = decodeURIComponent(url.pathname);
		} catch {
			throw new HttpError(400, 'Bad path');
		}
		const target = normalize(join(uiRoot, rel));
		if (target !== uiRoot && !target.startsWith(uiRoot + sep)) throw new HttpError(403, 'Forbidden');

		let file = target;
		const st = await stat(file).catch(() => null);
		if (!st || st.isDirectory()) {
			const index = st?.isDirectory() ? join(file, 'index.html') : null;
			file = index && (await stat(index).catch(() => null)) ? index : join(uiRoot, 'index.html'); // SPA fallback
		}
		const body = await readFile(file);
		const immutable = rel.startsWith('/_app/immutable/');
		res.writeHead(200, {
			'content-type': MIME[extname(file)] ?? 'application/octet-stream',
			'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
			'x-content-type-options': 'nosniff',
			'referrer-policy': 'no-referrer'
		});
		res.end(body);
	}

	return createServer(async (req, res) => {
		try {
			if (!isLocalHost(req.headers.host, extraHosts)) throw new HttpError(403, 'Host not allowed');
			const url = new URL(req.url ?? '/', 'http://localhost');
			if (url.pathname.startsWith('/api/')) return await api(req, url, res);
			if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
			return await staticFile(url, res);
		} catch (err) {
			const status = err instanceof HttpError ? err.status : 500;
			const message = err instanceof Error ? err.message : 'Internal error';
			if (status === 500) console.error('[burnboard]', err);
			if (!res.headersSent) send(res, status, { error: message });
			else res.end();
		}
	});
}
