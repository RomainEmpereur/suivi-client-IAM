import { defineConfig } from 'vite';

// En local, /api est relayé vers `wrangler dev` (port 8787).
// En production, /api/* est routé vers le Worker sur le même domaine (voir README).
export default defineConfig({
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: { target: 'es2022' },
});
