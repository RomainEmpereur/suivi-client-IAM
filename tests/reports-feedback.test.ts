import { describe, expect, it } from 'vitest';
import { addDaysYmd, todayParis } from '../packages/domain/src/index.ts';
import { reportBounds } from '../api/src/routes/reports.ts';
import { A, AGENCE, B, CLIENT_A, CLIENT_B, setup } from './helpers/app.ts';

const lastWeekDay = addDaysYmd(todayParis(), -7);

describe('Rapport de période', () => {
  it('bornes : semaine lundi → dimanche, mois civil, et la période précédente', () => {
    expect(reportBounds('semaine', '2026-11-11')).toEqual({ start: '2026-11-09', end: '2026-11-15', prevStart: '2026-11-02', prevEnd: '2026-11-08' });
    expect(reportBounds('mois', '2026-03-15')).toEqual({ start: '2026-03-01', end: '2026-03-31', prevStart: '2026-02-01', prevEnd: '2026-02-28' });
  });

  it("l'agence génère un rapport figé, pré-remplit l'analyse, puis le publie ; le client ne voit que les rapports publiés", async () => {
    const { call, raw } = setup();
    const r = await call(`/clients/${A}/reports`, { as: AGENCE, method: 'POST', body: { periodType: 'semaine', day: lastWeekDay } });
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as any;
    expect((await call(`/clients/${A}/reports`, { as: AGENCE, method: 'POST', body: { periodType: 'semaine', day: lastWeekDay } })).status).toBe(409);
    const rep = ((await (await call(`/clients/${A}/reports`, { as: AGENCE })).json()) as any).reports[0];
    expect(rep.snapshot.rows.map((x: any) => x.label)).toEqual(['Dépense publicitaire', 'Clics', 'Leads', 'Nouveaux contacts', 'Rendez-vous pris', 'Rendez-vous honorés', 'Ventes', 'Encaissé']);
    const spend = rep.snapshot.rows[0].current;
    expect(spend).toBeGreaterThan(0);
    // Figé : les chiffres qui changent ensuite ne modifient pas le rapport.
    raw.prepare(`UPDATE metrics_rollup SET spend_cents = spend_cents * 10 WHERE client_id = ?`).run(A);
    const again = ((await (await call(`/clients/${A}/reports`, { as: AGENCE })).json()) as any).reports[0];
    expect(again.snapshot.rows[0].current).toBe(spend);
    expect(((await (await call(`/clients/${A}/reports`, { as: CLIENT_A })).json()) as any).reports).toEqual([]);
    expect((await call(`/clients/${A}/reports/${id}`, { as: AGENCE, method: 'PATCH', body: { comment: 'Semaine solide.', publish: true } })).status).toBe(200);
    const seen = ((await (await call(`/clients/${A}/reports`, { as: CLIENT_A })).json()) as any).reports;
    expect(seen).toEqual([expect.objectContaining({ id, comment: 'Semaine solide.' })]);
    expect((await call(`/clients/${A}/reports/${id}`, { as: AGENCE, method: 'DELETE' })).status).toBe(409);
  });

  it('réservé à l’agence pour la génération ; isolation entre clients', async () => {
    const { call } = setup();
    expect((await call(`/clients/${A}/reports`, { as: CLIENT_A, method: 'POST', body: { periodType: 'mois', day: lastWeekDay } })).status).toBe(403);
    expect((await call(`/clients/${A}/reports`, { as: CLIENT_B })).status).toBe(404);
    expect((await call(`/clients/${A}/reports`, { as: AGENCE, method: 'POST', body: { periodType: 'annee', day: lastWeekDay } })).status).toBe(400);
  });
});

describe('Feedback', () => {
  it('le client envoie un retour : contexte joint pour l’agence, invisible pour le client ; l’agence répond', async () => {
    const { call } = setup();
    const r = await call(`/clients/${B}/feedback`, { as: CLIENT_B, method: 'POST', body: { category: 'resultat', severity: 'haute', body: 'Peu de rendez-vous cette semaine.', links: ['https://exemple.fr/capture.png'] } });
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as any;
    const agency = ((await (await call(`/clients/${B}/feedback`, { as: AGENCE })).json()) as any).feedback.find((f: any) => f.id === id);
    expect(agency.context.period).toBeTruthy();
    expect(Array.isArray(agency.context.connections)).toBe(true);
    const mine = ((await (await call(`/clients/${B}/feedback`, { as: CLIENT_B })).json()) as any).feedback.find((f: any) => f.id === id);
    expect(mine.context).toBeUndefined();
    expect(mine.attachments).toEqual([{ url: 'https://exemple.fr/capture.png' }]);
    expect((await call(`/clients/${B}/feedback/${id}`, { as: AGENCE, method: 'PATCH', body: { reply: 'On ajuste les audiences demain.' } })).status).toBe(200);
    const after = ((await (await call(`/clients/${B}/feedback`, { as: CLIENT_B })).json()) as any).feedback.find((f: any) => f.id === id);
    expect(after).toMatchObject({ status: 'en_cours', reply: 'On ajuste les audiences demain.' });
    const console = (await (await call('/agence/console', { as: AGENCE })).json()) as any;
    expect(console.feedbackThemes.find((t: any) => t.category === 'resultat')).toMatchObject({ recent: 1, open: 1 });
  });

  it('refuse les retours invalides ; l’agence ne crée pas de retour ; le client ne répond pas', async () => {
    const { call } = setup();
    expect((await call(`/clients/${B}/feedback`, { as: CLIENT_B, method: 'POST', body: { category: 'autre', body: 'xxxxxx' } })).status).toBe(400);
    expect((await call(`/clients/${B}/feedback`, { as: CLIENT_B, method: 'POST', body: { category: 'bug', body: 'Lien', links: ['http://x.fr'] } })).status).toBe(400);
    expect((await call(`/clients/${B}/feedback`, { as: AGENCE, method: 'POST', body: { category: 'bug', body: 'Bug constaté' } })).status).toBe(403);
    expect((await call(`/clients/${A}/feedback/fb_${A}_1`, { as: CLIENT_A, method: 'PATCH', body: { status: 'resolu' } })).status).toBe(403);
    expect((await call(`/clients/${A}/feedback`, { as: CLIENT_B })).status).toBe(404);
  });
});
