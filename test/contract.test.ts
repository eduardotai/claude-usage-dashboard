/**
 * Front-end <-> back-end contract. The UI's types (frontend/src/lib/types.ts) are hand-written
 * and `getJSON` only casts, so nothing else notices when the two sides drift. This test:
 * 1. reads every API call in frontend/src/lib/api.ts (path, method, declared response type),
 * 2. calls each one on a server loaded with every fixture,
 * 3. walks the real JSON against the TypeScript type (via the compiler API) and fails on
 *    - fields the UI declares that the server doesn't send (front-only), and
 *    - fields the server sends that the UI type doesn't declare (back-only),
 *    plus basic kind mismatches (number vs string vs null vs array vs object).
 * It also fails if the server answers a route the UI doesn't use, unless listed in INTERNAL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createAdapters } from '../src/adapters/index.js';
import { UsageStore } from '../src/core/store.js';
import { createAppServer } from '../src/server.js';
import {
	CURSOR_FIXTURES,
	CODEX_HOME_FIXTURE,
	GROK_HOME_FIXTURE,
	GROK_UNIFIED_FIXTURES,
	fixturesEnv,
	testBook
} from './helpers.js';

const LIB = fileURLToPath(new URL('../frontend/src/lib/', import.meta.url));
const SERVER_SRC = fileURLToPath(new URL('../src/server.ts', import.meta.url));

/** Routes the server answers on purpose without the UI calling them. */
const INTERNAL = ['GET /api/health'];

interface Call {
	method: string;
	path: string;
	/** Response type as written in api.ts, or null when the UI doesn't read the body. */
	type: string | null;
}

/** Every API call in api.ts: `getJSON<T>(`/api/...`)` (GET) and raw `fetch(.../api/..., { method })`. */
function uiCalls(): Call[] {
	const src = readFileSync(LIB + 'api.ts', 'utf8');
	const calls: Call[] = [];
	for (const m of src.matchAll(/getJSON<(.+?)>\(\s*[`'"](\/api\/[\w/-]+)/g)) calls.push({ method: 'GET', path: m[2]!, type: m[1]! });
	for (const m of src.matchAll(/fetch\(\s*`\$\{BASE\}(\/api\/[\w/-]+)`\s*,\s*\{\s*method:\s*'(\w+)'/g)) calls.push({ method: m[2]!, path: m[1]!, type: null });
	return calls;
}

/** Every `case 'METHOD /api/...'` in src/server.ts. */
function serverRoutes(): string[] {
	return [...readFileSync(SERVER_SRC, 'utf8').matchAll(/case '((?:GET|POST|PUT|PATCH|DELETE) \/api\/[\w/-]+)'/g)].map((m) => m[1]!);
}

/** Type-check a tiny virtual module that names each response type, so we can walk it. */
function resolveTypes(exprs: string[]) {
	const typesFile = LIB + 'types.ts';
	const exported = [...readFileSync(typesFile, 'utf8').matchAll(/^export (?:interface|type) (\w+)/gm)].map((m) => m[1]!);
	// The compiler uses forward slashes internally (also on Windows).
	const virtual = (LIB + '__contract__.ts').replace(/\\/g, '/');
	const isVirtual = (f: string) => f.replace(/\\/g, '/') === virtual;
	const text =
		`import type { ${exported.join(', ')} } from './types';\n` + exprs.map((e, i) => `export type R${i} = ${e};`).join('\n');
	const host = ts.createCompilerHost({ strict: true, noEmit: true });
	const read = host.readFile.bind(host);
	host.readFile = (f) => (isVirtual(f) ? text : read(f));
	const exists = host.fileExists.bind(host);
	host.fileExists = (f) => isVirtual(f) || exists(f);
	const program = ts.createProgram([virtual], { strict: true, noEmit: true, skipLibCheck: true, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, host);
	const checker = program.getTypeChecker();
	const sf = program.getSourceFile(virtual)!;
	const diags = ts.getPreEmitDiagnostics(program, sf);
	if (diags.length) throw new Error(ts.flattenDiagnosticMessageText(diags[0]!.messageText, '\n'));
	const aliases = sf.statements.filter(ts.isTypeAliasDeclaration);
	return { checker, types: aliases.map((a) => checker.getTypeAtLocation(a.name)) };
}

type Kind = 'null' | 'number' | 'string' | 'boolean' | 'array' | 'object';
const kindOf = (v: unknown): Kind => (v === null ? 'null' : Array.isArray(v) ? 'array' : (typeof v as Kind));

/** Compare a JSON value with a TS type; push human-readable drift into `out`. */
function walk(checker: ts.TypeChecker, type: ts.Type, value: unknown, path: string, out: string[]) {
	const parts = type.isUnion() ? type.types : [type];
	const kind = kindOf(value);
	const F = ts.TypeFlags;
	const accepts = (t: ts.Type): boolean => {
		if (t.flags & (F.Any | F.Unknown)) return true;
		if (kind === 'null') return !!(t.flags & F.Null);
		if (kind === 'number') return !!(t.flags & F.NumberLike);
		if (kind === 'string') return !!(t.flags & F.StringLike);
		if (kind === 'boolean') return !!(t.flags & F.BooleanLike);
		if (kind === 'array') return checker.isArrayType(t);
		return !!(t.flags & F.Object) && !checker.isArrayType(t);
	};
	const match = parts.filter(accepts);
	if (!match.length) {
		out.push(`${path}: server sends ${kind}, UI type is ${checker.typeToString(type)}`);
		return;
	}
	if (kind === 'array') {
		const el = checker.getTypeArguments(match[0] as ts.TypeReference)[0]!;
		(value as unknown[]).forEach((v, i) => walk(checker, el, v, `${path}[${i}]`, out));
		return;
	}
	if (kind !== 'object') return;
	const t = match[0]!;
	const obj = value as Record<string, unknown>;
	const index = checker.getIndexInfosOfType(t)[0];
	if (index) {
		for (const [k, v] of Object.entries(obj)) walk(checker, index.type, v, `${path}.${k}`, out);
		return;
	}
	const props = checker.getPropertiesOfType(t);
	for (const p of props) {
		const optional = !!(p.flags & ts.SymbolFlags.Optional);
		if (!(p.name in obj)) {
			if (!optional) out.push(`${path}.${p.name}: declared in frontend/src/lib/types.ts but not sent by the server`);
			continue;
		}
		walk(checker, checker.getTypeOfSymbol(p), obj[p.name], `${path}.${p.name}`, out);
	}
	const declared = new Set(props.map((p) => p.name));
	for (const k of Object.keys(obj)) if (!declared.has(k)) out.push(`${path}.${k}: sent by the server but not declared in frontend/src/lib/types.ts`);
}

let server: Server;
let base: string;
beforeAll(async () => {
	// Every fixture at once, so optional/nullable fields show up with real values.
	const env = fixturesEnv({ CODEX_HOME: CODEX_HOME_FIXTURE, GROK_HOME: GROK_HOME_FIXTURE });
	const adapters = createAdapters(env, { cursor: { csv: [CURSOR_FIXTURES + '/imports/cursor'] }, grokCsv: [GROK_UNIFIED_FIXTURES] });
	server = createAppServer({ store: new UsageStore(adapters, testBook()), uiDir: null });
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('front-end <-> back-end contract', () => {
	const calls = uiCalls();

	it('finds the UI calls (guards the parser itself)', () => {
		expect(calls.length).toBeGreaterThanOrEqual(8);
		expect(calls).toContainEqual({ method: 'POST', path: '/api/refresh', type: null });
	});

	it('every route the UI calls exists on the server, and every server route is used or INTERNAL', () => {
		const ui = new Set(calls.map((c) => `${c.method} ${c.path}`));
		const srv = serverRoutes();
		expect([...ui].filter((r) => !srv.includes(r)), 'UI calls routes the server lacks').toEqual([]);
		expect(srv.filter((r) => !ui.has(r) && !INTERNAL.includes(r)), 'server routes no UI uses (remove or add to INTERNAL)').toEqual([]);
	});

	it('every response matches frontend/src/lib/types.ts field by field', async () => {
		const typed = calls.filter((c) => c.type);
		const { checker, types } = resolveTypes(typed.map((c) => c.type!));
		const drift: string[] = [];
		for (const [i, c] of typed.entries()) {
			const res = await fetch(base + c.path);
			expect(res.status, c.path).toBe(200);
			walk(checker, types[i]!, await res.json(), c.path, drift);
		}
		// Dedupe array positions so one missing field is reported once.
		expect([...new Set(drift.map((d) => d.replace(/\[\d+\]/g, '[]')))]).toEqual([]);
	});

	it('POST routes the UI calls succeed from the UI origin', async () => {
		for (const c of calls.filter((x) => x.method !== 'GET')) {
			const res = await fetch(base + c.path, { method: c.method });
			expect(res.status, `${c.method} ${c.path}`).toBe(200);
		}
	});
});
