import { Hono } from 'hono';
import type { AppEnv } from '../env.ts';
import { all, first } from '../db.ts';

export const me = new Hono<AppEnv>();

me.get('/me', async (c) => {
  const user = c.get('user');
  const base = {
    user: { email: user.email, displayName: user.display_name, role: user.role },
    view: c.get('view'),
    logoutUrl: '/cdn-cgi/access/logout',
  };
  if (user.role === 'client') {
    const client = await first<{ id: string; name: string; slug: string }>(c.env.DB, 'SELECT id, name, slug FROM clients WHERE id = ?1', user.client_id);
    return c.json({ ...base, clients: client ? [client] : [] });
  }
  const demoFilter = c.env.ENVIRONMENT === 'production' ? 'WHERE is_demo = 0' : '';
  const clients = await all<{ id: string; name: string; slug: string; status: string; is_demo: number }>(
    c.env.DB, `SELECT id, name, slug, status, is_demo FROM clients ${demoFilter} ORDER BY name`);
  return c.json({ ...base, clients });
});
