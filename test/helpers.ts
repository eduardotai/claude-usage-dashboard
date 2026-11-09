import { fileURLToPath } from 'node:url';
import { PriceBook, type PriceTable } from '../src/pricing/litellm.js';

export const CLAUDE_FIXTURES = fileURLToPath(new URL('./fixtures/claude', import.meta.url));
export const CODEX_HOME_FIXTURE = fileURLToPath(new URL('./fixtures/codex/home', import.meta.url));
export const GROK_HOME_FIXTURE = fileURLToPath(new URL('./fixtures/grok/home', import.meta.url));
export const CURSOR_FIXTURES = fileURLToPath(new URL('./fixtures/cursor', import.meta.url));

/** Points every adapter at fixtures (or at nothing), so tests never read the real home dir. */
export function fixturesEnv(over: Record<string, string> = {}): NodeJS.ProcessEnv {
	const none = fileURLToPath(new URL('./fixtures/__none__', import.meta.url));
	return {
		CLAUDE_LOGS_DIR: CLAUDE_FIXTURES,
		CODEX_HOME: none,
		GROK_HOME: none,
		CURSOR_USER_DIR: none,
		AGENTBURN_IMPORTS_DIR: none,
		...over
	};
}

/** A small, frozen LiteLLM-shaped table so cost assertions never drift with upstream prices. */
export const TEST_TABLE: PriceTable = {
	'claude-opus-4-8': {
		litellm_provider: 'anthropic',
		input_cost_per_token: 5e-6,
		output_cost_per_token: 25e-6,
		cache_creation_input_token_cost: 6.25e-6,
		cache_creation_input_token_cost_above_1hr: 10e-6,
		cache_read_input_token_cost: 0.5e-6
	},
	'claude-sonnet-4-6': {
		litellm_provider: 'anthropic',
		input_cost_per_token: 3e-6,
		output_cost_per_token: 15e-6,
		cache_creation_input_token_cost: 3.75e-6,
		cache_read_input_token_cost: 0.3e-6,
		input_cost_per_token_above_200k_tokens: 6e-6,
		output_cost_per_token_above_200k_tokens: 22.5e-6
	},
	'claude-sonnet-4-5': {
		litellm_provider: 'anthropic',
		input_cost_per_token: 3e-6,
		output_cost_per_token: 15e-6
	},
	'claude-haiku-4-5-20251001': {
		litellm_provider: 'anthropic',
		input_cost_per_token: 1e-6,
		output_cost_per_token: 5e-6,
		cache_creation_input_token_cost: 1.25e-6,
		cache_read_input_token_cost: 0.1e-6
	},
	'gpt-5.5': { litellm_provider: 'openai', input_cost_per_token: 5e-6, output_cost_per_token: 30e-6, cache_read_input_token_cost: 0.5e-6 },
	'xai/grok-4.5': { litellm_provider: 'xai', input_cost_per_token: 2e-6, output_cost_per_token: 6e-6, cache_read_input_token_cost: 0.2e-6 },
	'gpt-5.3-codex': { litellm_provider: 'openai', input_cost_per_token: 1.75e-6, output_cost_per_token: 14e-6, cache_read_input_token_cost: 0.175e-6 }
};

export function testBook(): PriceBook {
	return new PriceBook(TEST_TABLE, { source: 'bundled', fetchedAt: null, models: Object.keys(TEST_TABLE).length, url: 'test' });
}
