import { Hono } from 'hono';
import type { AppEnv } from '../env.ts';
import { requireAgency } from '../auth.ts';
import { scopeClient } from '../scope.ts';
import { audit, first, newId, nowIso, run } from '../db.ts';
import { HttpError, notFound } from '../errors.ts';

/**
 * Gestion des rendez-vous (décision 0006).
 * - L'agence pose le statut (honoré, absent, annulé, prévu) et peut exclure un rendez-vous « hors cible » avec un motif.
 *   Ce statut prime sur GHL : la synchronisation ne l'écrase jamais (status_source = 'agence').
 * - Le client et l'agence peuvent ajouter un rendez-vous ; il naît « prévu » et ne compte qu'une fois validé par l'agence.
 * - Toute modification du compteur est journalisée avec la valeur avant et après (§12).
 */
export const appointments = new Hono<AppEnv>();
appointments.use('/:clientId/appointments', scopeClient);
appointments.use('/:clientId/appointments/*', scopeClient);

const STATUSES = ['prevu', 'honore', 'absent', 'annule'] as const;

interface ApptRow {
  id: string; status: string; counts_toward_target: number; exclusion_reason: string | null; scheduled_at: string;
}

appointments.patch('/:clientId/appointments/:appointmentId', async (c) => {
  requireAgency(c);
  const client = c.get('client');
  const user = c.get('user');
  const appt = await first<ApptRow>(c.env.DB,
    'SELECT id, status, counts_toward_target, exclusion_reason, scheduled_at FROM appointments WHERE id = ?1 AND client_id = ?2',
    c.req.param('appointmentId'), client.id);
  if (!appt) throw notFound();

  const body = await c.req.json<{ status?: string; countsTowardTarget?: boolean; exclusionReason?: string | null }>()
    .catch(() => ({} as Record<string, never>));
  const status = body.status ?? appt.status;
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) throw new HttpError(400, 'Statut invalide.');
  if ((status === 'honore' || status === 'absent') && Date.parse(appt.scheduled_at) > Date.now()) {
    throw new HttpError(400, "Un rendez-vous à venir ne peut pas être marqué honoré ou absent.");
  }
  const counts = body.countsTowardTarget ?? Boolean(appt.counts_toward_target);
  const reason = counts ? null : (body.exclusionReason ?? appt.exclusion_reason ?? '').trim();
  if (!counts && !reason) throw new HttpError(400, "Un motif est obligatoire pour exclure un rendez-vous du compteur.");

  const now = nowIso();
  await run(c.env.DB,
    `UPDATE appointments SET status = ?1, counts_toward_target = ?2, exclusion_reason = ?3,
       status_source = 'agence', status_updated_at = ?4, status_updated_by = ?5, updated_at = ?4
     WHERE id = ?6 AND client_id = ?7`,
    status, counts ? 1 : 0, reason, now, user.id, appt.id, client.id);
  await audit(c.env.DB, {
    clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'rdv_statut', objectType: 'appointment', objectId: appt.id,
    before: { status: appt.status, counts_toward_target: appt.counts_toward_target, exclusion_reason: appt.exclusion_reason },
    after: { status, counts_toward_target: counts ? 1 : 0, exclusion_reason: reason },
  });
  return c.json({ ok: true });
});

appointments.post('/:clientId/appointments', async (c) => {
  const client = c.get('client');
  const user = c.get('user');
  if (user.role === 'agence') requireAgency(c); // l'agence en vue client reste en lecture seule
  const body = await c.req.json<{ contactName?: string; scheduledAt?: string }>().catch(() => ({} as Record<string, never>));
  const name = (body.contactName ?? '').trim();
  if (!name || name.length > 120) throw new HttpError(400, 'Nom du contact requis (120 caractères maximum).');
  const t = Date.parse(body.scheduledAt ?? '');
  if (Number.isNaN(t)) throw new HttpError(400, 'Date du rendez-vous invalide.');
  const id = newId('ap');
  const now = nowIso();
  await run(c.env.DB,
    `INSERT INTO appointments (id, client_id, contact_name, booked_at, scheduled_at, status, origin, created_by_user_id, status_source)
     VALUES (?1, ?2, ?3, ?4, ?5, 'prevu', 'saisie', ?6, ?7)`,
    id, client.id, name, now, new Date(t).toISOString(), user.id, user.role === 'agence' ? 'agence' : 'client');
  await audit(c.env.DB, {
    clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'rdv_ajout', objectType: 'appointment', objectId: id,
    after: { scheduled_at: new Date(t).toISOString(), origin: 'saisie' },
  });
  return c.json({ ok: true, id }, 201);
});
