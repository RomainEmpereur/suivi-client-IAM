import { describe, expect, it } from 'vitest';
import { A, AGENCE, B, CLIENT_A, CLIENT_B, setup } from './helpers/app.ts';

describe('Tableau de bord (données de démo)', () => {
  const { call, raw } = setup();

  it('les totaux proviennent du rollup et correspondent à metrics_daily', async () => {
    const json = await (await call(`/clients/${A}/dashboard?days=30`, { as: CLIENT_A })).json() as any;
    const { from, to } = json.period;
    const direct = raw.prepare('SELECT SUM(spend_cents) AS s FROM metrics_daily WHERE client_id = ? AND date BETWEEN ? AND ?').get(A, from, to) as { s: number };
    expect(json.current.totals.spend_cents).toBe(direct.s);
    expect(json.series).toHaveLength(30);
    expect(json.lastSync).toBeTruthy();
  });

  it("un client sans données a des totaux null (« — »), pas des zéros", async () => {
    const json = await (await call(`/clients/${B}/dashboard`, { as: CLIENT_B })).json() as any;
    expect(json.current).toBeNull();
    expect(json.series.every((d: any) => d.spend_cents === null)).toBe(true);
    expect(json.counter.started).toBe(false);
  });

  it('le compteur du tableau de bord égale le comptage direct en base', async () => {
    const json = await (await call(`/clients/${A}/dashboard`, { as: CLIENT_A })).json() as any;
    const direct = raw.prepare(`SELECT COUNT(*) AS n FROM appointments WHERE client_id = ? AND status = 'honore' AND counts_toward_target = 1`).get(A) as { n: number };
    expect(json.counter.validated).toBe(direct.n);
  });

  it('la console agence signale en rouge une connexion cassée', async () => {
    const json = await (await call('/agence/console', { as: AGENCE })).json() as any;
    const pilotis = json.rows.find((r: any) => r.id === B);
    expect(pilotis.red).toBe(true);
    expect(pilotis.redReasons).toContain('Connexion cassée');
    expect(json.rows[0].red).toBe(true);
  });
});

describe('Mesures non synchronisées', () => {
  it("l'API signale les indicateurs qu'aucune source ne fournit (affichés « — », pas 0)", async () => {
    const { call, raw } = setup();
    raw.prepare(`UPDATE clients SET unmeasured_json = '["cash_collected_cents"]' WHERE id = ?`).run(A);
    const json = await (await call(`/clients/${A}/dashboard`, { as: CLIENT_A })).json() as any;
    expect(json.unmeasured).toEqual(['cash_collected_cents']);
  });

  it("pas de bandeau d'avancement pour un client sans chaîne de production suivie", async () => {
    const { call, raw } = setup();
    raw.prepare('DELETE FROM phases WHERE client_id = ?').run(B);
    const json = await (await call(`/clients/${B}`, { as: CLIENT_B })).json() as any;
    expect(json.progress).toBeNull();
  });
});
