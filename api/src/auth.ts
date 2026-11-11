import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AppEnv, Bindings, UserRow } from './env.ts';
import { HttpError, forbidden } from './errors.ts';
import { audit, first, nowIso, run } from './db.ts';

const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export function devAuthEnabled(env: Bindings): boolean {
  return env.ENVIRONMENT !== 'production' && env.DEV_AUTH === '1';
}

const DEMO_IDENTITY = /^[^@\s]+@[a-z0-9.-]+\.demo\.local$/;

/** Vérifie le jeton signé Cloudflare Access (signature, émetteur, audience). Renvoie l'email ou null. */
export async function verifyAccess(env: Bindings, header: (n: string) => string | undefined): Promise<string | null> {
  const token = header('Cf-Access-Jwt-Assertion');
  if (!token) return null;
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) throw new HttpError(500, 'Authentification non configurée.');
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  let jwks = jwksByTeam.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksByTeam.set(issuer, jwks);
  }
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: env.ACCESS_AUD });
    return typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Identité de la requête.
 * - Production : uniquement le jeton Cloudflare Access vérifié.
 * - Démo en ligne : le jeton Access est OBLIGATOIRE ; ensuite seulement, une identité fictive *.demo.local
 *   peut être choisie (X-Dev-User). La base de démo ne contient que des données fictives.
 * - Développement / tests : en-tête X-Dev-User.
 */
async function resolveEmail(env: Bindings, header: (n: string) => string | undefined): Promise<string | null> {
  if (env.ENVIRONMENT === 'demo') {
    const accessEmail = await verifyAccess(env, header);
    if (!accessEmail) return null;
    const dev = header('X-Dev-User')?.trim().toLowerCase();
    if (devAuthEnabled(env) && dev && DEMO_IDENTITY.test(dev)) return dev;
    return accessEmail;
  }
  if (devAuthEnabled(env)) {
    const dev = header('X-Dev-User');
    if (dev) return dev.trim().toLowerCase();
  }
  return verifyAccess(env, header);
}

const LOGIN_TOUCH_MS = 12 * 3600 * 1000;

export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const email = await resolveEmail(c.env, (n) => c.req.header(n));
  if (!email) throw new HttpError(401, 'Connexion requise.');

  const user = await first<UserRow>(
    c.env.DB,
    'SELECT id, email, display_name, role, client_id, last_login_at FROM users WHERE email = ?1 COLLATE NOCASE',
    email,
  );
  if (!user) throw forbidden("Cette adresse n'a pas accès à l'espace. Contactez Obsidian Partners.");

  // Bascule de vue : seule l'agence peut demander la vue client ; un client est toujours en vue client.
  const view = user.role === 'agence' && c.req.header('X-View') !== 'client' ? 'agence' : 'client';
  if (user.role === 'agence' && view === 'client' && c.req.method !== 'GET') {
    throw forbidden('La vue client est en lecture seule. Revenez en vue agence pour modifier.');
  }

  if (!user.last_login_at || Date.now() - Date.parse(user.last_login_at) > LOGIN_TOUCH_MS) {
    const now = nowIso();
    await run(c.env.DB, 'UPDATE users SET last_login_at = ?1, updated_at = ?1 WHERE id = ?2', now, user.id);
    await audit(c.env.DB, {
      clientId: user.client_id, actorId: user.id, actorEmail: user.email,
      action: 'connexion', objectType: 'user', objectId: user.id,
    });
    user.last_login_at = now;
  }

  c.set('user', user);
  c.set('view', view);
  await next();
};

/** Garde : écriture réservée à l'agence en vue agence. */
export function requireAgency(c: { get: (k: 'user' | 'view') => unknown }) {
  const user = c.get('user') as UserRow;
  if (user.role !== 'agence' || c.get('view') !== 'agence') throw forbidden();
}
