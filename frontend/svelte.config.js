import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// A static SPA served by the Burnboard CLI (src/server.ts) from dist/ui.
		adapter: adapter({ pages: '../dist/ui', assets: '../dist/ui', fallback: 'index.html', strict: true })
	}
};

export default config;
