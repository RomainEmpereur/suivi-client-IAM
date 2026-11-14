import { Hono } from 'hono';
import type { AppEnv } from '../env.ts';
import { requireAgency } from '../auth.ts';
import { all, audit, first, newId, nowIso } from '../db.ts';
import { HttpError, notFound } from '../errors.ts';

/** Liste de tâches de l'agence (décision 0030). Vue agence uniquement. */
export const tasks = new Hono<AppEnv>();
tasks.use('/taches', async (c, next) => { requireAgency(c); await next(); });
tasks.use('/taches/*', async (c, next) => { requireAgency(c); await next(); });

interface TaskRow {
  id: string; client_id: string | null; client_name: string | null; title: string; description: string | null; due_date: string | null;
  status: 'a_faire' | 'fait'; done_at: string | null; created_at: string; updated_at: string;
}
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) || null : null);
const todayParis = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
function dueDate(v: unknown): string | null {
  const s = str(v, 10);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new HttpError(400, 'Échéance invalide (AAAA-MM-JJ).');
  return s;
}
const serialize = (t: TaskRow, today: string) => ({
  id: t.id, clientId: t.client_id, clientName: t.client_name, title: t.title, description: t.description, dueDate: t.due_date,
  status: t.status, doneAt: t.done_at, createdAt: t.created_at, updatedAt: t.updated_at,
  overdue: t.status === 'a_faire' && t.due_date !== null && t.due_date < today,
  dueToday: t.status === 'a_faire' && t.due_date === today,
});

/** Tâches ouvertes triées par échéance (en retard d'abord, sans échéance à la fin) ; les faites, les plus récentes d'abord. */
tasks.get('/taches', async (c) => {
  const clientId = c.req.query('clientId');
  const where = clientId === 'agence' ? 'WHERE t.client_id IS NULL' : clientId ? 'WHERE t.client_id = ?1' : '';
  const rows = await all<TaskRow>(c.env.DB,
    `SELECT t.*, cl.name AS client_name FROM agency_tasks t LEFT JOIN clients cl ON cl.id = t.client_id ${where}
     ORDER BY t.status = 'fait', CASE WHEN t.status = 'fait' THEN '' ELSE COALESCE(t.due_date, '9999-12-31') END, t.done_at DESC, t.created_at`,
    ...(clientId && clientId !== 'agence' ? [clientId] : []));
  const today = todayParis();
  const items = rows.map((r) => serialize(r, today));
  const open = items.filter((t) => t.status === 'a_faire');
  return c.json({
    today, items,
    counts: { open: open.length, overdue: open.filter((t) => t.overdue).length, today: open.filter((t) => t.dueToday).length },
  });
});

/** Compteur pour le menu : tâches en retard ou à faire aujourd'hui. */
tasks.get('/taches/compteur', async (c) => {
  const r = await first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM agency_tasks WHERE status = 'a_faire' AND due_date IS NOT NULL AND due_date <= ?1`, todayParis());
  return c.json({ urgent: r?.n ?? 0 });
});

async function checkClient(db: D1Database, v: unknown): Promise<string | null> {
  if (v === null || v === undefined || v === '' || v === 'agence') return null;
  const id = String(v);
  if (!(await first(db, 'SELECT id FROM clients WHERE id = ?1', id))) throw new HttpError(400, 'Client inconnu.');
  return id;
}

tasks.post('/taches', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const b = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const title = str(b?.title, 200);
  if (!title) throw new HttpError(400, 'Titre requis.');
  const id = newId('tk');
  const clientId = await checkClient(db, b?.clientId);
  await db.prepare(`INSERT INTO agency_tasks (id, client_id, title, description, due_date, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
    .bind(id, clientId, title, str(b?.description, 5000), dueDate(b?.dueDate), user.email).run();
  await audit(db, { clientId, actorId: user.id, actorEmail: user.email, action: 'tache_creation', objectType: 'tache', objectId: id, after: { title } });
  return c.json({ ok: true, id }, 201);
});

tasks.patch('/taches/:id', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const cur = await first<TaskRow>(db, 'SELECT *, NULL AS client_name FROM agency_tasks WHERE id = ?1', c.req.param('id'));
  if (!cur) throw notFound();
  const b = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') throw new HttpError(400, 'Corps de requête invalide.');
  const set: Record<string, unknown> = {};
  if ('title' in b) { const t = str(b.title, 200); if (!t) throw new HttpError(400, 'Titre requis.'); set.title = t; }
  if ('description' in b) set.description = str(b.description, 5000);
  if ('dueDate' in b) set.due_date = dueDate(b.dueDate);
  if ('clientId' in b) set.client_id = await checkClient(db, b.clientId);
  if ('status' in b) {
    if (b.status !== 'a_faire' && b.status !== 'fait') throw new HttpError(400, 'Statut invalide.');
    set.status = b.status;
    set.done_at = b.status === 'fait' ? (cur.status === 'fait' ? cur.done_at : nowIso()) : null;
  }
  const keys = Object.keys(set);
  if (!keys.length) throw new HttpError(400, 'Rien à modifier.');
  await db.prepare(`UPDATE agency_tasks SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(', ')}, updated_at = ?${keys.length + 1} WHERE id = ?${keys.length + 2}`)
    .bind(...keys.map((k) => set[k]), nowIso(), cur.id).run();
  await audit(db, { clientId: (set.client_id as string | null | undefined) ?? cur.client_id, actorId: user.id, actorEmail: user.email, action: 'tache_modification', objectType: 'tache', objectId: cur.id, after: set });
  return c.json({ ok: true });
});

tasks.delete('/taches/:id', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const cur = await first<{ id: string; client_id: string | null; title: string }>(db, 'SELECT id, client_id, title FROM agency_tasks WHERE id = ?1', c.req.param('id'));
  if (!cur) throw notFound();
  await db.prepare('DELETE FROM agency_tasks WHERE id = ?1').bind(cur.id).run();
  await audit(db, { clientId: cur.client_id, actorId: user.id, actorEmail: user.email, action: 'tache_suppression', objectType: 'tache', objectId: cur.id, before: { title: cur.title } });
  return c.json({ ok: true });
});
