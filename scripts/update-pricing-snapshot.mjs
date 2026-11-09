#!/usr/bin/env node
// Refresh the offline pricing fallback bundled with the package.
// Keeps chat models from the providers coding agents actually use, cost fields only.
import { writeFile } from 'node:fs/promises';

const SOURCE = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const PROVIDERS = new Set(['anthropic', 'openai', 'gemini', 'xai', 'deepseek', 'mistral', 'moonshot', 'vertex_ai-language-models']);
const FIELDS = [
	'litellm_provider',
	'input_cost_per_token',
	'output_cost_per_token',
	'cache_creation_input_token_cost',
	'cache_creation_input_token_cost_above_1hr',
	'cache_read_input_token_cost',
	'input_cost_per_token_above_200k_tokens',
	'output_cost_per_token_above_200k_tokens',
	'cache_creation_input_token_cost_above_200k_tokens',
	'cache_read_input_token_cost_above_200k_tokens'
];

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`download failed: ${res.status}`);
const table = await res.json();
const models = {};
for (const [key, v] of Object.entries(table).sort(([a], [b]) => a.localeCompare(b))) {
	if (key.includes('/') || !PROVIDERS.has(v.litellm_provider)) continue;
	if (!['chat', 'responses'].includes(v.mode) || typeof v.input_cost_per_token !== 'number') continue;
	models[key] = Object.fromEntries(FIELDS.filter((f) => v[f] !== undefined).map((f) => [f, v[f]]));
}
const out = { generated_at: new Date().toISOString(), source: SOURCE, models };
await writeFile(new URL('../pricing/litellm-snapshot.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`Wrote ${Object.keys(models).length} models to pricing/litellm-snapshot.json`);
