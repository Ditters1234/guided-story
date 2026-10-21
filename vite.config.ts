import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [sveltekit({ adapter: adapter(), preprocess: vitePreprocess() })],
  cacheDir: process.env.STORY_VITE_CACHE || `node_modules/.vite/${process.env.STORY_INSTANCE === 'play' ? 'play' : 'dev'}`,
  server: { host: '127.0.0.1', strictPort: true, watch: { ignored: ['**/data/**', '**/config/*.local.json*', '**/config/workflows/**', '**/test-results/**'] } }
});
