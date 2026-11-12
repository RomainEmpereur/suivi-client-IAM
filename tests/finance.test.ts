import { describe, expect, it } from 'vitest';
import { addMonthsYmd, dealPayments, lifetimeValue, summarize, type Deal } from '../packages/domain/src/index.ts';
import { A, AGENCE, CLIENT_A, setup } from './helpers/app.ts';

const deal = (o: Partial<Deal>): Deal => ({ id: 'd', clientName: 'X', date: '2026-05-01', amountCents: 100_000, kind: 'nouveau', installments: 1, source: 'inconnue', note: null, ...o });

describe('Suivi financier : calculs', () => {
  it('échelonne un deal en mensualités, fin de mois bornée', () => {
    expect(addMonthsYmd('2026-01-31', 1)).toBe('2026-02-28');
    expect(dealPayments({ date: '2026-07-31', amountCents: 300_000, installments: 3 })).toEqual([
      { date: '2026-07-31', amountCents: 100_000 }, { date: '2026-08-31', amountCents: 100_000 }, { date: '2026-09-30', amountCents: 100_000 },
    ]);
    expect(dealPayments({ date: '2026-01-01', amountCents: 100, installments: 3 }).map((p) => p.amountCents)).toEqual([34, 33, 33]);
  });

  it('CA, encaissé, CAC, ROAS et marge sur une période ; « — » sans dépense synchronisée', () => {
    const deals = [
      deal({ id: '1', clientName: 'Qhare', date: '2026-07-31', amountCents: 300_000, installments: 3 }),
      deal({ id: '2', clientName: 'Effinity', date: '2026-07-10', amountCents: 450_000, source: 'publicite' }),
      deal({ id: '3', clientName: 'Effinity', date: '2026-07-20', amountCents: 100_000, kind: 'upsell' }),
    ];
    const acq = { spend_cents: 200_000, leads: 40, appointments_booked: 10, appointments_held: 8 };
    const s = summarize(deals, acq, '2026-07-01', '2026-07-31', '2026-08-15');
    expect(s).toMatchObject({ signedCents: 850_000, collectedCents: 650_000, upcomingCents: 200_000, newClients: 2, deals: 3 });
    expect(s.cacCents).toBe(100_000);
    expect(s.cacAdsCents).toBe(200_000);
    expect(s.cplCents).toBe(5_000);
    expect(s.costPerBookedCents).toBe(20_000);
    expect(s.closeRate).toBe(0.25);
    expect(s.roas).toBe(4.25);
    expect(s.marginAfterAdsCents).toBe(450_000);
    const none = summarize(deals, null, '2026-07-01', '2026-07-31', '2026-08-15');
    expect(none).toMatchObject({ spendCents: null, cacCents: null, roas: null, marginAfterAdsCents: null, cplCents: null });
  });

  it('LTV par client, noms rapprochés sans accents ni casse', () => {
    const lt = lifetimeValue([deal({ clientName: 'Christiane Shaerer' }), deal({ clientName: 'christiane  shaerer', amountCents: 50_000 }), deal({ clientName: 'Civex' })]);
    expect(lt).toMatchObject({ clients: 2, ltvCents: 125_000, repeatRate: 0.5 });
  });
});

describe('Suivi financier : API', () => {
  it("réservé à l'agence en vue agence", async () => {
    const { call } = setup();
    expect((await call('/agence/finance', { as: CLIENT_A })).status).toBe(403);
    expect((await call('/agence/finance', { as: AGENCE, headers: { 'X-View': 'client' } })).status).toBe(403);
    expect((await call('/agence/finance/deals', { as: CLIENT_A, method: 'POST', body: { clientName: 'X', date: '2026-05-01', amountCents: 100 } })).status).toBe(403);
  });

  it('ajoute, modifie, supprime un deal et croise la dépense du compte d’acquisition', async () => {
    const { call, raw } = setup();
    const r = await call('/agence/finance/deals', { as: AGENCE, method: 'POST', body: { clientName: 'Effinity', date: '2026-05-30', amountCents: 450_000, kind: 'nouveau' } });
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as any;
    expect((await call('/agence/finance/deals', { as: AGENCE, method: 'POST', body: { clientName: '', date: '2026-05-30', amountCents: 1 } })).status).toBe(400);
    expect((await call(`/agence/finance/deals/${id}`, { as: AGENCE, method: 'PATCH', body: { installments: 3 } })).status).toBe(200);
    expect((await call('/agence/finance/settings', { as: AGENCE, method: 'PUT', body: { acquisitionClientId: A } })).status).toBe(200);
    const spend = raw.prepare(`SELECT SUM(spend_cents) s FROM metrics_rollup WHERE client_id = ? AND level = 'client' AND period_type = 'day' AND period_start BETWEEN '2026-05-30' AND '2026-05-30'`).get(A) as any;
    const d = (await (await call('/agence/finance?from=2026-05-30&to=2026-05-30', { as: AGENCE })).json()) as any;
    expect(d.deals[0]).toMatchObject({ clientName: 'Effinity', installments: 3 });
    expect(d.summary.signedCents).toBe(450_000);
    expect(d.summary.collectedCents).toBe(150_000);
    expect(d.summary.spendCents).toBe(spend?.s ?? null);
    expect(d.acquisition.clientId).toBe(A);
    expect(d.months.length).toBeGreaterThan(0);
    // Ratios d'acquisition limités aux jours où la dépense est synchronisée.
    const cov = raw.prepare(`SELECT MIN(period_start) f FROM metrics_rollup WHERE client_id = ? AND level = 'client' AND period_type = 'day'`).get(A) as any;
    const wide = (await (await call('/agence/finance?from=2020-01-01&to=2026-12-31', { as: AGENCE })).json()) as any;
    expect(wide.measured.from).toBe(cov.f);
    expect((await call(`/agence/finance/deals/${id}`, { as: AGENCE, method: 'DELETE' })).status).toBe(200);
    expect(((await (await call('/agence/finance', { as: AGENCE })).json()) as any).deals).toEqual([]);
  });
});
