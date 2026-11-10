// Minimal lint: the recommended sets for JS, TypeScript and Svelte. Type checking itself
// stays in `npm run check` (tsc + svelte-check).
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
	{ ignores: ['dist/', 'frontend/.svelte-kit/', 'sample-logs/', 'node_modules/'] },
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	{
		languageOptions: { globals: { ...globals.node } },
		rules: {
			// `_x` marks a deliberately unused binding (e.g. omitting a key via rest destructuring).
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }
			]
		}
	},
	{
		// Adapters walk third-party log/JSON formats whose fields are optional and undocumented;
		// tests read raw API JSON. Loose access is intended there; the normalized output types
		// (src/core/types.ts) are still checked by tsc. Everywhere else `any` stays an error.
		files: ['src/adapters/**', 'test/**'],
		rules: { '@typescript-eslint/no-explicit-any': 'off' }
	},
	{
		files: ['frontend/**'],
		languageOptions: { globals: { ...globals.browser } }
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: { parserOptions: { parser: ts.parser, extraFileExtensions: ['.svelte'] } }
	}
);
