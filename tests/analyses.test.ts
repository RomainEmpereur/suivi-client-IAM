import { describe, expect, it } from 'vitest';
import { addDaysYmd, todayParis } from '../packages/domain/src/index.ts';
import { A, AGENCE, B, CLIENT_A, CLIENT_B, setup } from './helpers/app.ts';

const TOKEN = 'cle-de-test-generation-automatique-0123456789';
const H = { Authorization: `Bearer ${TOKEN}` };
const boot = () => setup({ DELIVERY_ROBOT_TOKEN: TOKEN });
const to = addDaysYmd(todayParis(), -1);
const from = addDaysYmd(to, -13);
const RESULT = {
  summaryMd: '## Synthèse\nLe coût par rendez-vous dépasse le plafond.',
  clientSummaryMd: 'Vos campagnes génèrent des rendez-vous, mais trop chers cette quinzaine.',
  recommendations: [
    { severity: 'corriger', title: 'Couper la publicité 11', body: '10 € dépensés, 0 rendez-vous.', clientTitle: 'Arrêter une publicité peu efficace', clientBody: 'Une publicité ne génère aucun rendez-vous.', metrics: { spend_cents: 1000 } },
    { severity: 'info', title: 'Garder la campagne A', body: 'CTR 2,1 %.' },
  ],
};

async function requestAnalysis(call: any) {
  const r = await call(`/clients/${A}/analyses`, { as: AGENCE, method: 'POST', body: { from, to } });
  expect(r.status).toBe(201);
  return ((await r.json()) as any).id as string;
}

describe('Analyse ponctuelle des campagnes', () => {
  it("l'agence demande une analyse ; la génération lit un instantané figé des chiffres et dépose des recommandations internes", async () => {
    const { call, raw } = boot();
    const id = await requestAnalysis(call);
    expect((await call(`/clients/${A}/analyses`, { as: AGENCE, method: 'POST', body: { from, to } })).status).toBe(409); // une à la fois
    const q = (await (await call('/robot/analyses/queue', { headers: H })).json()) as any;
    expect(q.items).toEqual([expect.objectContaining({ analysisId: id, clientId: A, from, to, status: 'en_attente' })]);
    const brief = (await (await call(`/robot/clients/${A}/analyses/${id}/brief`, { headers: H })).json()) as any;
    expect(brief.data.period).toMatchObject({ from, to });
    expect(brief.data.totals.current.spend_cents).toBeGreaterThan(0);
    expect(brief.data.campaigns.length).toBeGreaterThan(0);
    expect(brief.instructions).toMatch(/Aucun chiffre/);
    // L'instantané est figé : une modification ultérieure des chiffres ne le change pas.
    raw.prepare(`UPDATE metrics_rollup SET spend_cents = spend_cents + 999999 WHERE client_id = ?`).run(A);
    const again = (await (await call(`/robot/clients/${A}/analyses/${id}/brief`, { headers: H })).json()) as any;
    expect(again.data.totals.current.spend_cents).toBe(brief.data.totals.current.spend_cents);

    expect((await call(`/robot/clients/${A}/analyses/${id}`, { method: 'PUT', body: RESULT, headers: H })).status).toBe(200);
    const list = (await (await call(`/clients/${A}/analyses`, { as: AGENCE })).json()) as any;
    expect(list.analyses[0]).toMatchObject({ id, status: 'terminee', published: false, summary: RESULT.summaryMd });
    expect(list.analyses[0].recommendations.map((r: any) => r.severity)).toEqual(['corriger', 'info']);
    // Rien de visible pour le client avant publication.
    expect(((await (await call(`/clients/${A}/analyses`, { as: CLIENT_A })).json()) as any).analyses).toEqual([]);
    expect(JSON.stringify(await (await call(`/clients/${A}/recommendations`, { as: CLIENT_A })).json())).not.toMatch(/Couper la publicité 11|Arrêter une publicité peu efficace/);
  });

  it("l'agence réécrit, ignore une recommandation, puis publie : le client voit la synthèse et la version client", async () => {
    const { call } = boot();
    const id = await requestAnalysis(call);
    await call(`/robot/clients/${A}/analyses/${id}/brief`, { headers: H });
    await call(`/robot/clients/${A}/analyses/${id}`, { method: 'PUT', body: RESULT, headers: H });
    const recos = ((await (await call(`/clients/${A}/analyses`, { as: AGENCE })).json()) as any).analyses[0].recommendations;
    const info = recos.find((r: any) => r.severity === 'info');
    expect((await call(`/clients/${A}/recommendations/${info.id}`, { as: AGENCE, method: 'PATCH', body: { state: 'ignoree' } })).status).toBe(200);
    expect((await call(`/clients/${A}/analyses/${id}`, { as: AGENCE, method: 'PATCH', body: { clientSummary: 'Synthèse relue.', publish: true } })).status).toBe(200);
    const seen = ((await (await call(`/clients/${A}/analyses`, { as: CLIENT_A })).json()) as any).analyses;
    expect(seen).toHaveLength(1);
    expect(seen[0].summary).toBe('Synthèse relue.');
    expect(seen[0].recommendations).toEqual([expect.objectContaining({ title: 'Arrêter une publicité peu efficace', body: 'Une publicité ne génère aucun rendez-vous.' })]);
    expect(JSON.stringify(seen)).not.toContain('Couper la publicité 11'); // version interne jamais montrée
  });

  it('refuse une réponse hors format et les périodes invalides', async () => {
    const { call } = boot();
    expect((await call(`/clients/${A}/analyses`, { as: AGENCE, method: 'POST', body: { from: to, to: todayParis() } })).status).toBe(400);
    expect((await call(`/clients/${A}/analyses`, { as: AGENCE, method: 'POST', body: { from: '2020-01-01', to: '2020-01-31' } })).status).toBe(409); // pas de chiffres
    const id = await requestAnalysis(call);
    expect((await call(`/robot/clients/${A}/analyses/${id}`, { method: 'PUT', body: RESULT, headers: H })).status).toBe(409); // brief non lu
    await call(`/robot/clients/${A}/analyses/${id}/brief`, { headers: H });
    const seven = { ...RESULT, recommendations: Array(7).fill(RESULT.recommendations[1]) };
    expect((await call(`/robot/clients/${A}/analyses/${id}`, { method: 'PUT', body: seven, headers: H })).status).toBe(400);
    expect((await call(`/robot/clients/${A}/analyses/${id}`, { method: 'PUT', body: { ...RESULT, recommendations: [{ ...RESULT.recommendations[0], severity: 'urgent' }] }, headers: H })).status).toBe(400);
    await call(`/robot/clients/${A}/analyses/${id}/error`, { method: 'POST', body: { message: 'Meta indisponible' }, headers: H });
    expect(((await (await call(`/clients/${A}/analyses`, { as: AGENCE })).json()) as any).analyses[0]).toMatchObject({ status: 'echec', error: 'Meta indisponible' });
  });

  it('réservé à l’agence ; un client ne voit ni ne touche un autre client ; la génération exige sa clé', async () => {
    const { call } = boot();
    expect((await call(`/clients/${A}/analyses`, { as: CLIENT_A, method: 'POST', body: { from, to } })).status).toBe(403);
    expect((await call(`/clients/${A}/analyses`, { as: AGENCE, view: 'client', method: 'POST', body: { from, to } })).status).toBe(403);
    expect((await call(`/clients/${A}/analyses`, { as: CLIENT_B })).status).toBe(404);
    expect((await call('/robot/analyses/queue')).status).toBe(401);
    const id = await requestAnalysis(call);
    expect((await call(`/robot/clients/${B}/analyses/${id}/brief`, { headers: H })).status).toBe(404);
  });
});
