import { Hono } from 'hono';
import {
  TOTAL_FIELDS, addDaysYmd, bucketSeries, clientThresholds, derived, funnel, kpiValues, parisDayStartMs, pointRatios, safeDiv, todayParis,
  type AppointmentRates, type Granularity, type SeriesPoint, type Totals,
} from '@obsidian/domain';
import type { AppEnv } from '../env.ts';
import { requireAgency } from '../auth.ts';
import { scopeClient } from '../scope.ts';
import { all, audit, first, newId, nowIso } from '../db.ts';
import { HttpError, notFound } from '../errors.ts';
import { clientTotals, entityTotals, lastSuccessfulSync, periodBounds, rangeBounds } from '../metrics.ts';
import { safeJson } from '../serialize.ts';

/**
 * Pilotage, blocs 02 à 06 (§9, lot 5). Lecture seule de metrics_rollup (chiffres) ; metrics_daily ne sert qu'aux
 * libellés (ensemble, statut, budget). Même écran pour l'agence et le client ; seuls les repères de funnel
 * (funnel_events) sont saisis par l'agence.
 */
export const pilotage = new Hono<AppEnv>();
pilotage.use('/:clientId/pilotage', scopeClient);
pilotage.use('/:clientId/funnel-events', scopeClient);
pilotage.use('/:clientId/funnel-events/*', scopeClient);

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const COLS = TOTAL_FIELDS.join(', ');

async function dailyFull(db: D1Database, clientId: string, from: string, to: string): Promise<SeriesPoint[]> {
  const rows = await all<Totals & { date: string }>(db,
    `SELECT period_start AS date, ${COLS} FROM metrics_rollup WHERE client_id = ?1 AND period_type = 'day' AND level = 'client'
     AND period_start BETWEEN ?2 AND ?3 ORDER BY period_start`, clientId, from, to);
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out: SeriesPoint[] = [];
  for (let d = from; d <= to; d = addDaysYmd(d, 1)) {
    const r = byDate.get(d);
    out.push(Object.fromEntries([['date', d], ...TOTAL_FIELDS.map((k) => [k, r ? r[k] : null])]) as SeriesPoint);
  }
  return out;
}

export interface Appt { booked_at: string; scheduled_at: string; status: string }
export function appointmentRates(appts: Appt[], from: string, to: string): AppointmentRates {
  const start = parisDayStartMs(from), end = parisDayStartMs(addDaysYmd(to, 1));
  const inP = (iso: string) => { const t = Date.parse(iso); return t >= start && t < end; };
  const booked = appts.filter((a) => inP(a.booked_at));
  const cancelled = booked.filter((a) => a.status === 'annule').length;
  const past = appts.filter((a) => inP(a.scheduled_at) && Date.parse(a.scheduled_at) <= Date.now());
  const held = past.filter((a) => a.status === 'honore').length;
  const noShow = past.filter((a) => a.status === 'absent').length;
  const pending = past.filter((a) => a.status === 'prevu').length;
  return {
    cancel_rate: booked.length ? cancelled / booked.length : null,
    reasonCancel: booked.length ? null : 'Aucun rendez-vous réservé sur la période',
    show_rate: held + noShow ? held / (held + noShow) : null,
    reasonShow: held + noShow ? null : pending ? 'Statuts des rendez-vous non renseignés' : 'Aucun rendez-vous passé sur la période',
  };
}

pilotage.get('/:clientId/pilotage', async (c) => {
  const client = c.get('client');
  const db = c.env.DB;
  const qFrom = c.req.query('from'), qTo = c.req.query('to');
  let p: { from: string; to: string; prevFrom: string; prevTo: string; days: number };
  if (qFrom && qTo) {
    if (!YMD.test(qFrom) || !YMD.test(qTo) || qFrom > qTo) throw new HttpError(400, 'Période invalide.');
    p = rangeBounds(qFrom, qTo);
    if (p.days > 1100) throw new HttpError(400, 'Période trop longue (3 ans au plus).');
  } else {
    const n = Number(c.req.query('days'));
    const days = [7, 14, 30, 90].includes(n) ? n : 30;
    p = { ...periodBounds(days), days };
  }
  const g = (['day', 'week', 'month'].includes(c.req.query('g') ?? '') ? c.req.query('g') : 'day') as Granularity;

  const [cur, prev, daily, dailyPrev, campaigns, ads, meta, appts, events, range, lastSync] = await Promise.all([
    clientTotals(db, client.id, p.from, p.to),
    clientTotals(db, client.id, p.prevFrom, p.prevTo),
    dailyFull(db, client.id, p.from, p.to),
    dailyFull(db, client.id, p.prevFrom, p.prevTo),
    entityTotals(db, client.id, 'campaign', p.from, p.to),
    entityTotals(db, client.id, 'ad', p.from, p.to),
    // Libellés uniquement (aucun chiffre) : la ligne la plus récente de chaque publicité / campagne.
    all<{ ad_id: string; campaign_id: string; campaign_name: string | null; adset_name: string | null; ad_name: string | null; ad_status: string | null; campaign_daily_budget_cents: number | null }>(db,
      `SELECT m.ad_id, m.campaign_id, m.campaign_name, m.adset_name, m.ad_name, m.ad_status, m.campaign_daily_budget_cents FROM metrics_daily m
       JOIN (SELECT ad_id, MAX(date) AS d FROM metrics_daily WHERE client_id = ?1 AND date <= ?2 GROUP BY ad_id) x ON x.ad_id = m.ad_id AND x.d = m.date
       WHERE m.client_id = ?1`, client.id, p.to),
    all<Appt>(db, `SELECT booked_at, scheduled_at, status FROM appointments WHERE client_id = ?1 AND counts_toward_target = 1`, client.id),
    all<{ id: string; date: string; label: string; description: string | null }>(db, 'SELECT id, date, label, description FROM funnel_events WHERE client_id = ?1 ORDER BY date', client.id),
    first<{ first: string | null; last: string | null }>(db, `SELECT MIN(period_start) AS first, MAX(period_start) AS last FROM metrics_rollup WHERE client_id = ?1 AND level = 'client' AND period_type = 'day'`, client.id),
    lastSuccessfulSync(db, client.id),
  ]);

  const thresholds = clientThresholds(client.thresholds_json, client.unit_economics_json);
  const unmeasured = new Set((safeJson(client.unmeasured_json ?? '[]') as string[] | null) ?? []);
  const rates = { cur: appointmentRates(appts, p.from, p.to), prev: appointmentRates(appts, p.prevFrom, p.prevTo) };

  const keys = TOTAL_FIELDS;
  const series = bucketSeries(daily, g, keys).map((s) => ({ ...s, ...pointRatios(s) }));
  const seriesPrev = bucketSeries(dailyPrev, g, keys).map((s) => ({ ...s, ...pointRatios(s) }));

  const metaByAd = new Map(meta.map((m) => [m.ad_id, m]));
  const budgetByCampaign = new Map<string, number | null>();
  for (const m of meta) if (m.campaign_daily_budget_cents != null) budgetByCampaign.set(m.campaign_id, m.campaign_daily_budget_cents);
  const label = (id: string) => (id === 'campagne:supprimees' ? 'Publicités supprimées ou archivées'
    : id === 'non_rattache' ? 'Non rattaché à une publicité' : id.startsWith('campagne:') ? 'Toute la campagne (détail par publicité indisponible)' : null);
  const crmMeasured = !unmeasured.has('appointments_booked');

  return c.json({
    period: p, granularity: g, lastSync, dataRange: range ?? { first: null, last: null },
    currency: { adAccount: client.ad_account_currency, shown: 'EUR' },
    thresholds, unmeasured: [...unmeasured],
    kpis: kpiValues(cur, prev, rates, thresholds, unmeasured),
    funnel: funnel(cur, thresholds, unmeasured),
    costs: cur ? {
      per_click_cents: derived(cur).cpc_cents, per_visitor_cents: derived(cur).cost_per_visitor_cents,
      per_booked_cents: crmMeasured ? derived(cur).cost_per_booked_cents : null,
      per_client_cents: unmeasured.has('sales') ? null : derived(cur).cac_cents,
    } : null,
    series, seriesPrevious: seriesPrev, events,
    campaigns: campaigns.map((r) => {
      const d = derived(r);
      return {
        id: r.entity_id, name: r.entity_name ?? label(r.entity_id) ?? r.entity_id,
        daily_budget_cents: budgetByCampaign.get(r.entity_id) ?? null,
        spend_cents: r.spend_cents, impressions: r.impressions, cpm_cents: d.cpm_cents, link_clicks: r.link_clicks, ctr: d.ctr,
        cpc_cents: d.cpc_cents, visitors: r.landing_page_views, cost_per_visitor_cents: d.cost_per_visitor_cents,
        vsl_views: r.vsl_views || null, leads: r.leads, appointments_booked: crmMeasured ? r.appointments_booked : null,
      };
    }),
    ads: ads.map((r) => {
      const d = derived(r);
      const m = metaByAd.get(r.entity_id);
      return {
        id: r.entity_id, name: m?.ad_name ?? r.entity_name ?? label(r.entity_id) ?? r.entity_id,
        adset: m?.adset_name ?? null, campaign: m?.campaign_name ?? null, status: m?.ad_status ?? null,
        aggregate: Boolean(label(r.entity_id)),
        spend_cents: r.spend_cents, impressions: r.impressions, cpm_cents: d.cpm_cents, ctr: d.ctr, cpc_cents: d.cpc_cents,
        visitors: r.landing_page_views, cost_per_visitor_cents: d.cost_per_visitor_cents, vsl_views: r.vsl_views || null,
        leads: r.leads,
        appointments_booked: crmMeasured ? r.appointments_booked : null,
        cost_per_booked_cents: crmMeasured ? safeDiv(r.spend_cents, r.appointments_booked) : null,
        thruplay_rate: d.thruplay_rate,
      };
    }),
  });
});

// ─── Repères de funnel (§9 bloc 04) : saisis par l'agence ─────────────────────

pilotage.post('/:clientId/funnel-events', async (c) => {
  requireAgency(c);
  const client = c.get('client');
  const user = c.get('user');
  const b = await c.req.json<{ date?: string; label?: string; description?: string | null }>().catch(() => ({} as Record<string, never>));
  if (!b.date || !YMD.test(b.date) || b.date > todayParis()) throw new HttpError(400, 'Date invalide.');
  const label = (b.label ?? '').trim();
  if (!label || label.length > 60) throw new HttpError(400, 'Libellé requis (60 caractères au plus).');
  const description = (b.description ?? '').trim().slice(0, 500) || null;
  const id = newId('fe');
  await c.env.DB.prepare('INSERT INTO funnel_events (id, client_id, date, label, description) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(id, client.id, b.date, label, description).run();
  await audit(c.env.DB, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'repere_funnel_cree', objectType: 'funnel_event', objectId: id, after: { date: b.date, label } });
  return c.json({ id }, 201);
});

pilotage.delete('/:clientId/funnel-events/:eventId', async (c) => {
  requireAgency(c);
  const client = c.get('client');
  const user = c.get('user');
  const e = await first<{ id: string; label: string }>(c.env.DB, 'SELECT id, label FROM funnel_events WHERE id = ?1 AND client_id = ?2', c.req.param('eventId'), client.id);
  if (!e) throw notFound();
  await c.env.DB.prepare('DELETE FROM funnel_events WHERE id = ?1 AND client_id = ?2').bind(e.id, client.id).run();
  await audit(c.env.DB, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'repere_funnel_supprime', objectType: 'funnel_event', objectId: e.id, before: { label: e.label }, after: { at: nowIso() } });
  return c.json({ ok: true });
});
