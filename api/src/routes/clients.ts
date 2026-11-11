import { Hono } from 'hono';
import {
  PHASES, computeAppointmentCounter, derived, parisDayStartMs, addDaysYmd, todayParis,
  clientThresholds, safeDiv, type AppointmentLike,
} from '@obsidian/domain';
import type { AppEnv, ClientRow } from '../env.ts';
import { requireAgency } from '../auth.ts';
import { scopeClient } from '../scope.ts';
import { all, audit, first, nowIso, run } from '../db.ts';
import { forbidden, notFound, HttpError } from '../errors.ts';
import { clientTotals, dailySeries, entityTotals, lastSuccessfulSync, periodBounds } from '../metrics.ts';
import {
  serializeConnection, serializeDeliverable, serializeReco, safeJson,
  type ConnectionRow, type DeliverableRow, type RecoRow,
} from '../serialize.ts';

export const clients = new Hono<AppEnv>();
clients.use('/:clientId', scopeClient);
clients.use('/:clientId/*', scopeClient);

// ─── Aperçu du client (en-têtes, bandeaux) ──────────────────────────────────────

clients.get('/:clientId', async (c) => {
  const client = c.get('client');
  const view = c.get('view');
  const db = c.env.DB;
  const [lastSync, broken, overdue, phase] = await Promise.all([
    lastSuccessfulSync(db, client.id),
    all<{ type: string; state: string }>(db, `SELECT type, state FROM connections WHERE client_id = ?1 AND state IN ('casse','degrade')`, client.id),
    overdueClientTasks(db, client.id),
    currentPhaseProgress(db, client.id),
  ]);
  return c.json({
    client: publicClient(client, view),
    lastSync,
    brokenConnections: broken,
    overdueClientTasks: overdue,
    progress: client.campaigns_launched_at ? null : phase,
  });
});

// ─── Tableau de bord (§8) ──────────────────────────────────────────────────────

clients.get('/:clientId/dashboard', async (c) => {
  const client = c.get('client');
  const db = c.env.DB;
  const days = clampDays(c.req.query('days'));
  const p = periodBounds(days);

  const [current, previous, series, campaigns, pipeline, sources, appts, lastSync] = await Promise.all([
    clientTotals(db, client.id, p.from, p.to),
    clientTotals(db, client.id, p.prevFrom, p.prevTo),
    dailySeries(db, client.id, p.from, p.to),
    entityTotals(db, client.id, 'campaign', p.from, p.to),
    all<{ stage_name: string; open_opportunities: number }>(db, 'SELECT stage_name, open_opportunities FROM pipeline_snapshot WHERE client_id = ?1 ORDER BY stage_order', client.id),
    all<{ source: string; contacts: number }>(db,
      `SELECT source, SUM(contacts) AS contacts FROM contact_sources_daily WHERE client_id = ?1 AND date >= ?2 GROUP BY source ORDER BY contacts DESC`,
      client.id, addDaysYmd(todayParis(), -90)),
    all<AppointmentLike & { booked_at: string }>(db, 'SELECT scheduled_at, booked_at, status, counts_toward_target FROM appointments WHERE client_id = ?1', client.id),
    lastSuccessfulSync(db, client.id),
  ]);

  return c.json({
    period: { days, ...p },
    lastSync,
    current: current && { totals: current, derived: derived(current) },
    previous: previous && { totals: previous, derived: derived(previous) },
    attendance: attendance(appts, p.from, p.to),
    series,
    campaigns: campaigns.map((r) => ({
      id: r.entity_id, name: r.entity_name, spend_cents: r.spend_cents, link_clicks: r.link_clicks, leads: r.leads,
      cost_per_lead_cents: safeDiv(r.spend_cents, r.leads),
    })),
    pipeline,
    sources,
    counter: computeAppointmentCounter(client, appts),
    thresholds: clientThresholds(client.thresholds_json, client.unit_economics_json),
  });
});

// ─── Rendez-vous : seule page nominative (§16), pour que le compteur soit vérifiable ─────

clients.get('/:clientId/appointments', async (c) => {
  const client = c.get('client');
  const rows = await all<AppointmentLike & { id: string; contact_name: string | null; booked_at: string; exclusion_reason: string | null }>(
    c.env.DB,
    `SELECT id, contact_name, booked_at, scheduled_at, status, counts_toward_target, exclusion_reason
     FROM appointments WHERE client_id = ?1 ORDER BY scheduled_at DESC`,
    client.id,
  );
  return c.json({ counter: computeAppointmentCounter(client, rows), appointments: rows });
});

// ─── Infrastructure (§10) ──────────────────────────────────────────────────────

clients.get('/:clientId/infrastructure', async (c) => {
  const client = c.get('client');
  const view = c.get('view');
  const db = c.env.DB;
  const [phaseRows, deliverables, tasks] = await Promise.all([
    all<{ phase: string; state: string; started_at: string | null; blocker: string | null }>(db, 'SELECT phase, state, started_at, blocker FROM phases WHERE client_id = ?1', client.id),
    all<DeliverableRow>(db, 'SELECT * FROM deliverables WHERE client_id = ?1 ORDER BY created_at', client.id),
    all<TaskRow>(db, 'SELECT * FROM tasks WHERE client_id = ?1 ORDER BY (status = \'fait\'), due_date IS NULL, due_date, created_at', client.id),
  ]);
  const byKey = new Map(phaseRows.map((r) => [r.phase, r]));
  const today = todayParis();
  return c.json({
    phases: PHASES.map((p) => {
      const r = byKey.get(p.key);
      return { key: p.key, label: p.label, state: r?.state ?? 'a_venir', startedAt: r?.started_at ?? null, blocker: r?.blocker ?? null };
    }),
    deliverables: deliverables.map((d) => serializeDeliverable(d, view)),
    tasks: {
      agence: tasks.filter((t) => t.owner === 'agence').map((t) => serializeTask(t, today)),
      client: tasks.filter((t) => t.owner === 'client').map((t) => serializeTask(t, today)),
    },
  });
});

/** Le client coche ses propres tâches ; l'agence peut tout modifier. */
clients.patch('/:clientId/tasks/:taskId', async (c) => {
  const client = c.get('client');
  const user = c.get('user');
  const task = await first<TaskRow>(c.env.DB, 'SELECT * FROM tasks WHERE id = ?1 AND client_id = ?2', c.req.param('taskId'), client.id);
  if (!task) throw notFound();
  if (user.role === 'client' && task.owner !== 'client') throw forbidden();
  const body = await c.req.json<{ status?: string }>().catch(() => ({} as { status?: string }));
  const allowed = user.role === 'client' ? ['a_faire', 'fait'] : ['a_faire', 'en_cours', 'bloque', 'fait'];
  if (!body.status || !allowed.includes(body.status)) throw new HttpError(400, 'Statut invalide.');
  const now = nowIso();
  await run(c.env.DB, 'UPDATE tasks SET status = ?1, done_at = ?2, updated_at = ?3 WHERE id = ?4 AND client_id = ?5',
    body.status, body.status === 'fait' ? now : null, now, task.id, client.id);
  return c.json({ ok: true });
});

/** Publication explicite d'un livrable (§12) : rien ne devient visible par effet de bord. */
clients.post('/:clientId/deliverables/:deliverableId/publish', async (c) => {
  requireAgency(c);
  const client = c.get('client');
  const user = c.get('user');
  const d = await first<DeliverableRow>(c.env.DB, 'SELECT * FROM deliverables WHERE id = ?1 AND client_id = ?2', c.req.param('deliverableId'), client.id);
  if (!d) throw notFound();
  const body = await c.req.json<{ status?: string; confirm?: boolean }>().catch(() => ({} as { status?: string; confirm?: boolean }));
  if (body.confirm !== true) throw new HttpError(400, 'Confirmation requise pour publier.');
  const status = body.status ?? (d.status === 'brouillon' ? 'a_relire' : d.status);
  if (!['en_preparation', 'a_relire', 'valide', 'mis_a_jour'].includes(status)) throw new HttpError(400, 'Statut invalide.');
  const now = nowIso();
  await run(c.env.DB, 'UPDATE deliverables SET visible_client = 1, status = ?1, published_at = ?2, updated_at = ?2 WHERE id = ?3 AND client_id = ?4',
    status, now, d.id, client.id);
  await audit(c.env.DB, {
    clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'publication_livrable', objectType: 'deliverable', objectId: d.id,
    before: { status: d.status, visible_client: d.visible_client }, after: { status, visible_client: 1 },
  });
  return c.json({ ok: true });
});

// ─── Connexions (§11) ─────────────────────────────────────────────────────────

clients.get('/:clientId/connections', async (c) => {
  const client = c.get('client');
  // On ne sélectionne la colonne du jeton que pour savoir s'il est configuré ; sa valeur ne sort jamais.
  const rows = await all<ConnectionRow>(c.env.DB,
    `SELECT id, type, external_id, state, last_checked_at, error_message, client_action, guide_id,
            CASE WHEN token_ciphertext IS NULL THEN NULL ELSE 'x' END AS token_ciphertext, token_expires_at
     FROM connections WHERE client_id = ?1`, client.id);
  return c.json({ connections: rows.map((r) => serializeConnection(r, c.get('view'))) });
});

// ─── Recommandations (§9 bloc 01, §14) ─────────────────────────────────────────

clients.get('/:clientId/recommendations', async (c) => {
  const client = c.get('client');
  const view = c.get('view');
  const filter = view === 'client' ? 'AND visible_client = 1' : '';
  const rows = await all<RecoRow>(c.env.DB,
    `SELECT * FROM recommendations WHERE client_id = ?1 ${filter} ORDER BY date DESC,
       CASE severity WHEN 'corriger' THEN 0 WHEN 'surveiller' THEN 1 ELSE 2 END LIMIT 60`, client.id);
  return c.json({ recommendations: rows.map((r) => serializeReco(r, view)) });
});

// ─── Guides (§11) ─────────────────────────────────────────────────────────────

clients.get('/:clientId/guides', async (c) => {
  const client = c.get('client');
  const view = c.get('view');
  const filter = view === 'client' ? 'AND g.published = 1' : '';
  const rows = await all<{ id: string; title: string; kind: string; url: string | null; r2_key: string | null; published: number; client_id: string | null; read_at: string | null }>(
    c.env.DB,
    `SELECT g.id, g.title, g.kind, g.url, g.r2_key, g.published, g.client_id, r.read_at
     FROM guides g LEFT JOIN guide_reads r ON r.guide_id = g.id AND r.client_id = ?1
     WHERE (g.client_id IS NULL OR g.client_id = ?1) ${filter}
     ORDER BY g.client_id IS NULL, g.sort_order`, client.id);
  return c.json({
    guides: rows.map((g) => ({
      id: g.id, title: g.title, kind: g.kind, url: g.url, hasFile: Boolean(g.r2_key),
      pinned: g.client_id !== null, readAt: g.read_at, ...(view === 'agence' ? { published: Boolean(g.published) } : {}),
    })),
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface TaskRow {
  id: string; label: string; description: string | null; owner: 'agence' | 'client'; phase: string | null;
  status: string; blocking: number; due_date: string | null; link_url: string | null; guide_id: string | null;
  deliverable_id: string | null; done_at: string | null;
}

function serializeTask(t: TaskRow, today: string) {
  return {
    id: t.id, label: t.label, description: t.description, phase: t.phase, status: t.status, blocking: Boolean(t.blocking),
    dueDate: t.due_date, linkUrl: t.link_url, guideId: t.guide_id, doneAt: t.done_at,
    overdue: t.status !== 'fait' && !!t.due_date && t.due_date < today,
  };
}

export async function overdueClientTasks(db: D1Database, clientId: string) {
  return all<{ id: string; label: string; due_date: string; blocking: number; guide_id: string | null }>(db,
    `SELECT id, label, due_date, blocking, guide_id FROM tasks
     WHERE client_id = ?1 AND owner = 'client' AND status != 'fait' AND due_date IS NOT NULL AND due_date < ?2
     ORDER BY due_date`, clientId, todayParis());
}

/** « Onboarding en cours · 3/10 · prochaine étape : contrat signé » (§8). */
export async function currentPhaseProgress(db: D1Database, clientId: string) {
  const phases = await all<{ phase: string; state: string }>(db, 'SELECT phase, state FROM phases WHERE client_id = ?1', clientId);
  const states = new Map(phases.map((p) => [p.phase, p.state]));
  const current = PHASES.find((p) => states.get(p.key) === 'en_cours')
    ?? PHASES.find((p) => !['livre', 'valide'].includes(states.get(p.key) ?? 'a_venir'));
  if (!current) return null;
  const tasks = await all<{ label: string; status: string }>(db,
    `SELECT label, status FROM tasks WHERE client_id = ?1 AND phase = ?2 ORDER BY due_date IS NULL, due_date, created_at`, clientId, current.key);
  const done = tasks.filter((t) => t.status === 'fait').length;
  return {
    phase: current.key, label: current.label, done, total: tasks.length,
    nextStep: tasks.find((t) => t.status !== 'fait')?.label ?? null,
  };
}

function publicClient(c: ClientRow, view: 'agence' | 'client') {
  const base = {
    id: c.id, name: c.name, slug: c.slug, logoUrl: c.logo_url, status: c.status, offer: c.offer,
    startDate: c.start_date, campaignsLaunchedAt: c.campaigns_launched_at,
    appointmentTarget: c.appointment_target, windowDays: c.window_days,
    currency: c.ad_account_currency, timezone: c.ad_account_timezone, isDemo: Boolean(c.is_demo),
    onboardingSubmittedAt: c.onboarding_submitted_at ?? null,
  };
  if (view === 'client') return base;
  return {
    ...base, thresholds: clientThresholds(c.thresholds_json, c.unit_economics_json), unitEconomics: safeJson(c.unit_economics_json),
    autoPublishRecos: Boolean(c.auto_publish_recos), onboardingLocked: Boolean(c.onboarding_locked),
  };
}

function clampDays(q: string | undefined): number {
  const n = Number(q);
  return [7, 14, 30, 90].includes(n) ? n : 30;
}

/** Taux de présence sur les RDV tenus dans la période. null + raison si les statuts manquent. */
function attendance(appts: AppointmentLike[], from: string, to: string) {
  const start = parisDayStartMs(from);
  const end = parisDayStartMs(addDaysYmd(to, 1));
  const now = Date.now();
  let held = 0, noShow = 0, missing = 0, upcoming = 0;
  for (const a of appts) {
    const t = Date.parse(a.scheduled_at);
    if (a.status !== 'prevu' && (t < start || t >= end)) continue;
    if (a.status === 'honore') held++;
    else if (a.status === 'absent') noShow++;
    else if (a.status === 'prevu' && t > now) upcoming++;
    else if (a.status === 'prevu' && t >= start && t < end) missing++;
  }
  const decided = held + noShow;
  return {
    held, noShow, missingStatus: missing, upcoming,
    rate: decided > 0 ? held / decided : null,
    reason: decided === 0 ? (missing > 0 ? 'Statuts non renseignés dans GHL' : 'Aucun rendez-vous passé sur la période') : null,
  };
}
