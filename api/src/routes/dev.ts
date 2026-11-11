import { Hono } from 'hono';
import type { AppEnv } from '../env.ts';
import { devAuthEnabled, verifyAccess } from '../auth.ts';
import { all } from '../db.ts';
import { notFound } from '../errors.ts';

/** Sélecteur d'identité de développement. N'existe pas en production. */
export const dev = new Hono<AppEnv>();
dev.get('/users', async (c) => {
  if (!devAuthEnabled(c.env)) throw notFound();
  // En démo en ligne, la liste n'est servie qu'à une personne passée par Cloudflare Access.
  if (c.env.ENVIRONMENT === 'demo' && !(await verifyAccess(c.env, (n) => c.req.header(n)))) throw notFound();
  const users = await all<{ email: string; role: string; client_id: string | null }>(c.env.DB, `SELECT email, role, client_id FROM users WHERE email LIKE '%.demo.local' ORDER BY role, email`);
  return c.json({ users });
});
