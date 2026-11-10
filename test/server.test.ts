import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { request, type Server } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdapters } from '../src/adapters/index.js';
import { UsageStore } from '../src/core/store.js';
import { createAppServer } from '../src/server.js';
import { fixturesEnv, testBook } from './helpers.js';

let server: Server;
let base: string;
beforeAll(async () => {
	const ui = await mkdtemp(join(tmpdir(), 'ab-ui-'));
	await writeFile(join(ui, 'index.html'), '<!doctype html><title>Burnboard</title>');
	const store = new UsageStore(createAdapters(fixturesEnv()), testBook());
	server = createAppServer({ store, uiDir: ui });
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

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
});
