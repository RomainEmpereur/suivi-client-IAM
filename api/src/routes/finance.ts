import { Hono } from 'hono';
import {
  lastDayOfMonth, lifetimeValue, monthsBetween, summarize, todayParis,
  type AcquisitionTotals, type Deal, type DealKind, type DealSource,
} from '@obsidian/domain';
import type { AppEnv } from '../env.ts';
import { requireAgency } from '../auth.ts';
import { all, audit, first, newId, nowIso, run } from '../db.ts';
import { HttpError, notFound } from '../errors.ts';

/**
 * Suivi financier de l'agence (décision 0019) : réservé à l'agence en vue agence, jamais exposé à un client.
 * Deals saisis à la main ; dépense, leads et rendez-vous lus dans metrics_rollup du client « acquisition de l'agence ».
 */
export const finance = new Hono<AppEnv>();
finance.use('/finance', async (c, next) => { requireAgency(c); await next(); });
finance.use('/finance/*', async (c, next) => { requireAgency(c); await next(); });

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const KINDS: DealKind[] = ['nouveau', 'renouvellement', 'upsell'];
const SOURCES: DealSource[] = ['publicite', 'autre', 'inconnue'];

interface DealRow { id: string; client_name: string; deal_date: string; amount_cents: number; kind: DealKind; installments: number; source: DealSource; note: string | null }
const toDeal = (r: DealRow): Deal => ({
  id: r.id, clientName: r.client_name, date: r.deal_date, amountCents: r.amount_cents, kind: r.kind, installments: r.installments, source: r.source, note: r.note,
});

async function acquisitionClientId(db: D1Database, production: boolean): Promise<string | null> {
  const set = await first<{ value: string | null }>(db, `SELECT value FROM agency_settings WHERE key = 'acquisition_client_id'`);
  if (set) return set.value;
  const guess = await first<{ id: string }>(db,
    `SELECT id FROM clients WHERE name LIKE 'Obsidian Partners%' ${production ? 'AND is_demo = 0' : ''} ORDER BY created_at LIMIT 1`);
  return guess?.id ?? null;
}

const ACQ_COLS = 'SUM(spend_cents) AS spend_cents, SUM(leads) AS leads, SUM(appointments_booked) AS appointments_booked, SUM(appointments_held) AS appointments_held';

async function acquisitionTotals(db: D1Database, clientId: string | null, from: string, to: string): Promise<AcquisitionTotals | null> {
  if (!clientId) return null;
  const r = await first<AcquisitionTotals & { n: number }>(db,
    `SELECT COUNT(*) AS n, ${ACQ_COLS} FROM metrics_rollup WHERE client_id = ?1 AND period_type = 'day' AND level = 'client' AND period_start BETWEEN ?2 AND ?3`,
    clientId, from, to);
  if (!r || !r.n) return null;
  const { n: _n, ...t } = r;
  return t;
}

finance.get('/finance', async (c) => {
  const db = c.env.DB;
  const production = c.env.ENVIRONMENT === 'production';
  const today = todayParis();
  const deals = (await all<DealRow>(db, 'SELECT * FROM agency_deals ORDER BY deal_date DESC, created_at DESC')).map(toDeal);
  const firstDeal = deals.length ? deals[deals.length - 1].date : today;
  const from = c.req.query('from') ?? firstDeal;
  const to = c.req.query('to') ?? today;
  if (!YMD.test(from) || !YMD.test(to) || from > to) throw new HttpError(400, 'Période invalide.');

  const acqId = await acquisitionClientId(db, production);
  const [acq, coverage, monthlyAcq, candidates] = await Promise.all([
    acquisitionTotals(db, acqId, from, to),
    acqId ? first<{ first: string | null; last: string | null }>(db,
      `SELECT MIN(period_start) AS first, MAX(period_start) AS last FROM metrics_rollup WHERE client_id = ?1 AND period_type = 'day' AND level = 'client'`, acqId) : null,
    acqId ? all<AcquisitionTotals & { month: string }>(db,
      `SELECT substr(period_start, 1, 7) AS month, ${ACQ_COLS} FROM metrics_rollup
       WHERE client_id = ?1 AND period_type = 'day' AND level = 'client' AND period_start BETWEEN ?2 AND ?3 GROUP BY month`, acqId, `${firstDeal.slice(0, 7)}-01`, today) : [],
    all<{ id: string; name: string }>(db, `SELECT id, name FROM clients ${production ? 'WHERE is_demo = 0' : ''} ORDER BY name`),
  ]);
  // Les ratios d'acquisition (CAC, ROAS, closing, marge) ne se calculent que sur les jours où la dépense est mesurée :
  // sinon ils divisent tous les deals de la période par une dépense partielle.
  const measuredFrom = coverage?.first && coverage.first > from ? coverage.first : from;
  const measuredTo = coverage?.last && coverage.last < to ? coverage.last : to;
  const measured = coverage?.first && measuredFrom <= measuredTo
    ? { from: measuredFrom, to: measuredTo, summary: summarize(deals, await acquisitionTotals(db, acqId, measuredFrom, measuredTo), measuredFrom, measuredTo, today) }
    : null;
  const acqByMonth = new Map(monthlyAcq.map((m) => [m.month, m]));
  const months = monthsBetween(firstDeal, today).map((month) => {
    const a = acqByMonth.get(month) ?? null;
    return { month, ...summarize(deals, a, `${month}-01`, lastDayOfMonth(month), today) };
  });

  return c.json({
    period: { from, to },
    today,
    acquisition: {
      clientId: acqId,
      clientName: candidates.find((x) => x.id === acqId)?.name ?? null,
      syncedFrom: coverage?.first ?? null,
      syncedTo: coverage?.last ?? null,
      candidates,
    },
    summary: summarize(deals, acq, from, to, today),
    measured,
    lifetime: lifetimeValue(deals),
    months,
    deals,
  });
});

function readDeal(body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || 'clientName' in body) {
    const v = typeof body.clientName === 'string' ? body.clientName.trim() : '';
    if (!v || v.length > 120) throw new HttpError(400, 'Nom du client requis (120 caractères au plus).');
    out.client_name = v;
  }
  if (!partial || 'date' in body) {
    const v = typeof body.date === 'string' ? body.date.trim() : '';
    if (!YMD.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new HttpError(400, 'Date invalide.');
    out.deal_date = v;
  }
  if (!partial || 'amountCents' in body) {
    const v = Number(body.amountCents);
    if (!Number.isInteger(v) || v <= 0 || v > 10_000_000_00) throw new HttpError(400, 'Montant invalide.');
    out.amount_cents = v;
  }
  if (!partial || 'kind' in body) {
    const v = body.kind ?? 'nouveau';
    if (!KINDS.includes(v as DealKind)) throw new HttpError(400, 'Type de deal invalide.');
    out.kind = v;
  }
  if (!partial || 'installments' in body) {
    const v = Number(body.installments ?? 1);
    if (!Number.isInteger(v) || v < 1 || v > 36) throw new HttpError(400, 'Nombre de mensualités invalide (1 à 36).');
    out.installments = v;
  }
  if (!partial || 'source' in body) {
    const v = body.source ?? 'inconnue';
    if (!SOURCES.includes(v as DealSource)) throw new HttpError(400, 'Source invalide.');
    out.source = v;
  }
  if (!partial || 'note' in body) {
    if (body.note != null && typeof body.note !== 'string') throw new HttpError(400, 'Note invalide.');
    out.note = (body.note as string | null)?.trim().slice(0, 300) || null;
  }
  return out;
}

finance.post('/finance/deals', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Corps de requête invalide.');
  const d = readDeal(body, false);
  const id = newId('deal');
  await run(c.env.DB, `INSERT INTO agency_deals (id, client_name, deal_date, amount_cents, kind, installments, source, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    id, d.client_name, d.deal_date, d.amount_cents, d.kind, d.installments, d.source, d.note);
  await audit(c.env.DB, { clientId: null, actorId: user.id, actorEmail: user.email, action: 'deal_ajout', objectType: 'agency_deal', objectId: id, after: d });
  return c.json({ ok: true, id }, 201);
});

finance.patch('/finance/deals/:id', async (c) => {
  const user = c.get('user');
  const before = await first<DealRow>(c.env.DB, 'SELECT * FROM agency_deals WHERE id = ?1', c.req.param('id'));
  if (!before) throw notFound();
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Corps de requête invalide.');
  const d = readDeal(body, true);
  const cols = Object.keys(d);
  if (cols.length) {
    await run(c.env.DB, `UPDATE agency_deals SET ${cols.map((k, i) => `${k} = ?${i + 1}`).join(', ')}, updated_at = ?${cols.length + 1} WHERE id = ?${cols.length + 2}`,
      ...cols.map((k) => d[k]), nowIso(), before.id);
  }
  await audit(c.env.DB, { clientId: null, actorId: user.id, actorEmail: user.email, action: 'deal_modification', objectType: 'agency_deal', objectId: before.id, before, after: d });
  return c.json({ ok: true });
});

finance.delete('/finance/deals/:id', async (c) => {
  const user = c.get('user');
  const before = await first<DealRow>(c.env.DB, 'SELECT * FROM agency_deals WHERE id = ?1', c.req.param('id'));
  if (!before) throw notFound();
  await run(c.env.DB, 'DELETE FROM agency_deals WHERE id = ?1', before.id);
  await audit(c.env.DB, { clientId: null, actorId: user.id, actorEmail: user.email, action: 'deal_suppression', objectType: 'agency_deal', objectId: before.id, before });
  return c.json({ ok: true });
});

finance.put('/finance/settings', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ acquisitionClientId?: string | null }>().catch(() => ({} as Record<string, never>));
  const id = body.acquisitionClientId ?? null;
  if (id !== null && !(await first(c.env.DB, 'SELECT id FROM clients WHERE id = ?1', id))) throw new HttpError(400, 'Client inconnu.');
  await run(c.env.DB, `INSERT INTO agency_settings (key, value, updated_at) VALUES ('acquisition_client_id', ?1, ?2)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, id, nowIso());
  await audit(c.env.DB, { clientId: null, actorId: user.id, actorEmail: user.email, action: 'finance_reglage', objectType: 'agency_settings', objectId: 'acquisition_client_id', after: { id } });
  return c.json({ ok: true });
});
