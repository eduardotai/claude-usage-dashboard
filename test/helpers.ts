import { fileURLToPath } from 'node:url';
import { PriceBook, type PriceTable } from '../src/pricing/litellm.js';

export const CLAUDE_FIXTURES = fileURLToPath(new URL('./fixtures/claude', import.meta.url));

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
	'gpt-5.3-codex': { litellm_provider: 'openai', input_cost_per_token: 1.75e-6, output_cost_per_token: 14e-6, cache_read_input_token_cost: 0.175e-6 }
};

export function testBook(): PriceBook {
	return new PriceBook(TEST_TABLE, { source: 'bundled', fetchedAt: null, models: 5, url: 'test' });
}
