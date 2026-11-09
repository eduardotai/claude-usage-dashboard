import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
		// Day bucketing is local-time; pin it so tests are deterministic anywhere.
		env: { TZ: 'UTC' }
	}
});
