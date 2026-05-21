import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// The Cloudflare plugin runs the Worker in the actual workerd runtime alongside
// Vite's React dev server — one HMR-enabled server on http://localhost:5173
// for both the API/Worker and the React client. It also reads wrangler.jsonc
// at build time and emits a deploy-ready config under dist/<worker-name>/.
export default defineConfig({
	plugins: [react(), cloudflare(), tailwindcss()],
});
