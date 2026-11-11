import { Hono } from 'hono';
import type { AppEnv } from '../env.ts';
import { requireAgency } from '../auth.ts';
import { scopeClient } from '../scope.ts';
import { audit, nowIso, run, first } from '../db.ts';
import { HttpError } from '../errors.ts';
import { encryptToken } from '../crypto.ts';
import { createGhlClient, GhlError } from '../../../packages/ghl/src/index.ts';
import { runGhlForClient } from '../../../jobs/sync-daily/src/run.ts';

/**
 * Saisie des jetons (agence uniquement, §16) : chiffrés au repos, jamais renvoyés, testés à l'enregistrement.
 * Synchronisation manuelle d'un client (§13 « reprise manuelle »).
 */
export const connections = new Hono<AppEnv>();
connections.use('/:clientId/connections/*', scopeClient);
connections.use('/:clientId/sync', scopeClient);

connections.put('/:clientId/connections/:type/token', async (c) => {
  requireAgency(c);
  const type = c.req.param('type');
  if (type !== 'ghl' && type !== 'meta') throw new HttpError(400, 'Type de connexion non pris en charge.');
  const client = c.get('client');
  const user = c.get('user');
  const body = await c.req.json<{ token?: string; externalId?: string }>().catch(() => ({} as Record<string, never>));
  const token = (body.token ?? '').trim();
  const externalId = (body.externalId ?? '').trim();
  if (token.length < 10 || token.length > 4000 || /\s/.test(token)) throw new HttpError(400, 'Jeton invalide.');
  if (!externalId) throw new HttpError(400, type === 'ghl' ? 'Identifiant du sous-compte (location) requis.' : 'Identifiant du compte publicitaire requis.');
  if (!c.env.TOKEN_ENCRYPTION_KEY) throw new HttpError(500, 'Clé de chiffrement non configurée (secret TOKEN_ENCRYPTION_KEY).');

  // Test immédiat, en lecture seule.
  let state = 'ok', error: string | null = null;
  if (type === 'ghl') {
    try { await createGhlClient({ token, maxAttempts: 2 }).location(externalId); }
    catch (e) { state = 'casse'; error = e instanceof GhlError ? `Test refusé par GHL (HTTP ${e.status})` : 'Test impossible'; }
  }
  const cipher = await encryptToken(token, c.env.TOKEN_ENCRYPTION_KEY);
  const now = nowIso();
  const existing = await first<{ id: string }>(c.env.DB, 'SELECT id FROM connections WHERE client_id = ?1 AND type = ?2', client.id, type);
  if (existing) {
    await run(c.env.DB, `UPDATE connections SET external_id = ?1, token_ciphertext = ?2, state = ?3, error_message = ?4, last_checked_at = ?5, updated_at = ?5
      WHERE id = ?6 AND client_id = ?7`, externalId, cipher, state, error, now, existing.id, client.id);
  } else {
    await run(c.env.DB, `INSERT INTO connections (id, client_id, type, external_id, token_ciphertext, state, error_message, last_checked_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`, `cn_${client.id}_${type}`, client.id, type, externalId, cipher, state, error, now);
  }
  await audit(c.env.DB, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'connexion_jeton', objectType: 'connection', objectId: type, after: { state } });
  return c.json({ ok: true, state, error });
});

connections.post('/:clientId/sync', async (c) => {
  requireAgency(c);
  const client = c.get('client');
  const body = await c.req.json<{ from?: string; to?: string }>().catch(() => ({} as Record<string, never>));
  const YMD = /^\d{4}-\d{2}-\d{2}$/;
  if ((body.from && !YMD.test(body.from)) || (body.to && !YMD.test(body.to))) throw new HttpError(400, 'Dates invalides.');
  const r = await runGhlForClient(c.env, client.id, { from: body.from, to: body.to });
  if (!r.ok) throw new HttpError(502, r.error);
  return c.json({ ok: true, result: r.result });
});
