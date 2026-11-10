import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { request, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdapters } from '../src/adapters/index.js';
import { UsageStore } from '../src/core/store.js';
import { createAppServer } from '../src/server.js';
import { fixturesEnv, testBook } from './helpers.js';

const INLINE = 'window.__boot = 1;';
let server: Server;
let base: string;
beforeAll(async () => {
	const ui = await mkdtemp(join(tmpdir(), 'ab-ui-'));
	await writeFile(join(ui, 'index.html'), `<!doctype html><title>Burnboard</title><script>${INLINE}</script><script src="/x.js"></script>`);
	const store = new UsageStore(createAdapters(fixturesEnv()), testBook());
	server = createAppServer({ store, uiDir: ui });
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** POST /api/refresh with explicit headers (Host defaults to the listening address). */
const refresh = (headers: Record<string, string>) =>
	new Promise<number>((resolve, reject) => {
		const { port } = server.address() as AddressInfo;
		const req = request({ host: '127.0.0.1', port, path: '/api/refresh', method: 'POST', headers }, (res) => {
			res.resume();
			resolve(res.statusCode!);
		});
		req.on('error', reject);
		req.end();
	});

/** Raw request so the path is sent unnormalized. */
const rawStatus = (path: string, headers: Record<string, string> = {}) =>
	new Promise<number>((resolve, reject) => {
		const { port } = server.address() as AddressInfo;
		const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
			res.resume();
			resolve(res.statusCode!);
		});
		req.on('error', reject);
		req.end();
	});

const get = async (p: string) => {
	const res = await fetch(base + p);
	return { status: res.status, body: (await res.json()) as any };
};

describe('HTTP API', () => {
	it('health', async () => {
		expect((await get('/api/health')).body).toMatchObject({ status: 'ok', name: 'burnboard' });
	});

	it('summary honours the agent filter', async () => {
		expect((await get('/api/stats/summary')).body.total_messages).toBe(6);
		expect((await get('/api/stats/summary?agent=codex')).body.total_messages).toBe(0);
		expect((await get('/api/stats/summary?agent=claude-code&project=beta')).body.total_messages).toBe(1);
	});

	it('meta exposes pricing source and agent coverage', async () => {
		const { body } = await get('/api/meta');
		expect(body.pricing.source).toBe('bundled');
		expect(body.agents.map((a: any) => a.id)).toEqual(['claude-code', 'codex', 'cursor', 'grok-build', 'grok-bot', 'grok-apps', 'gemini-cli']);
	});

	it('all stats endpoints respond', async () => {
		for (const p of ['/api/stats/daily', '/api/stats/models', '/api/stats/projects', '/api/stats/heatmap', '/api/stats/agents', '/api/agents']) {
			expect((await get(p)).status, p).toBe(200);
		}
	});

	it('validates numeric params', async () => {
		expect((await get('/api/stats/heatmap?days=5')).status).toBe(400);
	});

	it('refresh rescans', async () => {
		const res = await fetch(base + '/api/refresh', { method: 'POST' });
		expect(((await res.json()) as any).records).toBe(6);
	});

	it('serves the UI with SPA fallback and blocks traversal', async () => {
		const res = await fetch(base + '/some/deep/link');
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('Burnboard');
		expect(await rawStatus('/..%2f..%2f..%2fetc%2fpasswd')).toBe(403);
	});

	it('rejects foreign Host headers (DNS rebinding)', async () => {
		expect(await rawStatus('/api/health', { host: 'evil.example:80' })).toBe(403);
	});

	describe('POST /api/refresh is same-origin only (CSRF)', () => {
		const host = () => `127.0.0.1:${(server.address() as AddressInfo).port}`;
		it('accepts the UI origin', async () => {
			expect(await refresh({ origin: `http://${host()}` })).toBe(200);
		});
		it('accepts the Vite dev proxy (Origin matches the forwarded Host)', async () => {
			expect(await refresh({ host: 'localhost:5173', origin: 'http://localhost:5173' })).toBe(200);
		});
		it('accepts non-browser clients that send no Origin (curl, scripts)', async () => {
			expect(await refresh({})).toBe(200);
		});
		it('accepts a same-origin Referer when Origin is missing', async () => {
			expect(await refresh({ referer: `http://${host()}/` })).toBe(200);
		});
		it('rejects a foreign Origin', async () => {
			expect(await refresh({ origin: 'https://evil.example' })).toBe(403);
		});
		it('rejects another localhost port', async () => {
			expect(await refresh({ origin: 'http://127.0.0.1:1' })).toBe(403);
		});
		it('rejects Origin: null (sandboxed iframes, file://)', async () => {
			expect(await refresh({ origin: 'null' })).toBe(403);
		});
		it('rejects a foreign Referer when Origin is missing', async () => {
			expect(await refresh({ referer: 'https://evil.example/page' })).toBe(403);
		});
		it('rejects cross-site and same-site Sec-Fetch-Site', async () => {
			expect(await refresh({ 'sec-fetch-site': 'cross-site' })).toBe(403);
			expect(await refresh({ 'sec-fetch-site': 'same-site', origin: 'http://localhost:9999' })).toBe(403);
		});
		it('trusts a same-origin Sec-Fetch-Site even with Origin: null (no-referrer pages)', async () => {
			expect(await refresh({ 'sec-fetch-site': 'same-origin', origin: 'null' })).toBe(200);
		});
	});

	it('serves the UI with a CSP that allows only its own inline bootstrap script', async () => {
		const res = await fetch(base + '/');
		const csp = res.headers.get('content-security-policy') ?? '';
		const hash = createHash('sha256').update(INLINE).digest('base64');
		expect(csp).toContain(`script-src 'self' 'sha256-${hash}'`);
		expect(csp).toContain("default-src 'self'");
		expect(csp).toContain("frame-ancestors 'none'");
		expect(csp).toContain("object-src 'none'");
		expect(csp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('x-frame-options')).toBe('DENY');
	});

	it('API responses carry security headers too', async () => {
		const res = await fetch(base + '/api/health');
		expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
	});
});
