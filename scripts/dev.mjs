#!/usr/bin/env node
// Dev loop: API server with reload (tsx watch, port 4317) + Vite UI with HMR (port 5173, proxies /api).
// Extra args are passed to the API server, e.g. `npm run dev -- --claude-dir ./sample-logs`.
import { spawn } from 'node:child_process';

const extra = process.argv.slice(2);
const procs = [
	spawn('npx', ['tsx', 'watch', 'src/cli.ts', '--no-open', '--port', '4317', ...extra], { stdio: 'inherit', shell: process.platform === 'win32' }),
	spawn('npx', ['vite', 'dev'], { cwd: 'frontend', stdio: 'inherit', shell: process.platform === 'win32' })
];
const stop = () => {
	for (const p of procs) p.kill('SIGTERM');
	process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => code && stop());
