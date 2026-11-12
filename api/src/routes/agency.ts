import { Hono } from 'hono';
import { computeAppointmentCounter, safeDiv, type AppointmentLike } from '@obsidian/domain';
import type { AppEnv, ClientRow } from '../env.ts';
import { requireAgency } from '../auth.ts';
import { all, audit, first, newId, nowIso } from '../db.ts';
import { HttpError, notFound } from '../errors.ts';
import { clientTotals, periodBounds } from '../metrics.ts';
import { currentPhaseProgress, overdueClientTasks } from './clients.ts';

export const agency = new Hono<AppEnv>();
agency.use('*', async (c, next) => { requireAgency(c); await next(); });

/** Console multi-clients (§12) : une ligne par client, triée par ce qui demande une action. */
agency.get('/console', async (c) => {
  const db = c.env.DB;
  const demoFilter = c.env.ENVIRONMENT === 'production' ? 'WHERE is_demo = 0' : '';
  const list = await all<ClientRow>(db, `SELECT * FROM clients ${demoFilter} ORDER BY name`);
  const p7 = periodBounds(7);
  const p30 = periodBounds(30);
  const today = new Date();

  const rows = await Promise.all(list.map(async (cl) => {
    const [t7, t30, appts, conns, recos, fb, overdue, phase] = await Promise.all([
      clientTotals(db, cl.id, p7.from, p7.to),
      clientTotals(db, cl.id, p30.from, p30.to),
      all<AppointmentLike>(db, 'SELECT scheduled_at, status, counts_toward_target FROM appointments WHERE client_id = ?1', cl.id),
      all<{ type: string; state: string }>(db, 'SELECT type, state FROM connections WHERE client_id = ?1', cl.id),
      all<{ n: number }>(db, `SELECT COUNT(*) AS n FROM recommendations WHERE client_id = ?1 AND state = 'ouverte'`, cl.id),
      all<{ n: number }>(db, `SELECT COUNT(*) AS n FROM feedback WHERE client_id = ?1 AND status != 'resolu'`, cl.id),
      overdueClientTasks(db, cl.id),
      currentPhaseProgress(db, cl.id),
    ]);
    const reopened = await all<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM onboarding_reopenings WHERE client_id = ?1 AND closed_at IS NULL', cl.id);
    const counter = computeAppointmentCounter(cl, appts, today);
    const broken = conns.filter((x) => x.state === 'casse').map((x) => x.type);
    const spend7 = t7?.spend_cents ?? null;
    const booked7 = t7?.appointments_booked ?? null;
    const daysSinceStart = cl.start_date ? Math.floor((today.getTime() - Date.parse(`${cl.start_date}T00:00:00Z`)) / 86_400_000) : null;
    const blockingLate = overdue.some((t) => t.blocking && Date.parse(`${t.due_date}T00:00:00Z`) < today.getTime() - 5 * 86_400_000);
    const redReasons: string[] = [];
    if (broken.length) redReasons.push('Connexion cassée');
    if (spend7 && spend7 > 0 && booked7 === 0) redReasons.push('Aucun rendez-vous depuis 7 jours, dépense en cours');
    if (blockingLate) redReasons.push('Tâche client bloquante en retard de plus de 5 jours');
    return {
      id: cl.id, name: cl.name, offer: cl.offer, status: cl.status, isDemo: Boolean(cl.is_demo),
      phase: cl.campaigns_launched_at ? 'Campagnes lancées' : phase?.label ?? null,
      daysSinceStart,
      counter: counter.started || cl.campaigns_launched_at ? { validated: counter.validated, target: counter.target, onPace: counter.onPace, daysRemaining: counter.daysRemaining } : null,
      spend7_cents: spend7,
      costPerBooked7_cents: t7 ? safeDiv(t7.spend_cents, t7.appointments_booked) : null,
      spend30_cents: t30?.spend_cents ?? null,
      booked30: t30?.appointments_booked ?? null,
      connections: conns,
      openRecos: recos[0]?.n ?? 0,
      openFeedback: fb[0]?.n ?? 0,
      overdueClientTasks: overdue.length,
      onboarding: cl.onboarding_submitted_at
        ? (reopened[0]?.n ? 'complement_demande' : 'envoye')
        : 'a_remplir',
      onboardingSubmittedAt: cl.onboarding_submitted_at ?? null,
      red: redReasons.length > 0,
      redReasons,
    };
  }));

  rows.sort((a, b) => Number(b.red) - Number(a.red)
    || (b.openFeedback + b.overdueClientTasks + b.openRecos) - (a.openFeedback + a.overdueClientTasks + a.openRecos));

  // Retours récurrents (§11) : thèmes des 7 derniers jours et retours encore ouverts, tous clients confondus.
  const ids = list.map((x) => x.id);
  const themes = ids.length ? await all<{ category: string; recent: number; open: number; clients: string }>(db,
    `SELECT f.category, SUM(f.created_at >= ?1) AS recent, SUM(f.status != 'resolu') AS open, GROUP_CONCAT(DISTINCT c.name) AS clients
     FROM feedback f JOIN clients c ON c.id = f.client_id WHERE f.client_id IN (${ids.map((_, i) => `?${i + 2}`).join(',')})
     GROUP BY f.category ORDER BY recent DESC, open DESC`, new Date(Date.now() - 7 * 86_400_000).toISOString(), ...ids) : [];
  const spend30 = rows.reduce((s, r) => s + (r.spend30_cents ?? 0), 0);
  const booked30 = rows.reduce((s, r) => s + (r.booked30 ?? 0), 0);
  return c.json({
    summary: {
      spend30_cents: rows.some((r) => r.spend30_cents !== null) ? spend30 : null,
      avgCostPerBooked30_cents: safeDiv(spend30, booked30),
      clientsBehindPace: rows.filter((r) => r.counter && !r.counter.onPace).length,
    },
    rows,
    feedbackThemes: themes.filter((t) => t.recent > 0 || t.open > 0).map((t) => ({ category: t.category, recent: t.recent, open: t.open, clients: (t.clients ?? '').split(',').filter(Boolean) })),
  });
});

// ─── Guides (§11, §12 Édition) : communs ou épinglés pour un client ; brouillon / publié ─────

interface GuideRow { id: string; client_id: string | null; title: string; kind: string; url: string | null; body_md: string | null; sort_order: number; published: number; updated_at: string }
const serializeGuideAgency = (g: GuideRow) => ({
  id: g.id, clientId: g.client_id, title: g.title, kind: g.kind, url: g.url, bodyMd: g.body_md, sortOrder: g.sort_order,
  published: Boolean(g.published), updatedAt: g.updated_at,
});

agency.get('/guides', async (c) => {
  const rows = await all<GuideRow>(c.env.DB, 'SELECT * FROM guides ORDER BY client_id IS NOT NULL, sort_order, title');
  return c.json({ guides: rows.map(serializeGuideAgency) });
});

function guideInput(b: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || 'title' in b) {
    const t = typeof b.title === 'string' ? b.title.trim() : '';
    if (!t || t.length > 120) throw new HttpError(400, 'Titre requis (120 caractères au plus).');
    out.title = t;
  }
  if ('bodyMd' in b) {
    if (b.bodyMd !== null && (typeof b.bodyMd !== 'string' || b.bodyMd.length > 100_000)) throw new HttpError(400, 'Contenu invalide.');
    out.body_md = (b.bodyMd as string | null)?.trim() || null;
  }
  if ('url' in b) {
    const u = typeof b.url === 'string' ? b.url.trim() : '';
    if (u) { try { if (new URL(u).protocol !== 'https:') throw 0; } catch { throw new HttpError(400, 'Lien invalide (https).'); } }
    out.url = u || null;
  }
  if ('kind' in b) {
    if (!['page', 'pdf', 'video'].includes(b.kind as string)) throw new HttpError(400, 'Type invalide.');
    out.kind = b.kind;
  }
  if ('sortOrder' in b) {
    if (!Number.isInteger(b.sortOrder)) throw new HttpError(400, 'Ordre invalide.');
    out.sort_order = b.sortOrder;
  }
  if ('clientId' in b) out.client_id = b.clientId || null;
  if ('published' in b) out.published = b.published ? 1 : 0;
  return out;
}

agency.post('/guides', async (c) => {
  const user = c.get('user');
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const v = guideInput(b, false);
  if (v.client_id && !(await first(c.env.DB, 'SELECT id FROM clients WHERE id = ?1', v.client_id))) throw new HttpError(400, 'Client inconnu.');
  const id = newId('gd');
  await c.env.DB.prepare('INSERT INTO guides (id, client_id, title, kind, url, body_md, sort_order, published) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)')
    .bind(id, v.client_id ?? null, v.title, v.kind ?? 'page', v.url ?? null, v.body_md ?? null, v.sort_order ?? 100).run();
  await audit(c.env.DB, { clientId: (v.client_id as string) ?? null, actorId: user.id, actorEmail: user.email, action: 'guide_cree', objectType: 'guide', objectId: id, after: { title: v.title } });
  return c.json({ id }, 201);
});

agency.patch('/guides/:id', async (c) => {
  const user = c.get('user');
  const g = await first<GuideRow>(c.env.DB, 'SELECT * FROM guides WHERE id = ?1', c.req.param('id'));
  if (!g) throw notFound();
  const v = guideInput(await c.req.json<Record<string, unknown>>().catch(() => ({})), true);
  if (v.client_id && !(await first(c.env.DB, 'SELECT id FROM clients WHERE id = ?1', v.client_id))) throw new HttpError(400, 'Client inconnu.');
  const keys = Object.keys(v);
  if (!keys.length) throw new HttpError(400, 'Rien à modifier.');
  await c.env.DB.prepare(`UPDATE guides SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(', ')}, updated_at = ?${keys.length + 1} WHERE id = ?${keys.length + 2}`)
    .bind(...keys.map((k) => v[k]), nowIso(), g.id).run();
  await audit(c.env.DB, { clientId: g.client_id, actorId: user.id, actorEmail: user.email, action: 'published' in v ? (v.published ? 'guide_publie' : 'guide_depublie') : 'guide_modifie', objectType: 'guide', objectId: g.id, before: { published: g.published }, after: { keys } });
  return c.json({ ok: true });
});

agency.delete('/guides/:id', async (c) => {
  const user = c.get('user');
  const g = await first<GuideRow>(c.env.DB, 'SELECT * FROM guides WHERE id = ?1', c.req.param('id'));
  if (!g) throw notFound();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE tasks SET guide_id = NULL WHERE guide_id = ?1').bind(g.id),
    c.env.DB.prepare('UPDATE connections SET guide_id = NULL WHERE guide_id = ?1').bind(g.id),
    c.env.DB.prepare('DELETE FROM guides WHERE id = ?1').bind(g.id),
  ]);
  await audit(c.env.DB, { clientId: g.client_id, actorId: user.id, actorEmail: user.email, action: 'guide_supprime', objectType: 'guide', objectId: g.id, before: { title: g.title } });
  return c.json({ ok: true });
});
