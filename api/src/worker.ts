/**
 * Point d'entrée des Workers déployés (démo et production) : /api/* → API ; tout le reste → interface intégrée.
 * En local, `src/index.ts` sert seulement l'API et Vite sert l'interface.
 */
import app from './index.ts';
import { WEB_ASSETS } from './generated/web-assets.ts';
import type { Bindings } from './env.ts';

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
  'strict-transport-security': 'max-age=31536000',
};

export default {
  async fetch(req: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return app.fetch(req, env, ctx);
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Méthode non autorisée', { status: 405 });

    const isBuildAsset = url.pathname.startsWith('/assets/');
    // Application monopage : toute route inconnue hors /assets renvoie index.html.
    const asset = WEB_ASSETS[url.pathname] ?? (isBuildAsset ? undefined : WEB_ASSETS['/index.html']);
    if (!asset) return new Response('Introuvable', { status: 404, headers: SECURITY_HEADERS });
    const body = asset.body ?? Uint8Array.from(atob(asset.base64!), (ch) => ch.charCodeAt(0));
    return new Response(req.method === 'HEAD' ? null : body, {
      headers: {
        ...SECURITY_HEADERS,
        'content-type': asset.type,
        'cache-control': isBuildAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
      },
    });
  },
};
