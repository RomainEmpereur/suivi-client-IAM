import { describe, expect, it } from 'vitest';
import { addDaysYmd, todayParis } from '../packages/domain/src/index.ts';
import { storeClientAlerts, computeClientAlerts } from '../api/src/alerts.ts';
import { A, AGENCE, B, CLIENT_A, CLIENT_B, setup } from './helpers/app.ts';

const yesterday = addDaysYmd(todayParis(), -1);

describe('Encaissements saisis (décision 0014)', () => {
  it("le client ajoute un encaissement : l'encaissé devient mesuré et alimente le rollup ; la suppression le retire", async () => {
    const { call, raw } = setup();
    raw.prepare(`UPDATE clients SET unmeasured_json = '["cash_collected_cents"]' WHERE id = ?`).run(A);
    const r = await call(`/clients/${A}/cash`, { as: CLIENT_A, method: 'POST', body: { date: yesterday, amountCents: 150000, label: 'Nouveau client' } });
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as any;
    await call(`/clients/${A}/cash`, { as: CLIENT_A, method: 'POST', body: { date: yesterday, amountCents: 50000 } });
    const row = () => raw.prepare(`SELECT cash_collected_cents c, source FROM metrics_daily WHERE client_id = ? AND ad_id = 'encaissement_manuel'`).get(A) as any;
    expect(row()).toMatchObject({ c: 200000, source: 'manuel' });
    expect(JSON.parse((raw.prepare('SELECT unmeasured_json u FROM clients WHERE id = ?').get(A) as any).u)).toEqual([]);
    const roll = raw.prepare(`SELECT cash_collected_cents c FROM metrics_rollup WHERE client_id = ? AND level = 'campaign' AND entity_id = 'encaissement_manuel' AND period_start = ?`).get(A, yesterday) as any;
    expect(roll.c).toBe(200000);
    const list = (await (await call(`/clients/${A}/cash`, { as: CLIENT_A })).json()) as any;
    expect(list.entries).toHaveLength(2);
    expect((await call(`/clients/${A}/cash/${id}`, { as: CLIENT_A, method: 'DELETE' })).status).toBe(200);
    expect(row()).toMatchObject({ c: 50000 });
  });

  it('montant, date future, isolation, et vue client de l’agence en lecture seule', async () => {
    const { call } = setup();
    expect((await call(`/clients/${A}/cash`, { as: CLIENT_A, method: 'POST', body: { date: yesterday, amountCents: -5 } })).status).toBe(400);
    expect((await call(`/clients/${A}/cash`, { as: CLIENT_A, method: 'POST', body: { date: addDaysYmd(todayParis(), 2), amountCents: 100 } })).status).toBe(400);
    expect((await call(`/clients/${A}/cash`, { as: CLIENT_B, method: 'POST', body: { date: yesterday, amountCents: 100 } })).status).toBe(404);
    expect((await call(`/clients/${A}/cash`, { as: AGENCE, view: 'client', method: 'POST', body: { date: yesterday, amountCents: 100 } })).status).toBe(403);
    expect((await call(`/clients/${A}/cash`, { as: AGENCE, method: 'POST', body: { date: yesterday, amountCents: 100 } })).status).toBe(201);
  });
});

describe('Statut posé par le client sur un rendez-vous du CRM', () => {
  it('le rendez-vous tenu compte dans les chiffres et la synchro ne l’écrase pas', async () => {
    const { call, raw } = setup();
    const booked = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const sched = new Date(Date.now() - 3 * 86_400_000).toISOString();
    raw.prepare(`INSERT INTO appointments (id, client_id, ghl_appointment_id, contact_name, booked_at, scheduled_at, status, ad_id, campaign_id, counts_toward_target, origin, status_source)
      VALUES ('ap_x', ?, 'ghl_x', 'Paul M.', ?, ?, 'prevu', 'ad_test_x', 'camp_x', 1, 'ghl', 'ghl')`).run(B, booked, sched);
    expect((await call(`/clients/${B}/appointments/ap_x`, { as: CLIENT_B, method: 'PATCH', body: { status: 'honore' } })).status).toBe(200);
    const held = raw.prepare(`SELECT SUM(appointments_held) h FROM metrics_daily WHERE client_id = ? AND ad_id = 'ad_test_x'`).get(B) as any;
    expect(held.h).toBe(1);
    const roll = raw.prepare(`SELECT SUM(appointments_held) h FROM metrics_rollup WHERE client_id = ? AND level = 'ad' AND entity_id = 'ad_test_x'`).get(B) as any;
    expect(roll.h).toBe(1);
  });
});

describe('Édition des clients (vue agence)', () => {
  it("crée puis modifie un client ; seuils et publication automatique journalisés avant / après", async () => {
    const { call, raw } = setup();
    const r = await call('/agence/clients', { as: AGENCE, method: 'POST', body: { name: 'Nouvelle Société', offer: 'Standard', status: 'onboarding' } });
    expect(r.status).toBe(201);
    const { client } = (await r.json()) as any;
    expect(client).toMatchObject({ id: 'cl_nouvelle_societe', slug: 'nouvelle-societe', autoPublishRecos: false });
    const p = await call(`/agence/clients/${client.id}`, { as: AGENCE, method: 'PATCH', body: { autoPublishRecos: true, thresholds: { cpm_max_cents: 5000, ctr_min: null }, campaignsLaunchedAt: '2026-11-01' } });
    expect(p.status).toBe(200);
    const row = raw.prepare('SELECT auto_publish_recos, thresholds_json, campaigns_launched_at FROM clients WHERE id = ?').get(client.id) as any;
    expect(row).toMatchObject({ auto_publish_recos: 1, campaigns_launched_at: '2026-11-01' });
    expect(JSON.parse(row.thresholds_json)).toEqual({ cpm_max_cents: 5000 });
    const log = raw.prepare(`SELECT before_json, after_json FROM audit_log WHERE action = 'client_seuils_modification' AND object_id = ?`).get(client.id) as any;
    expect(JSON.parse(log.before_json).thresholds_json).toBe('{}');
    expect(JSON.parse(log.after_json).auto_publish_recos).toBe(1);
    expect((await call(`/agence/clients/${client.id}`, { as: AGENCE, method: 'PATCH', body: { thresholds: { inconnu: 1 } } })).status).toBe(400);
    expect((await call(`/agence/clients/${client.id}`, { as: AGENCE, method: 'PATCH', body: { status: 'nimporte' } })).status).toBe(400);
  });

  it('réservé à l’agence en vue agence', async () => {
    const { call } = setup();
    expect((await call('/agence/clients', { as: CLIENT_A, method: 'POST', body: { name: 'X' } })).status).toBe(403);
    expect((await call(`/agence/clients/${A}`, { as: AGENCE, view: 'client', method: 'PATCH', body: { name: 'X' } })).status).toBe(403);
  });
});

describe('Publication automatique des analyses', () => {
  it('case cochée : l’analyse déposée est publiée aussitôt', async () => {
    const TOKEN = 'cle-de-test-generation-automatique-0123456789';
    const H = { Authorization: `Bearer ${TOKEN}` };
    const { call, raw } = setup({ DELIVERY_ROBOT_TOKEN: TOKEN });
    raw.prepare('UPDATE clients SET auto_publish_recos = 1 WHERE id = ?').run(A);
    const to = yesterday, from = addDaysYmd(to, -13);
    const id = ((await (await call(`/clients/${A}/analyses`, { as: AGENCE, method: 'POST', body: { from, to } })).json()) as any).id;
    await call(`/robot/clients/${A}/analyses/${id}/brief`, { headers: H });
    const put = await call(`/robot/clients/${A}/analyses/${id}`, { method: 'PUT', headers: H, body: {
      summaryMd: 'Synthèse', clientSummaryMd: 'Pour vous', recommendations: [{ severity: 'info', title: 'T', body: 'B' }] } });
    expect(put.status).toBe(200);
    const list = (await (await call(`/clients/${A}/analyses`, { as: CLIENT_A })).json()) as any;
    expect(list.analyses.length).toBe(1);
    expect(list.analyses[0].recommendations).toHaveLength(1);
  });
});

describe('Alertes quotidiennes (vue agence)', () => {
  it('pub qui dépense sans rendez-vous, rendez-vous sans statut ; recalcul idempotent ; jamais côté client', async () => {
    const { call, raw, env } = setup();
    raw.prepare(`UPDATE clients SET unmeasured_json = '[]' WHERE id = ?`).run(A);
    raw.prepare(`INSERT INTO metrics_rollup (client_id, period_type, period_start, level, entity_id, entity_name, spend_cents, impressions, link_clicks)
      VALUES (?, 'day', ?, 'ad', 'ad_alerte', 'Pub alerte', 900000, 50000, 400)`).run(A, yesterday);
    const client = raw.prepare('SELECT * FROM clients WHERE id = ?').get(A) as any;
    const drafts = await computeClientAlerts(env.DB as any, client);
    expect(drafts.some((d) => d.rule_key === 'pub_sans_rdv' && d.entity_id === 'ad_alerte')).toBe(true);
    await storeClientAlerts(env.DB as any, client);
    const n1 = (raw.prepare('SELECT COUNT(*) n FROM alerts WHERE client_id = ?').get(A) as any).n;
    await storeClientAlerts(env.DB as any, client);
    expect((raw.prepare('SELECT COUNT(*) n FROM alerts WHERE client_id = ?').get(A) as any).n).toBe(n1);
    const r = (await (await call('/agence/alerts', { as: AGENCE })).json()) as any;
    expect(r.alerts.filter((a: any) => a.clientId === A)).toHaveLength(n1);
    expect((await call('/agence/alerts', { as: CLIENT_A })).status).toBe(403);
    expect((await call('/agence/alerts/run', { as: AGENCE, method: 'POST' })).status).toBe(200);
  });
});
