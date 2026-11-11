import { Hono } from 'hono';
import type { AppEnv } from '../env.ts';
import { devAuthEnabled } from '../auth.ts';
import { all } from '../db.ts';
import { notFound } from '../errors.ts';

/** Sélecteur d'identité de développement. N'existe pas en production. */
export const dev = new Hono<AppEnv>();
dev.get('/users', async (c) => {
  if (!devAuthEnabled(c.env)) throw notFound();
  const users = await all<{ email: string; role: string; client_id: string | null }>(c.env.DB, 'SELECT email, role, client_id FROM users ORDER BY role, email');
  return c.json({ users });
});
