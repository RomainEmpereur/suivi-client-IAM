import { Hono } from 'hono';
import { addDaysYmd, bucketStart, delta, derived, todayParis, type Totals } from '@obsidian/domain';
import type { AppEnv } from '../env.ts';
import { requireAgency } from '../auth.ts';
import { scopeClient } from '../scope.ts';
import { all, audit, first, newId, nowIso } from '../db.ts';
import { HttpError, forbidden, notFound } from '../errors.ts';
import { clientTotals, lastSuccessfulSync } from '../metrics.ts';
import { safeJson } from '../serialize.ts';

/**
 * Rapport de période (§11) : tableau période / période précédente, analyse de l'agence, impression PDF.
 * Figé à la génération (snapshot_json). L'agence le prépare en interne puis le publie (sent_at = date de publication,
 * aucun email n'est envoyé) ; le client ne voit que les rapports publiés.
 *
 * Feedback (§11) : le client envoie un retour ; le contexte (chiffres 7 jours, connexions, dernières recommandations)
 * est joint automatiquement ; l'agence répond et suit le statut.
 */
export const reports = new Hono<AppEnv>();
reports.use('/:clientId/reports', scopeClient);
reports.use('/:clientId/reports/*', scopeClient);
reports.use('/:clientId/feedback', scopeClient);
reports.use('/:clientId/feedback/*', scopeClient);

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export const REPORT_ROWS: { key: keyof Totals; label: string; money?: boolean }[] = [
  { key: 'spend_cents', label: 'Dépense publicitaire', money: true },
  { key: 'link_clicks', label: 'Clics' },
  { key: 'leads', label: 'Leads' },
  { key: 'crm_contacts', label: 'Nouveaux contacts' },
  { key: 'appointments_booked', label: 'Rendez-vous pris' },
  { key: 'appointments_held', label: 'Rendez-vous honorés' },
  { key: 'sales', label: 'Ventes' },
  { key: 'cash_collected_cents', label: 'Encaissé', money: true },
];

/** Bornes d'une semaine (lundi → dimanche) ou d'un mois, et de la période précédente. */
export function reportBounds(type: 'semaine' | 'mois', anyDay: string) {
  if (type === 'semaine') {
    const start = bucketStart(anyDay, 'week');
    return { start, end: addDaysYmd(start, 6), prevStart: addDaysYmd(start, -7), prevEnd: addDaysYmd(start, -1) };
  }
  const start = `${anyDay.slice(0, 7)}-01`;
  const next = new Date(`${start}T12:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
  const end = addDaysYmd(next.toISOString().slice(0, 10), -1);
  const prev = new Date(`${start}T12:00:00Z`); prev.setUTCMonth(prev.getUTCMonth() - 1);
  return { start, end, prevStart: prev.toISOString().slice(0, 10), prevEnd: addDaysYmd(start, -1) };
}

interface ReportRow { id: string; client_id: string; period_type: string; period_start: string; period_end: string; agency_comment: string | null; snapshot_json: string; sent_at: string | null; created_at: string; updated_at: string }

function serializeReport(r: ReportRow, view: 'agence' | 'client') {
  return {
    id: r.id, periodType: r.period_type, from: r.period_start, to: r.period_end, comment: r.agency_comment,
    snapshot: safeJson(r.snapshot_json), createdAt: r.created_at,
    ...(view === 'agence' ? { published: Boolean(r.sent_at), publishedAt: r.sent_at, updatedAt: r.updated_at } : { publishedAt: r.sent_at }),
  };
}

reports.get('/:clientId/reports', async (c) => {
  const view = c.get('view');
  const filter = view === 'client' ? 'AND sent_at IS NOT NULL' : '';
  const rows = await all<ReportRow>(c.env.DB, `SELECT * FROM reports WHERE client_id = ?1 ${filter} ORDER BY period_start DESC, period_type LIMIT 60`, c.get('client').id);
  return c.json({ reports: rows.map((r) => serializeReport(r, view)) });
});

/** Générer un rapport (agence) : instantané figé des chiffres + analyse pré-remplie depuis les recommandations de la période. */
reports.post('/:clientId/reports', async (c) => {
  requireAgency(c);
  const db = c.env.DB;
  const client = c.get('client');
  const user = c.get('user');
  const b = await c.req.json<{ periodType?: string; day?: string }>().catch(() => ({} as Record<string, never>));
  if (b.periodType !== 'semaine' && b.periodType !== 'mois') throw new HttpError(400, 'Type de période invalide (semaine ou mois).');
  if (!b.day || !YMD.test(b.day)) throw new HttpError(400, 'Date invalide.');
  const p = reportBounds(b.periodType, b.day);
  const yesterday = addDaysYmd(todayParis(), -1);
  if (p.start > yesterday) throw new HttpError(400, 'Cette période n’a pas encore commencé.');
  const existing = await first<{ id: string }>(db, 'SELECT id FROM reports WHERE client_id = ?1 AND period_type = ?2 AND period_start = ?3', client.id, b.periodType, p.start);
  if (existing) throw new HttpError(409, 'Un rapport existe déjà pour cette période.');
  const to = p.end > yesterday ? yesterday : p.end; // période en cours : arrêtée à hier, et le rapport le dit
  const [cur, prev, sync, recos, summaries] = await Promise.all([
    clientTotals(db, client.id, p.start, to),
    clientTotals(db, client.id, p.prevStart, p.prevEnd),
    lastSuccessfulSync(db, client.id),
    all<{ title: string; client_title: string | null; severity: string; state: string }>(db,
      `SELECT title, client_title, severity, state FROM recommendations WHERE client_id = ?1 AND date BETWEEN ?2 AND ?3 AND state != 'ignoree'
       ORDER BY CASE severity WHEN 'corriger' THEN 0 WHEN 'surveiller' THEN 1 ELSE 2 END`, client.id, p.start, addDaysYmd(to, 7)),
    all<{ client_summary_md: string | null }>(db,
      `SELECT client_summary_md FROM analyses WHERE client_id = ?1 AND status = 'terminee' AND period_to >= ?2 AND period_from <= ?3 ORDER BY completed_at DESC LIMIT 1`,
      client.id, p.start, to),
  ]);
  const unmeasured = new Set((safeJson(client.unmeasured_json ?? '[]') as string[] | null) ?? []);
  const rows = REPORT_ROWS.map((r) => {
    const um = unmeasured.has(r.key);
    const current = um || !cur ? null : cur[r.key];
    const previous = um || !prev ? null : prev[r.key];
    return { key: r.key, label: r.label, money: Boolean(r.money), current, previous, delta: delta(current, previous),
      reason: um ? 'Non synchronisé pour ce client' : !cur ? 'Aucune donnée sur la période' : null };
  });
  const dcur = cur ? derived(cur) : null;
  const snapshot = {
    client: { name: client.name, currency: client.ad_account_currency },
    period: { type: b.periodType, from: p.start, to, fullTo: p.end, partial: to < p.end, previousFrom: p.prevStart, previousTo: p.prevEnd },
    rows,
    ratios: dcur && { cost_per_booked_cents: unmeasured.has('appointments_booked') ? null : dcur.cost_per_booked_cents, cost_per_lead_cents: dcur.cost_per_lead_cents },
    lastSync: sync, generatedAt: nowIso(),
  };
  const lines: string[] = [];
  if (summaries[0]?.client_summary_md) lines.push(summaries[0].client_summary_md.trim(), '');
  if (recos.length) {
    lines.push('Prochaines actions :');
    for (const r of recos.slice(0, 6)) lines.push(`- ${r.client_title ?? r.title}${r.state === 'traitee' ? ' (fait)' : ''}`);
  }
  const id = newId('rp');
  await db.prepare(`INSERT INTO reports (id, client_id, period_type, period_start, period_end, agency_comment, snapshot_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
    .bind(id, client.id, b.periodType, p.start, p.end, lines.join('\n').trim() || null, JSON.stringify(snapshot)).run();
  await audit(db, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'rapport_genere', objectType: 'report', objectId: id, after: { type: b.periodType, from: p.start } });
  return c.json({ id }, 201);
});

reports.patch('/:clientId/reports/:reportId', async (c) => {
  requireAgency(c);
  const db = c.env.DB;
  const client = c.get('client');
  const user = c.get('user');
  const r = await first<ReportRow>(db, 'SELECT * FROM reports WHERE id = ?1 AND client_id = ?2', c.req.param('reportId'), client.id);
  if (!r) throw notFound();
  const b = await c.req.json<{ comment?: string | null; publish?: boolean; unpublish?: boolean }>().catch(() => ({} as Record<string, never>));
  const now = nowIso();
  if ('comment' in b) {
    if (b.comment !== null && (typeof b.comment !== 'string' || b.comment.length > 10000)) throw new HttpError(400, 'Analyse trop longue.');
    await db.prepare('UPDATE reports SET agency_comment = ?1, updated_at = ?2 WHERE id = ?3').bind(b.comment?.trim() || null, now, r.id).run();
  }
  if (b.publish) await db.prepare('UPDATE reports SET sent_at = ?1, updated_at = ?1 WHERE id = ?2').bind(now, r.id).run();
  if (b.unpublish) await db.prepare('UPDATE reports SET sent_at = NULL, updated_at = ?1 WHERE id = ?2').bind(now, r.id).run();
  await audit(db, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: b.publish ? 'rapport_publie' : b.unpublish ? 'rapport_retire' : 'rapport_modifie', objectType: 'report', objectId: r.id });
  return c.json({ ok: true });
});

/** Supprimer un rapport non publié (pour le régénérer). */
reports.delete('/:clientId/reports/:reportId', async (c) => {
  requireAgency(c);
  const client = c.get('client');
  const user = c.get('user');
  const r = await first<ReportRow>(c.env.DB, 'SELECT * FROM reports WHERE id = ?1 AND client_id = ?2', c.req.param('reportId'), client.id);
  if (!r) throw notFound();
  if (r.sent_at) throw new HttpError(409, 'Rapport publié : retirez-le de l’espace client avant de le supprimer.');
  await c.env.DB.prepare('DELETE FROM reports WHERE id = ?1').bind(r.id).run();
  await audit(c.env.DB, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'rapport_supprime', objectType: 'report', objectId: r.id });
  return c.json({ ok: true });
});

// ─── Feedback ────────────────────────────────────────────────────────────────

const CATEGORIES = ['bug', 'resultat', 'demande', 'question'];
const SEVERITIES = ['faible', 'normale', 'haute'];
const STATUSES = ['nouveau', 'vu', 'en_cours', 'resolu'];

interface FeedbackRow {
  id: string; client_id: string; author_user_id: string | null; category: string; severity: string; body: string; attachments_json: string;
  context_json: string | null; status: string; agency_reply: string | null; replied_at: string | null; created_at: string; updated_at: string;
}

function serializeFeedback(f: FeedbackRow, view: 'agence' | 'client') {
  return {
    id: f.id, category: f.category, severity: f.severity, body: f.body, attachments: safeJson(f.attachments_json) ?? [],
    status: f.status, reply: f.agency_reply, repliedAt: f.replied_at, createdAt: f.created_at,
    ...(view === 'agence' ? { context: safeJson(f.context_json) } : {}),
  };
}

reports.get('/:clientId/feedback', async (c) => {
  const rows = await all<FeedbackRow>(c.env.DB, `SELECT * FROM feedback WHERE client_id = ?1 ORDER BY (status = 'resolu'), created_at DESC LIMIT 100`, c.get('client').id);
  return c.json({ feedback: rows.map((f) => serializeFeedback(f, c.get('view'))) });
});

/** Le client envoie un retour ; le contexte est joint automatiquement pour l'agence. */
reports.post('/:clientId/feedback', async (c) => {
  const user = c.get('user');
  if (user.role !== 'client') throw forbidden('Les retours sont envoyés par le client.');
  const db = c.env.DB;
  const client = c.get('client');
  const b = await c.req.json<{ category?: string; severity?: string; body?: string; links?: string[] }>().catch(() => ({} as Record<string, never>));
  if (!CATEGORIES.includes(b.category ?? '')) throw new HttpError(400, 'Catégorie invalide.');
  const severity = b.severity ?? 'normale';
  if (!SEVERITIES.includes(severity)) throw new HttpError(400, 'Gravité invalide.');
  const body = (b.body ?? '').trim();
  if (body.length < 5 || body.length > 5000) throw new HttpError(400, 'Décrivez le retour (5 à 5 000 caractères).');
  const links = (Array.isArray(b.links) ? b.links : []).map((l) => String(l).trim()).filter(Boolean);
  if (links.length > 5 || links.some((l) => { try { return new URL(l).protocol !== 'https:'; } catch { return true; } })) throw new HttpError(400, 'Liens invalides (5 au plus, en https).');

  const to = addDaysYmd(todayParis(), -1), from = addDaysYmd(to, -6);
  const [t7, conns, recos] = await Promise.all([
    clientTotals(db, client.id, from, to),
    all<{ type: string; state: string; error_message: string | null }>(db, 'SELECT type, state, error_message FROM connections WHERE client_id = ?1', client.id),
    all<{ date: string; title: string; severity: string; state: string }>(db, 'SELECT date, title, severity, state FROM recommendations WHERE client_id = ?1 ORDER BY created_at DESC LIMIT 5', client.id),
  ]);
  const context = {
    period: { from, to }, totals: t7, derived: t7 ? derived(t7) : null,
    unmeasured: safeJson(client.unmeasured_json ?? '[]'), connections: conns, recommendations: recos, capturedAt: nowIso(),
  };
  const id = newId('fb');
  await db.prepare(`INSERT INTO feedback (id, client_id, author_user_id, category, severity, body, attachments_json, context_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
    .bind(id, client.id, user.id, b.category, severity, body, JSON.stringify(links.map((url) => ({ url }))), JSON.stringify(context)).run();
  await audit(db, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'retour_envoye', objectType: 'feedback', objectId: id, after: { category: b.category, severity } });
  return c.json({ id }, 201);
});

/** Réponse et statut (agence). */
reports.patch('/:clientId/feedback/:feedbackId', async (c) => {
  requireAgency(c);
  const db = c.env.DB;
  const client = c.get('client');
  const user = c.get('user');
  const f = await first<FeedbackRow>(db, 'SELECT * FROM feedback WHERE id = ?1 AND client_id = ?2', c.req.param('feedbackId'), client.id);
  if (!f) throw notFound();
  const b = await c.req.json<{ status?: string; reply?: string | null }>().catch(() => ({} as Record<string, never>));
  const now = nowIso();
  let status = f.status, reply = f.agency_reply, repliedAt = f.replied_at;
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) throw new HttpError(400, 'Statut invalide.');
    status = b.status;
  }
  if ('reply' in b) {
    if (b.reply !== null && (typeof b.reply !== 'string' || b.reply.length > 5000)) throw new HttpError(400, 'Réponse invalide.');
    reply = b.reply?.trim() || null;
    repliedAt = reply ? now : null;
    if (reply && status === 'nouveau') status = 'en_cours';
  }
  await db.prepare('UPDATE feedback SET status = ?1, agency_reply = ?2, replied_at = ?3, updated_at = ?4 WHERE id = ?5').bind(status, reply, repliedAt, now, f.id).run();
  await audit(db, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'retour_traite', objectType: 'feedback', objectId: f.id, before: { status: f.status }, after: { status, replied: Boolean(reply) } });
  return c.json({ ok: true, status });
});
