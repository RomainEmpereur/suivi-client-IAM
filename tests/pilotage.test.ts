import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS, bucketSeries, bucketStart, emptyTotals, funnel, kpiValues } from '../packages/domain/src/index.ts';
import { A, AGENCE, B, CLIENT_A, CLIENT_B, setup } from './helpers/app.ts';

const noRates = { cancel_rate: null, show_rate: null, reasonShow: 'x', reasonCancel: 'y' };

describe('Pilotage : calculs', () => {
  it('regroupe par semaine (lundi) et par mois, sans transformer une absence en 0', () => {
    expect(bucketStart('2026-11-11', 'week')).toBe('2026-11-09');
    expect(bucketStart('2026-11-09', 'week')).toBe('2026-11-09');
    expect(bucketStart('2026-11-11', 'month')).toBe('2026-11-01');
    const s = bucketSeries([
      { date: '2026-11-09', spend_cents: 100 }, { date: '2026-11-10', spend_cents: null }, { date: '2026-11-16', spend_cents: null },
    ], 'week', ['spend_cents']);
    expect(s).toEqual([{ date: '2026-11-09', spend_cents: 100 }, { date: '2026-11-16', spend_cents: null }]);
  });

  it('16 indicateurs ; verdicts sur les seuils ; non mesuré quand la source manque', () => {
    const t = { ...emptyTotals(), spend_cents: 100000, impressions: 50000, link_clicks: 500, landing_page_views: 300, appointments_booked: 5 };
    const k = kpiValues(t, null, { cur: { ...noRates, cancel_rate: 0.2 }, prev: noRates }, { ...DEFAULT_THRESHOLDS, cost_per_booked_max_cents: 15000 }, new Set(['sales', 'cash_collected_cents']));
    const by = Object.fromEntries(k.map((x) => [x.key, x]));
    expect(k).toHaveLength(16);
    expect(by.cost_per_booked_cents).toMatchObject({ value: 20000, verdict: 'corriger' });
    // Seuils larges B2B lancement (décision 0012) : CTR 1 % ≥ 0,7 % et CPM 20 € ≤ 40 € sont tenus.
    expect(by.ctr).toMatchObject({ value: 0.01, verdict: 'tenu' });
    expect(by.cpm_cents).toMatchObject({ value: 2000, verdict: 'tenu' });
    expect(by.cancel_rate).toMatchObject({ value: 0.2, verdict: 'tenu' });
    expect(by.sales).toMatchObject({ value: null, reason: 'Non synchronisé pour ce client' });
    expect(by.roas_cash).toMatchObject({ value: null, verdict: 'non_mesure' });
    expect(by.vsl_views.value).toBeNull();
    expect(by.mrr_added_cents.value).toBeNull();
    expect(by.show_rate).toMatchObject({ value: null, reason: 'x' });
  });

  it('funnel : taux de passage, VSL non mesurée sautée', () => {
    const t = { ...emptyTotals(), impressions: 10000, link_clicks: 200, landing_page_views: 150, appointments_booked: 6, appointments_held: 4, sales: 1 };
    const f = funnel(t, DEFAULT_THRESHOLDS, new Set());
    expect(f.map((s) => s.value)).toEqual([10000, 200, 150, null, 6, 4, 1]);
    expect(f[1]).toMatchObject({ rate: 0.02, verdict: 'tenu' });
    expect(f[4].rate).toBeCloseTo(6 / 150);
    expect(f[3].rate).toBeNull();
  });
});

describe('Pilotage : API', () => {
  it('rend KPI, funnel, séries, campagnes, publicités ; la publicité sans rendez-vous garde sa dépense', async () => {
    const { call } = setup();
    const r = await call(`/clients/${A}/pilotage?days=30&g=week`, { as: AGENCE });
    expect(r.status).toBe(200);
    const d = (await r.json()) as any;
    expect(d.kpis).toHaveLength(16);
    expect(d.funnel[0].value).toBeGreaterThan(0);
    expect(d.series.length).toBeGreaterThan(3);
    expect(d.series.length).toBeLessThan(7);
    expect(d.campaigns.length).toBeGreaterThan(0);
    expect(d.ads.length).toBeGreaterThan(0);
    const spentNoBooking = d.ads.find((a: any) => a.spend_cents > 0 && a.appointments_booked === 0);
    if (spentNoBooking) expect(spentNoBooking.cost_per_booked_cents).toBeNull();
    const sumAds = d.ads.reduce((s: number, a: any) => s + a.spend_cents, 0);
    expect(sumAds).toBe(d.kpis.find((k: any) => k.key === 'spend_cents').value);
  });

  it('repères de funnel : l’agence les saisit, le client les voit sans pouvoir en créer', async () => {
    const { call } = setup();
    const res = await call(`/clients/${B}/funnel-events`, { as: AGENCE, method: 'POST', body: { date: '2026-10-01', label: 'VSL directe' } });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as any;
    const seen = (await (await call(`/clients/${B}/pilotage?days=30`, { as: CLIENT_B })).json()) as any;
    expect(seen.events).toEqual([expect.objectContaining({ id, label: 'VSL directe', date: '2026-10-01' })]);
    expect((await call(`/clients/${B}/funnel-events`, { as: CLIENT_B, method: 'POST', body: { date: '2026-10-01', label: 'x' } })).status).toBe(403);
    expect((await call(`/clients/${B}/funnel-events`, { as: AGENCE, method: 'POST', body: { date: '2026-10-01', label: '' } })).status).toBe(400);
    expect((await call(`/clients/${B}/funnel-events/${id}`, { as: CLIENT_B, method: 'DELETE' })).status).toBe(403);
    expect((await call(`/clients/${B}/funnel-events/${id}`, { as: AGENCE, method: 'DELETE' })).status).toBe(200);
  });

  it('isolation : un client ne lit pas le pilotage d’un autre', async () => {
    const { call } = setup();
    expect((await call(`/clients/${A}/pilotage`, { as: CLIENT_B })).status).toBe(404);
    expect((await call(`/clients/${A}/pilotage`, { as: CLIENT_A })).status).toBe(200);
    expect((await call(`/clients/${A}/pilotage?from=2026-11-10&to=2026-11-01`, { as: AGENCE })).status).toBe(400);
  });
});
