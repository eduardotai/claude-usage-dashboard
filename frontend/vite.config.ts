import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// In dev, the UI runs on Vite (5173) and proxies the API to the AgentBurn server (4317).
const API = process.env.AGENTBURN_API ?? 'http://127.0.0.1:4317';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		port: 5173,
		proxy: { '/api': { target: API, changeOrigin: false } }
	}
});
