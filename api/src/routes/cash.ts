import { Hono } from 'hono';
import { todayParis } from '@obsidian/domain';
import type { AppEnv } from '../env.ts';
import { requireAgency } from '../auth.ts';
import { scopeClient } from '../scope.ts';
import { all, audit, first, newId, run } from '../db.ts';
import { refreshManualCash } from '../manual-appointments.ts';
import { HttpError, notFound } from '../errors.ts';

/**
 * Encaissements saisis à la main (décision 0014) : seule source du chiffre d'affaires encaissé et du ROAS.
 * Le client les ajoute et les supprime ; l'agence aussi, en vue agence (en vue client, l'agence reste en lecture).
 */
export const cash = new Hono<AppEnv>();
cash.use('/:clientId/cash', scopeClient);
cash.use('/:clientId/cash/*', scopeClient);

function canWrite(c: { get: (k: 'user' | 'view') => unknown }) {
  const user = c.get('user') as { role: string };
  if (user.role === 'agence') requireAgency(c);
}

cash.get('/:clientId/cash', async (c) => {
  const client = c.get('client');
  const rows = await all<{ id: string; date: string; amount_cents: number; label: string | null; created_by_role: string; created_at: string }>(c.env.DB,
    'SELECT id, date, amount_cents, label, created_by_role, created_at FROM cash_entries WHERE client_id = ?1 ORDER BY date DESC, created_at DESC LIMIT 500', client.id);
  return c.json({
    entries: rows.map((r) => ({ id: r.id, date: r.date, amountCents: r.amount_cents, label: r.label, createdBy: r.created_by_role, createdAt: r.created_at })),
  });
});

cash.post('/:clientId/cash', async (c) => {
  canWrite(c);
  const client = c.get('client');
  const user = c.get('user');
  const body = await c.req.json<{ date?: string; amountCents?: number; label?: string | null }>().catch(() => ({} as Record<string, never>));
  const date = (body.date ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new HttpError(400, 'Date invalide.');
  if (date > todayParis()) throw new HttpError(400, "Un encaissement ne peut pas être daté dans le futur.");
  const amount = Number(body.amountCents);
  if (!Number.isInteger(amount) || amount <= 0 || amount > 100_000_000_00) throw new HttpError(400, 'Montant invalide.');
  const label = (body.label ?? '').trim().slice(0, 160) || null;
  const id = newId('ca');
  await run(c.env.DB,
    'INSERT INTO cash_entries (id, client_id, date, amount_cents, label, created_by_user_id, created_by_role) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
    id, client.id, date, amount, label, user.id, user.role === 'agence' ? 'agence' : 'client');
  await refreshManualCash(c.env.DB, client.id);
  await audit(c.env.DB, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'encaissement_ajout', objectType: 'cash_entry', objectId: id, after: { date, amount_cents: amount } });
  return c.json({ ok: true, id }, 201);
});

cash.delete('/:clientId/cash/:entryId', async (c) => {
  canWrite(c);
  const client = c.get('client');
  const user = c.get('user');
  const row = await first<{ id: string; date: string; amount_cents: number }>(c.env.DB,
    'SELECT id, date, amount_cents FROM cash_entries WHERE id = ?1 AND client_id = ?2', c.req.param('entryId'), client.id);
  if (!row) throw notFound();
  await run(c.env.DB, 'DELETE FROM cash_entries WHERE id = ?1 AND client_id = ?2', row.id, client.id);
  await refreshManualCash(c.env.DB, client.id);
  await audit(c.env.DB, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'encaissement_suppression', objectType: 'cash_entry', objectId: row.id, before: { date: row.date, amount_cents: row.amount_cents } });
  return c.json({ ok: true });
});
