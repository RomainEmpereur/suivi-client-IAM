import { Hono } from 'hono';
import {
  PHASES, computeAppointmentCounter, derived, parisDayStartMs, addDaysYmd, todayParis,
  clientThresholds, safeDiv, type AppointmentLike,
} from '@obsidian/domain';
import type { AppEnv, ClientRow } from '../env.ts';
import { requireAgency } from '../auth.ts';
import { scopeClient } from '../scope.ts';
import { all, audit, first, newId, nowIso, run } from '../db.ts';
import { forbidden, notFound, HttpError } from '../errors.ts';
import { clientTotals, dailySeries, entityTotals, lastSuccessfulSync, periodBounds, rangeBounds } from '../metrics.ts';
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
  // Période : ?from=AAAA-MM-JJ&to=AAAA-MM-JJ (personnalisée, 731 jours max) ou ?days=7|14|30|90.
  const custom = parseRange(c.req.query('from'), c.req.query('to'));
  const days = custom ? custom.days : clampDays(c.req.query('days'));
  const p = custom ?? periodBounds(days);

  const [current, previous, series, campaigns, pipeline, sources, appts, lastSync] = await Promise.all([
    clientTotals(db, client.id, p.from, p.to),
    clientTotals(db, client.id, p.prevFrom, p.prevTo),
    dailySeries(db, client.id, p.from, p.to),
    entityTotals(db, client.id, 'campaign', p.from, p.to),
    all<{ stage_name: string; open_opportunities: number; pipeline_name: string | null }>(db, 'SELECT stage_name, open_opportunities, pipeline_name FROM pipeline_snapshot WHERE client_id = ?1 ORDER BY stage_order', client.id),
    all<{ source: string; contacts: number }>(db,
      `SELECT source, SUM(contacts) AS contacts FROM contact_sources_daily WHERE client_id = ?1 AND date >= ?2 GROUP BY source ORDER BY contacts DESC`,
      client.id, addDaysYmd(todayParis(), -90)),
    all<AppointmentLike & { booked_at: string }>(db, 'SELECT scheduled_at, booked_at, status, counts_toward_target FROM appointments WHERE client_id = ?1', client.id),
    lastSuccessfulSync(db, client.id),
  ]);

  return c.json({
    period: { ...p, days },
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
    unmeasured: parseList(client.unmeasured_json),
  });
});

// ─── Rendez-vous : seule page nominative (§16), pour que le compteur soit vérifiable ─────

clients.get('/:clientId/appointments', async (c) => {
  const client = c.get('client');
  const rows = await all<AppointmentLike & { id: string; contact_name: string | null; booked_at: string; exclusion_reason: string | null }>(
    c.env.DB,
    `SELECT id, contact_name, booked_at, scheduled_at, status, counts_toward_target, exclusion_reason,
            origin, status_source, status_updated_at
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
  const [phaseRows, deliverables, tasks, commentCounts] = await Promise.all([
    all<{ phase: string; state: string; started_at: string | null; blocker: string | null }>(db, 'SELECT phase, state, started_at, blocker FROM phases WHERE client_id = ?1', client.id),
    all<DeliverableRow>(db, 'SELECT * FROM deliverables WHERE client_id = ?1 ORDER BY created_at', client.id),
    all<TaskRow>(db, 'SELECT * FROM tasks WHERE client_id = ?1 ORDER BY (status = \'fait\'), due_date IS NULL, due_date, created_at', client.id),
    all<{ deliverable_id: string; n: number; from_client: number; pending: number }>(db,
      `SELECT deliverable_id, COUNT(*) AS n, SUM(author_role = 'client') AS from_client, SUM(author_role = 'client' AND handled_at IS NULL) AS pending
       FROM deliverable_comments WHERE client_id = ?1 GROUP BY deliverable_id`, client.id),
  ]);
  const comments = new Map(commentCounts.map((r) => [r.deliverable_id, r]));
  const byKey = new Map(phaseRows.map((r) => [r.phase, r]));
  const today = todayParis();
  return c.json({
    phases: PHASES.map((p) => {
      const r = byKey.get(p.key);
      return { key: p.key, label: p.label, state: r?.state ?? 'a_venir', startedAt: r?.started_at ?? null, blocker: r?.blocker ?? null };
    }),
    deliverables: deliverables.map((d) => {
      const out = serializeDeliverable(d, view);
      const n = comments.get(d.id);
      if (!(out.published || view === 'agence')) return out;
      return { ...out, comments: n?.n ?? 0, clientComments: n?.from_client ?? 0, ...(view === 'agence' ? { pendingClientComments: n?.pending ?? 0 } : {}) };
    }),
    tasks: {
      agence: tasks.filter((t) => t.owner === 'agence').map((t) => serializeTask(t, today)),
      client: tasks.filter((t) => t.owner === 'client').map((t) => serializeTask(t, today)),
    },
  });
});

/**
 * Tâches (§10, §12) : le client coche ses propres tâches (à faire / fait) ; l'agence crée, modifie et supprime.
 * Toute modification par l'agence est journalisée (avant / après).
 */
const TASK_STATUSES = ['a_faire', 'en_cours', 'bloque', 'fait'];
const PHASE_KEYS: string[] = PHASES.map((p) => p.key);
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

interface TaskInput { label?: string; description?: string | null; owner?: string; phase?: string | null; status?: string; dueDate?: string | null; blocking?: boolean }

function validateTaskInput(b: TaskInput, partial: boolean) {
  if (!partial || b.label !== undefined) {
    const l = (b.label ?? '').trim();
    if (!l || l.length > 200) throw new HttpError(400, 'Libellé requis (200 caractères maximum).');
  }
  if (b.owner !== undefined && !['agence', 'client'].includes(b.owner)) throw new HttpError(400, 'Responsable invalide.');
  if (!partial && !b.owner) throw new HttpError(400, 'Responsable requis.');
  if (b.phase !== undefined && b.phase !== null && !PHASE_KEYS.includes(b.phase)) throw new HttpError(400, 'Phase invalide.');
  if (b.status !== undefined && !TASK_STATUSES.includes(b.status)) throw new HttpError(400, 'Statut invalide.');
  if (b.dueDate !== undefined && b.dueDate !== null && !YMD_RE.test(b.dueDate)) throw new HttpError(400, 'Échéance invalide.');
  if (b.description !== undefined && b.description !== null && b.description.length > 2000) throw new HttpError(400, 'Description trop longue.');
}

clients.patch('/:clientId/tasks/:taskId', async (c) => {
  const client = c.get('client');
  const user = c.get('user');
  const task = await first<TaskRow>(c.env.DB, 'SELECT * FROM tasks WHERE id = ?1 AND client_id = ?2', c.req.param('taskId'), client.id);
  if (!task) throw notFound();
  const body = await c.req.json<TaskInput>().catch(() => ({} as TaskInput));
  const now = nowIso();

  if (user.role === 'client') {
    if (task.owner !== 'client') throw forbidden();
    const keys = Object.keys(body);
    if (keys.some((k) => k !== 'status') || !body.status || !['a_faire', 'fait'].includes(body.status)) throw new HttpError(400, 'Statut invalide.');
    await run(c.env.DB, 'UPDATE tasks SET status = ?1, done_at = ?2, updated_at = ?3 WHERE id = ?4 AND client_id = ?5',
      body.status, body.status === 'fait' ? now : null, now, task.id, client.id);
    return c.json({ ok: true });
  }

  requireAgency(c);
  validateTaskInput(body, true);
  const next = {
    label: body.label !== undefined ? body.label.trim() : task.label,
    description: body.description !== undefined ? body.description : task.description,
    owner: body.owner ?? task.owner,
    phase: body.phase !== undefined ? body.phase : task.phase,
    status: body.status ?? task.status,
    due_date: body.dueDate !== undefined ? body.dueDate : task.due_date,
    blocking: body.blocking !== undefined ? (body.blocking ? 1 : 0) : task.blocking,
  };
  const doneAt = next.status === 'fait' ? (task.status === 'fait' ? task.done_at : now) : null;
  await run(c.env.DB,
    `UPDATE tasks SET label = ?1, description = ?2, owner = ?3, phase = ?4, status = ?5, due_date = ?6, blocking = ?7, done_at = ?8, updated_at = ?9
     WHERE id = ?10 AND client_id = ?11`,
    next.label, next.description, next.owner, next.phase, next.status, next.due_date, next.blocking, doneAt, now, task.id, client.id);
  await audit(c.env.DB, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'tache_modifiee', objectType: 'task', objectId: task.id,
    before: { label: task.label, owner: task.owner, phase: task.phase, status: task.status, due_date: task.due_date, blocking: task.blocking }, after: next });
  return c.json({ ok: true });
});

clients.post('/:clientId/tasks', async (c) => {
  requireAgency(c);
  const client = c.get('client');
  const user = c.get('user');
  const body = await c.req.json<TaskInput>().catch(() => ({} as TaskInput));
  validateTaskInput(body, false);
  const id = newId('tk');
  const status = body.status ?? 'a_faire';
  await run(c.env.DB,
    `INSERT INTO tasks (id, client_id, label, description, owner, phase, status, due_date, blocking, done_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    id, client.id, body.label!.trim(), body.description ?? null, body.owner, body.phase ?? null, status, body.dueDate ?? null,
    body.blocking ? 1 : 0, status === 'fait' ? nowIso() : null);
  await audit(c.env.DB, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'tache_creee', objectType: 'task', objectId: id,
    after: { label: body.label, owner: body.owner, phase: body.phase ?? null, status } });
  return c.json({ ok: true, id }, 201);
});

clients.delete('/:clientId/tasks/:taskId', async (c) => {
  requireAgency(c);
  const client = c.get('client');
  const user = c.get('user');
  const task = await first<TaskRow>(c.env.DB, 'SELECT * FROM tasks WHERE id = ?1 AND client_id = ?2', c.req.param('taskId'), client.id);
  if (!task) throw notFound();
  await run(c.env.DB, 'DELETE FROM tasks WHERE id = ?1 AND client_id = ?2', task.id, client.id);
  await audit(c.env.DB, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'tache_supprimee', objectType: 'task', objectId: task.id,
    before: { label: task.label, owner: task.owner, phase: task.phase, status: task.status } });
  return c.json({ ok: true });
});

/** Phases de la frise (§10) : état, date de début, blocage. Agence uniquement. */
clients.patch('/:clientId/phases/:phase', async (c) => {
  requireAgency(c);
  const client = c.get('client');
  const user = c.get('user');
  const phase = c.req.param('phase');
  if (!PHASE_KEYS.includes(phase)) throw notFound();
  const body = await c.req.json<{ state?: string; startedAt?: string | null; blocker?: string | null }>().catch(() => ({} as Record<string, never>));
  if (body.state !== undefined && !['a_venir', 'en_cours', 'livre', 'valide'].includes(body.state)) throw new HttpError(400, 'État invalide.');
  if (body.startedAt !== undefined && body.startedAt !== null && !YMD_RE.test(body.startedAt)) throw new HttpError(400, 'Date invalide.');
  if (body.blocker !== undefined && body.blocker !== null && body.blocker.length > 300) throw new HttpError(400, 'Blocage trop long.');
  const before = await first<{ state: string; started_at: string | null; blocker: string | null }>(c.env.DB,
    'SELECT state, started_at, blocker FROM phases WHERE client_id = ?1 AND phase = ?2', client.id, phase);
  const next = {
    state: body.state ?? before?.state ?? 'a_venir',
    started_at: body.startedAt !== undefined ? body.startedAt : before?.started_at ?? null,
    blocker: body.blocker !== undefined ? (body.blocker?.trim() || null) : before?.blocker ?? null,
  };
  await run(c.env.DB,
    `INSERT INTO phases (id, client_id, phase, state, started_at, blocker) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT (client_id, phase) DO UPDATE SET state = excluded.state, started_at = excluded.started_at, blocker = excluded.blocker,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    `ph_${client.id}_${phase}`, client.id, phase, next.state, next.started_at, next.blocker);
  await audit(c.env.DB, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'phase_modifiee', objectType: 'phase', objectId: phase,
    before: before ?? null, after: next });
  return c.json({ ok: true });
});

/** Publication explicite d'un livrable (§12) : rien ne devient visible par effet de bord. */
/** Lecture d'un livrable rédigé (texte mis en page). Le client ne lit que ce qui est publié. */
clients.get('/:clientId/deliverables/:deliverableId', async (c) => {
  const client = c.get('client');
  const view = c.get('view');
  const d = await first<DeliverableRow>(c.env.DB, 'SELECT * FROM deliverables WHERE id = ?1 AND client_id = ?2', c.req.param('deliverableId'), client.id);
  if (!d) throw notFound();
  const out = serializeDeliverable(d, view);
  if (!out.published && view === 'client') return c.json({ deliverable: out, contentMd: null });
  return c.json({ deliverable: out, contentMd: d.content_md ?? null });
});

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

// ─── Livrables : édition agence et commentaires (décision 0020) ─────────────────

const PHASE_OF_TYPE: Record<string, string> = {
  offre: 'offre', landing: 'landing', vsl_script: 'vsl', vsl_video: 'vsl', ads_scripts: 'ads', ads_videos: 'ads',
  sequences: 'sequences', tracking: 'recette', campagne: 'lancement',
};
const EDIT_STATUSES = ['brouillon', 'en_preparation', 'a_relire', 'valide', 'mis_a_jour'];
const isHttpsUrl = (v: string) => { try { return new URL(v).protocol === 'https:'; } catch { return false; } };

function readDeliverableFields(body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || 'type' in body) {
    if (typeof body.type !== 'string' || !PHASE_OF_TYPE[body.type]) throw new HttpError(400, 'Type de livrable inconnu.');
    out.type = body.type; out.phase = PHASE_OF_TYPE[body.type];
  }
  if (!partial || 'title' in body) {
    const v = typeof body.title === 'string' ? body.title.trim() : '';
    if (!v || v.length > 160) throw new HttpError(400, 'Titre requis (160 caractères au plus).');
    out.title = v;
  }
  if ('clientSummary' in body) {
    if (body.clientSummary != null && typeof body.clientSummary !== 'string') throw new HttpError(400, 'Résumé invalide.');
    out.client_summary = (body.clientSummary as string | null)?.trim().slice(0, 400) || null;
  }
  if ('externalUrl' in body) {
    const v = typeof body.externalUrl === 'string' ? body.externalUrl.trim() : '';
    if (v && (!isHttpsUrl(v) || v.length > 600)) throw new HttpError(400, 'Le lien doit être une adresse https.');
    out.external_url = v || null;
  }
  if ('contentMd' in body) {
    if (body.contentMd != null && typeof body.contentMd !== 'string') throw new HttpError(400, 'Contenu invalide.');
    const v = (body.contentMd as string | null)?.replace(/\r\n/g, '\n') ?? '';
    if (v.length > 400_000) throw new HttpError(400, 'Contenu trop long.');
    out.content_md = v.trim() ? v : null;
  }
  if ('status' in body) {
    if (!EDIT_STATUSES.includes(body.status as string)) throw new HttpError(400, 'Statut invalide.');
    out.status = body.status;
  }
  if ('visible' in body) out.visible_client = body.visible ? 1 : 0;
  return out;
}

/** L'agence ajoute un livrable (lien Drive, document) : brouillon par défaut, publié si « visible ». */
clients.post('/:clientId/deliverables', async (c) => {
  requireAgency(c);
  const client = c.get('client');
  const user = c.get('user');
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Corps de requête invalide.');
  const f = readDeliverableFields(body, false);
  if (!f.external_url && !f.content_md) throw new HttpError(400, 'Un lien ou un contenu est requis.');
  const visible = f.visible_client === 1;
  const status = (f.status as string | undefined) ?? (visible ? 'valide' : 'brouillon');
  if (visible && status === 'brouillon') throw new HttpError(400, 'Un livrable visible ne peut pas rester en brouillon.');
  const id = newId('dlv');
  const now = nowIso();
  await run(c.env.DB, `INSERT INTO deliverables (id, client_id, type, phase, title, status, version, external_url, client_summary, content_md, visible_client, published_at, origin)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8, ?9, ?10, ?11, 'manuel')`,
    id, client.id, f.type, f.phase, f.title, status, f.external_url ?? null, f.client_summary ?? null, f.content_md ?? null, visible ? 1 : 0, visible ? now : null);
  await audit(c.env.DB, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'livrable_creation', objectType: 'deliverable', objectId: id, after: { type: f.type, title: f.title, status, visible } });
  return c.json({ ok: true, id }, 201);
});

/** Modification par l'agence. Un livrable déjà publié dont le lien ou le contenu change passe en version suivante, « mis à jour ». */
clients.patch('/:clientId/deliverables/:deliverableId', async (c) => {
  requireAgency(c);
  const client = c.get('client');
  const user = c.get('user');
  const d = await first<DeliverableRow>(c.env.DB, 'SELECT * FROM deliverables WHERE id = ?1 AND client_id = ?2', c.req.param('deliverableId'), client.id);
  if (!d) throw notFound();
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Corps de requête invalide.');
  const f = readDeliverableFields(body, true);
  const changed = Object.keys(f).filter((k) => (d as unknown as Record<string, unknown>)[k] !== f[k]);
  if (!changed.length) return c.json({ ok: true, changed: [] });
  const visibleAfter = 'visible_client' in f ? f.visible_client === 1 : Boolean(d.visible_client);
  const statusAfter = (f.status as string | undefined) ?? d.status;
  if (visibleAfter && statusAfter === 'brouillon') throw new HttpError(400, 'Un livrable visible ne peut pas rester en brouillon.');
  const contentChanged = changed.includes('content_md') || changed.includes('external_url');
  if (d.visible_client && contentChanged) {
    f.version = d.version + 1;
    if (!('status' in f)) f.status = 'mis_a_jour';
  }
  if (visibleAfter && !d.visible_client) f.published_at = nowIso();
  const cols = Object.keys(f);
  const now = nowIso();
  await run(c.env.DB, `UPDATE deliverables SET ${cols.map((k, i) => `${k} = ?${i + 1}`).join(', ')}, updated_at = ?${cols.length + 1} WHERE id = ?${cols.length + 2} AND client_id = ?${cols.length + 3}`,
    ...cols.map((k) => f[k]), now, d.id, client.id);
  await audit(c.env.DB, {
    clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'livrable_modification', objectType: 'deliverable', objectId: d.id,
    before: Object.fromEntries(changed.filter((k) => k !== 'content_md').map((k) => [k, (d as unknown as Record<string, unknown>)[k]])),
    after: Object.fromEntries(cols.filter((k) => k !== 'content_md').map((k) => [k, f[k]])),
  });
  return c.json({ ok: true, changed: cols });
});

clients.delete('/:clientId/deliverables/:deliverableId', async (c) => {
  requireAgency(c);
  const client = c.get('client');
  const user = c.get('user');
  const d = await first<DeliverableRow>(c.env.DB, 'SELECT * FROM deliverables WHERE id = ?1 AND client_id = ?2', c.req.param('deliverableId'), client.id);
  if (!d) throw notFound();
  await run(c.env.DB, 'DELETE FROM deliverables WHERE id = ?1 AND client_id = ?2', d.id, client.id);
  await audit(c.env.DB, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'livrable_suppression', objectType: 'deliverable', objectId: d.id, before: { type: d.type, title: d.title, status: d.status } });
  return c.json({ ok: true });
});

/** Le client commente un livrable publié ; l'agence lit et répond (vue agence). */
async function commentableDeliverable(c: { env: { DB: D1Database }; req: { param: (k: string) => string }; get: (k: 'client' | 'view') => unknown }) {
  const client = c.get('client') as { id: string };
  const d = await first<DeliverableRow>(c.env.DB, 'SELECT * FROM deliverables WHERE id = ?1 AND client_id = ?2', c.req.param('deliverableId'), client.id);
  if (!d) throw notFound();
  if (c.get('view') === 'client' && !(d.visible_client && d.status !== 'brouillon' && d.status !== 'en_preparation')) throw notFound();
  return d;
}

clients.get('/:clientId/deliverables/:deliverableId/comments', async (c) => {
  const d = await commentableDeliverable(c);
  const rows = await all<{ id: string; body: string; created_at: string; author_role: string; author_user_id: string | null; display_name: string | null; email: string | null; handled_at: string | null }>(c.env.DB,
    `SELECT k.id, k.body, k.created_at, k.author_role, k.author_user_id, k.handled_at, u.display_name, u.email FROM deliverable_comments k
     LEFT JOIN users u ON u.id = k.author_user_id WHERE k.deliverable_id = ?1 AND k.client_id = ?2 ORDER BY k.created_at`, d.id, (c.get('client') as { id: string }).id);
  const me = c.get('user');
  return c.json({ comments: rows.map((r) => ({
    id: r.id, body: r.body, createdAt: r.created_at, authorRole: r.author_role,
    author: r.author_role === 'agence' ? 'Obsidian Partners' : r.display_name || r.email?.split('@')[0] || 'Client',
    mine: r.author_user_id === me.id,
    ...(c.get('view') === 'agence' && r.author_role === 'client' ? { pending: !r.handled_at } : {}),
  })) });
});

clients.post('/:clientId/deliverables/:deliverableId/comments', async (c) => {
  const user = c.get('user');
  if (user.role === 'agence') requireAgency(c);
  const d = await commentableDeliverable(c);
  const client = c.get('client');
  const body = await c.req.json<{ body?: string }>().catch(() => ({} as { body?: string }));
  const text = (body.body ?? '').trim();
  if (!text) throw new HttpError(400, 'Commentaire vide.');
  if (text.length > 4000) throw new HttpError(400, 'Commentaire trop long (4 000 caractères au plus).');
  const id = newId('cmt');
  await run(c.env.DB, 'INSERT INTO deliverable_comments (id, client_id, deliverable_id, author_user_id, author_role, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
    id, client.id, d.id, user.id, user.role === 'agence' ? 'agence' : 'client', text);
  // Une réponse de l'agence traite les demandes du client sur ce livrable (décision 0022).
  if (user.role === 'agence') {
    await run(c.env.DB, `UPDATE deliverable_comments SET handled_at = ?1 WHERE deliverable_id = ?2 AND author_role = 'client' AND handled_at IS NULL`, nowIso(), d.id);
  }
  await audit(c.env.DB, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'livrable_commentaire', objectType: 'deliverable', objectId: d.id });
  return c.json({ ok: true, id }, 201);
});

clients.delete('/:clientId/deliverables/:deliverableId/comments/:commentId', async (c) => {
  const user = c.get('user');
  if (user.role === 'agence') requireAgency(c);
  const d = await commentableDeliverable(c);
  const k = await first<{ id: string; author_user_id: string | null }>(c.env.DB, 'SELECT id, author_user_id FROM deliverable_comments WHERE id = ?1 AND deliverable_id = ?2', c.req.param('commentId'), d.id);
  if (!k) throw notFound();
  if (user.role === 'client' && k.author_user_id !== user.id) throw forbidden('Vous ne pouvez supprimer que vos propres commentaires.');
  await run(c.env.DB, 'DELETE FROM deliverable_comments WHERE id = ?1', k.id);
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
  const rows = await all<{ id: string; title: string; kind: string; url: string | null; r2_key: string | null; body_md: string | null; published: number; client_id: string | null; read_at: string | null }>(
    c.env.DB,
    `SELECT g.id, g.title, g.kind, g.url, g.r2_key, g.body_md, g.published, g.client_id, r.read_at
     FROM guides g LEFT JOIN guide_reads r ON r.guide_id = g.id AND r.client_id = ?1
     WHERE (g.client_id IS NULL OR g.client_id = ?1) ${filter}
     ORDER BY g.client_id IS NULL, g.sort_order`, client.id);
  return c.json({
    guides: rows.map((g) => ({
      id: g.id, title: g.title, kind: g.kind, url: g.url, hasFile: Boolean(g.r2_key), hasBody: Boolean(g.body_md),
      pinned: g.client_id !== null, readAt: g.read_at, ...(view === 'agence' ? { published: Boolean(g.published) } : {}),
    })),
  });
});

/** Lecture d'un guide (page). Le client ne lit que les guides publiés, communs ou épinglés pour lui ; sa lecture est notée. */
clients.get('/:clientId/guides/:guideId', async (c) => {
  const client = c.get('client');
  const view = c.get('view');
  const g = await first<{ id: string; client_id: string | null; title: string; kind: string; url: string | null; body_md: string | null; r2_key: string | null; published: number; updated_at: string }>(c.env.DB,
    'SELECT id, client_id, title, kind, url, body_md, r2_key, published, updated_at FROM guides WHERE id = ?1 AND (client_id IS NULL OR client_id = ?2)', c.req.param('guideId'), client.id);
  if (!g || (view === 'client' && !g.published)) throw notFound();
  if (c.get('user').role === 'client') {
    await run(c.env.DB, `INSERT INTO guide_reads (client_id, guide_id, read_at) VALUES (?1, ?2, ?3) ON CONFLICT (client_id, guide_id) DO NOTHING`, client.id, g.id, nowIso());
  }
  return c.json({ guide: { id: g.id, title: g.title, kind: g.kind, url: g.url, bodyMd: g.body_md, hasFile: Boolean(g.r2_key), updatedAt: g.updated_at, pinned: g.client_id !== null,
    ...(view === 'agence' ? { published: Boolean(g.published) } : {}) } });
});

/** PDF d'un guide (R2), mêmes règles d'accès que la lecture du guide. */
clients.get('/:clientId/guides/:guideId/file', async (c) => {
  const client = c.get('client');
  const g = await first<{ id: string; r2_key: string | null; published: number }>(c.env.DB,
    'SELECT id, r2_key, published FROM guides WHERE id = ?1 AND (client_id IS NULL OR client_id = ?2)', c.req.param('guideId'), client.id);
  if (!g || !g.r2_key || (c.get('view') === 'client' && !g.published)) throw notFound();
  if (!c.env.FILES) throw new HttpError(503, 'Stockage de fichiers non activé.');
  const obj = await c.env.FILES.get(g.r2_key);
  if (!obj) throw notFound();
  if (c.get('user').role === 'client') {
    await run(c.env.DB, `INSERT INTO guide_reads (client_id, guide_id, read_at) VALUES (?1, ?2, ?3) ON CONFLICT (client_id, guide_id) DO NOTHING`, client.id, g.id, nowIso());
  }
  return new Response(obj.body, { headers: {
    'content-type': 'application/pdf', 'content-disposition': obj.httpMetadata?.contentDisposition ?? 'inline',
    'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
  } });
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
  if (phases.length === 0) return null; // aucune chaîne de production suivie pour ce client : pas de bandeau vide
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
    // Seuls les liens Google Drive sont servis.
    driveFolderUrl: c.drive_folder_url && /^https:\/\/drive\.google\.com\//.test(c.drive_folder_url) ? c.drive_folder_url : null,
  };
  if (view === 'client') return base;
  return {
    ...base, thresholds: clientThresholds(c.thresholds_json, c.unit_economics_json), unitEconomics: safeJson(c.unit_economics_json),
    autoPublishRecos: Boolean(c.auto_publish_recos), onboardingLocked: Boolean(c.onboarding_locked),
  };
}

function parseList(json: string | undefined): string[] {
  try { const v = JSON.parse(json ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
function parseRange(from: string | undefined, to: string | undefined) {
  if (!from || !to || !YMD.test(from) || !YMD.test(to)) return null;
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || from > to) throw new HttpError(400, 'Période invalide.');
  const r = rangeBounds(from, to);
  if (r.days > 731) throw new HttpError(400, 'Période trop longue (2 ans maximum).');
  return r;
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
