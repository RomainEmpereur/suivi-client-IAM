import { Hono } from 'hono';
import type { AppEnv } from '../env.ts';
import { requireAgency } from '../auth.ts';
import { all, audit, first, nowIso, run } from '../db.ts';
import { notFound } from '../errors.ts';

/**
 * Demandes clients (décision 0022) : commentaires des clients sur leurs livrables encore à traiter,
 * et retours (feedback) ouverts. Vue agence uniquement.
 */
export const requests = new Hono<AppEnv>();
requests.use('/demandes', async (c, next) => { requireAgency(c); await next(); });
requests.use('/demandes/*', async (c, next) => { requireAgency(c); await next(); });

interface PendingRow {
  deliverable_id: string; client_id: string; client_name: string; title: string; type: string;
  pending: number; last_at: string; last_body: string; author: string | null;
}

async function pendingComments(db: D1Database, demoFilter: string) {
  return all<PendingRow>(db, `
    SELECT k.deliverable_id, k.client_id, cl.name AS client_name, d.title, d.type,
           COUNT(*) AS pending, MAX(k.created_at) AS last_at,
           (SELECT body FROM deliverable_comments x WHERE x.deliverable_id = k.deliverable_id AND x.author_role = 'client' AND x.handled_at IS NULL ORDER BY x.created_at DESC LIMIT 1) AS last_body,
           (SELECT COALESCE(u.display_name, u.email) FROM deliverable_comments x LEFT JOIN users u ON u.id = x.author_user_id
             WHERE x.deliverable_id = k.deliverable_id AND x.author_role = 'client' AND x.handled_at IS NULL ORDER BY x.created_at DESC LIMIT 1) AS author
    FROM deliverable_comments k
    JOIN deliverables d ON d.id = k.deliverable_id
    JOIN clients cl ON cl.id = k.client_id
    WHERE k.author_role = 'client' AND k.handled_at IS NULL ${demoFilter}
    GROUP BY k.deliverable_id ORDER BY last_at ASC`);
}

/** Compteurs seuls, pour le badge de la barre latérale. */
requests.get('/demandes/compteur', async (c) => {
  const demo = c.env.ENVIRONMENT === 'production' ? 'AND cl.is_demo = 0' : '';
  const r = await first<{ comments: number; feedback: number }>(c.env.DB, `SELECT
    (SELECT COUNT(DISTINCT k.deliverable_id) FROM deliverable_comments k JOIN clients cl ON cl.id = k.client_id WHERE k.author_role = 'client' AND k.handled_at IS NULL ${demo}) AS comments,
    (SELECT COUNT(*) FROM feedback f JOIN clients cl ON cl.id = f.client_id WHERE f.status IN ('nouveau','vu') ${demo}) AS feedback`);
  const comments = r?.comments ?? 0, feedback = r?.feedback ?? 0;
  return c.json({ comments, feedback, total: comments + feedback });
});

requests.get('/demandes', async (c) => {
  const db = c.env.DB;
  const demo = c.env.ENVIRONMENT === 'production' ? 'AND cl.is_demo = 0' : '';
  const [comments, feedback, handled] = await Promise.all([
    pendingComments(db, demo),
    all<{ id: string; client_id: string; client_name: string; category: string; severity: string; status: string; body: string; created_at: string }>(db, `
      SELECT f.id, f.client_id, cl.name AS client_name, f.category, f.severity, f.status, f.body, f.created_at
      FROM feedback f JOIN clients cl ON cl.id = f.client_id
      WHERE f.status != 'resolu' ${demo}
      ORDER BY (f.severity = 'haute') DESC, f.created_at ASC LIMIT 100`),
    all<{ deliverable_id: string; client_id: string; client_name: string; title: string; handled_at: string; n: number }>(db, `
      SELECT k.deliverable_id, k.client_id, cl.name AS client_name, d.title, MAX(k.handled_at) AS handled_at, COUNT(*) AS n
      FROM deliverable_comments k JOIN deliverables d ON d.id = k.deliverable_id JOIN clients cl ON cl.id = k.client_id
      WHERE k.author_role = 'client' AND k.handled_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-14 days') ${demo}
      GROUP BY k.deliverable_id ORDER BY handled_at DESC LIMIT 20`),
  ]);
  return c.json({
    comments: comments.map((r) => ({
      deliverableId: r.deliverable_id, clientId: r.client_id, clientName: r.client_name, deliverableTitle: r.title, type: r.type,
      pending: r.pending, lastAt: r.last_at, lastBody: r.last_body, author: r.author,
    })),
    feedback: feedback.map((f) => ({ id: f.id, clientId: f.client_id, clientName: f.client_name, category: f.category, severity: f.severity, status: f.status, excerpt: f.body, createdAt: f.created_at })),
    handled: handled.map((h) => ({ deliverableId: h.deliverable_id, clientId: h.client_id, clientName: h.client_name, deliverableTitle: h.title, handledAt: h.handled_at, count: h.n })),
  });
});

/** Traiter sans répondre (ex. demande réglée par téléphone). Répondre sur le livrable traite aussi la demande. */
requests.post('/demandes/livrables/:deliverableId/traiter', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const d = await first<{ id: string; client_id: string }>(db, 'SELECT id, client_id FROM deliverables WHERE id = ?1', c.req.param('deliverableId'));
  if (!d) throw notFound();
  const res = await run(db, `UPDATE deliverable_comments SET handled_at = ?1 WHERE deliverable_id = ?2 AND author_role = 'client' AND handled_at IS NULL`, nowIso(), d.id);
  await audit(db, { clientId: d.client_id, actorId: user.id, actorEmail: user.email, action: 'demande_traitee', objectType: 'deliverable', objectId: d.id });
  return c.json({ ok: true, handled: res.meta.changes ?? 0 });
});
