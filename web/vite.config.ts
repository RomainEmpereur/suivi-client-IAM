import { defineConfig } from 'vite';

// En local, /api est relayé vers `wrangler dev` (port 8787).
// En production, /api/* est routé vers le Worker sur le même domaine (voir README).
export default defineConfig({
  // allowedHosts : l'aperçu du développement peut être servi derrière un proxy (hôte différent de localhost).
  server: { port: 5173, host: true, allowedHosts: true, proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: { target: 'es2022' },
});
