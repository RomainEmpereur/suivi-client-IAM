import { Hono } from 'hono';
import type { AppEnv } from '../env.ts';
import { requireAgency } from '../auth.ts';
import { scopeClient } from '../scope.ts';
import { all, audit, first, newId, nowIso, run } from '../db.ts';
import { refreshHeldFromAppointments, refreshManualAppointments } from '../manual-appointments.ts';
import { HttpError, notFound } from '../errors.ts';

/**
 * Gestion des rendez-vous (décision 0006).
 * - Le client pose le statut (honoré, absent, annulé, prévu) de ses rendez-vous (décision 0014) ; l'agence aussi, en vue agence,
 *   et elle seule peut exclure un rendez-vous « hors cible » avec un motif.
 *   Ce statut prime sur GHL : la synchronisation ne l'écrase jamais (status_source = 'client' ou 'agence').
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

appointments.use('/:clientId/crm-leads', scopeClient);

/** Recherche d'un lead du CRM par nom ou entreprise (liste synchronisée chaque matin, aucun appel GHL en direct). */
appointments.get('/:clientId/crm-leads', async (c) => {
  const client = c.get('client');
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const synced = await first<{ n: number; at: string | null }>(c.env.DB, 'SELECT COUNT(*) AS n, MAX(synced_at) AS at FROM crm_leads WHERE client_id = ?1', client.id);
  if (q.length < 2) return c.json({ leads: [], crmSynced: Boolean(synced?.n), syncedAt: synced?.at ?? null });
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const rows = await all<{ contact_id: string; name: string | null; company: string | null; stage_name: string | null; pipeline_name: string | null; entered_at: string | null; next_appointment_at: string | null; status: string | null }>(c.env.DB,
    `SELECT contact_id, name, company, stage_name, pipeline_name, entered_at, next_appointment_at, status FROM crm_leads
     WHERE client_id = ?1 AND (lower(name) LIKE ?2 OR lower(company) LIKE ?2) ORDER BY entered_at DESC LIMIT 8`, client.id, like);
  return c.json({
    crmSynced: Boolean(synced?.n), syncedAt: synced?.at ?? null,
    leads: rows.map((r) => ({ contactId: r.contact_id, name: r.name, company: r.company, stage: r.stage_name, pipeline: r.pipeline_name, enteredAt: r.entered_at, nextAppointmentAt: r.next_appointment_at, status: r.status })),
  });
});

appointments.patch('/:clientId/appointments/:appointmentId', async (c) => {
  const client = c.get('client');
  const user = c.get('user');
  // Le client renseigne le statut de ses rendez-vous (décision 0014) ; l'agence le peut aussi, en vue agence seulement.
  if (user.role === 'agence') requireAgency(c);
  const appt = await first<ApptRow>(c.env.DB,
    'SELECT id, status, counts_toward_target, exclusion_reason, scheduled_at FROM appointments WHERE id = ?1 AND client_id = ?2',
    c.req.param('appointmentId'), client.id);
  if (!appt) throw notFound();

  const body = await c.req.json<{ status?: string; countsTowardTarget?: boolean; exclusionReason?: string | null }>()
    .catch(() => ({} as Record<string, never>));
  if (user.role !== 'agence' && (body.countsTowardTarget !== undefined || body.exclusionReason !== undefined)) {
    throw new HttpError(403, "Seule l'agence peut exclure un rendez-vous.");
  }
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
       status_source = ?8, status_updated_at = ?4, status_updated_by = ?5, updated_at = ?4
     WHERE id = ?6 AND client_id = ?7`,
    status, counts ? 1 : 0, reason, now, user.id, appt.id, client.id, user.role === 'agence' ? 'agence' : 'client');
  await refreshManualAppointments(c.env.DB, client.id);
  await refreshHeldFromAppointments(c.env.DB, client.id);
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
  const body = await c.req.json<{ contactName?: string; scheduledAt?: string; ghlContactId?: string | null }>().catch(() => ({} as Record<string, never>));
  let ghlContactId: string | null = null;
  if (body.ghlContactId) {
    const lead = await first<{ contact_id: string }>(c.env.DB, 'SELECT contact_id FROM crm_leads WHERE client_id = ?1 AND contact_id = ?2', client.id, body.ghlContactId);
    if (!lead) throw new HttpError(400, 'Lead introuvable dans le CRM synchronisé.');
    ghlContactId = lead.contact_id;
  }
  const name = (body.contactName ?? '').trim();
  if (!name || name.length > 120) throw new HttpError(400, 'Nom du contact requis (120 caractères maximum).');
  const t = Date.parse(body.scheduledAt ?? '');
  if (Number.isNaN(t)) throw new HttpError(400, 'Date du rendez-vous invalide.');
  const id = newId('ap');
  const now = nowIso();
  await run(c.env.DB,
    `INSERT INTO appointments (id, client_id, contact_name, booked_at, scheduled_at, status, origin, created_by_user_id, status_source, ghl_contact_id)
     VALUES (?1, ?2, ?3, ?4, ?5, 'prevu', 'saisie', ?6, ?7, ?8)`,
    id, client.id, name, now, new Date(t).toISOString(), user.id, user.role === 'agence' ? 'agence' : 'client', ghlContactId);
  await refreshManualAppointments(c.env.DB, client.id);
  await audit(c.env.DB, {
    clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'rdv_ajout', objectType: 'appointment', objectId: id,
    after: { scheduled_at: new Date(t).toISOString(), origin: 'saisie' },
  });
  return c.json({ ok: true, id }, 201);
});
