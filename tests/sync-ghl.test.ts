import { describe, expect, it } from 'vitest';
import { syncGhl } from '../jobs/sync-daily/src/ghl.ts';
import type { GhlClient } from '../packages/ghl/src/index.ts';
import { createTestDb } from './helpers/d1.ts';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const config = {
  locationId: 'loc', pipelineIds: ['p1'], displayPipelineId: 'p1', calendarIds: ['cal'],
  postCallStageIds: ['s_post'], noShowStageIds: ['s_ns'], wonStageIds: ['s_won'], testTitlePrefixes: ['Test interne'],
};
const opps = [
  { id: 'o1', contactId: 'c1', pipelineId: 'p1', pipelineStageId: 's_post', status: 'open', createdAt: '2026-11-02T09:00:00Z',
    attributions: [{ utmAdId: 'ad1', utmCampaignId: 'camp1', utmCampaign: 'Campagne 1' }] },
  { id: 'o2', contactId: 'c2', pipelineId: 'p1', pipelineStageId: 's_won', status: 'won', createdAt: '2026-11-03T09:00:00Z', lastStageChangeAt: '2026-11-08T09:00:00Z', source: 'Site' },
  { id: 'o3', contactId: 'c3', pipelineId: 'p1', pipelineStageId: 's_ns', status: 'open', createdAt: '2026-11-04T09:00:00Z', attributions: [{ utmCampaignId: 'camp1' }] },
];
const events = [
  { id: 'e1', contactId: 'c1', calendarId: 'cal', startTime: '2026-11-05T10:00:00+01:00', dateAdded: '2026-11-02T10:00:00Z', appointmentStatus: 'confirmed', title: 'Jean Dupont - Découverte' },
  { id: 'e2', contactId: 'c3', calendarId: 'cal', startTime: '2026-11-06T10:00:00+01:00', dateAdded: '2026-11-04T10:00:00Z', appointmentStatus: 'confirmed', title: 'Paul Martin - Découverte' },
  { id: 'e3', contactId: 'c9', calendarId: 'cal', startTime: '2026-11-07T10:00:00+01:00', dateAdded: '2026-11-04T11:00:00Z', appointmentStatus: 'cancelled', title: 'Test interne - essai' },
  { id: 'e4', contactId: 'c2', calendarId: 'cal', startTime: '2026-11-20T10:00:00+01:00', dateAdded: '2026-11-10T11:00:00Z', appointmentStatus: 'confirmed', title: 'Zoé L - Découverte' },
];
const fake = {
  opportunities: async () => opps, events: async () => events,
  pipelines: async () => ({ pipelines: [{ id: 'p1', name: 'P', stages: [{ id: 's_post', name: 'Après appel', position: 1 }, { id: 's_ns', name: 'No-show', position: 0 }] }] }),
} as unknown as GhlClient;

function db() {
  const { d1, raw } = createTestDb();
  raw.exec(`INSERT INTO clients (id, name, slug) VALUES ('cl', 'Client', 'cl')`);
  // Une ligne Meta existante : la synchro GHL ne doit pas toucher à la dépense.
  raw.exec(`INSERT INTO metrics_daily (client_id, date, ad_id, campaign_id, adset_id, spend_cents, impressions, crm_contacts, source)
            VALUES ('cl', '2026-11-02', 'ad1', 'camp1', 'as1', 4200, 1000, 99, 'meta')`);
  return { d1, raw };
}
const W = { from: '2026-10-12', to: '2026-11-10' };
const totals = (raw: any) => raw.prepare(`SELECT SUM(spend_cents) s, SUM(crm_contacts) c, SUM(appointments_booked) b, SUM(appointments_held) h, SUM(sales) v FROM metrics_daily WHERE client_id = 'cl'`).get();

describe('Synchronisation GoHighLevel', () => {
  it('écrit contacts, RDV, ventes par publicité sans toucher à la dépense, et reste idempotente', async () => {
    const { d1, raw } = db();
    const r = await syncGhl(d1, 'cl', config, fake, W, NOW);
    expect(r.statuses).toEqual({ honore: 1, absent: 1, annule: 1, prevu: 1 });
    const t1 = totals(raw);
    expect(t1).toEqual({ s: 4200, c: 3, b: 3, h: 1, v: 1 }); // 99 contacts « anciens » remis à zéro ; test exclu
    expect(raw.prepare(`SELECT crm_contacts, appointments_booked, spend_cents FROM metrics_daily WHERE ad_id = 'ad1'`).get())
      .toEqual({ crm_contacts: 1, appointments_booked: 1, spend_cents: 4200 });
    await syncGhl(d1, 'cl', config, fake, W, NOW);
    expect(totals(raw)).toEqual(t1);
    expect((raw.prepare(`SELECT COUNT(*) n FROM appointments`).get() as any).n).toBe(4);
    const rollup = raw.prepare(`SELECT SUM(spend_cents) s, SUM(appointments_booked) b FROM metrics_rollup WHERE level = 'client'`).get();
    expect(rollup).toEqual({ s: 4200, b: 3 });
    const pipe = raw.prepare(`SELECT stage_name, open_opportunities FROM pipeline_snapshot ORDER BY stage_order`).all();
    expect(pipe).toEqual([{ stage_name: 'No-show', open_opportunities: 1 }, { stage_name: 'Après appel', open_opportunities: 1 }]);
  });

  it("ne remplace jamais un statut posé par l'agence", async () => {
    const { d1, raw } = db();
    await syncGhl(d1, 'cl', config, fake, W, NOW);
    raw.exec(`UPDATE appointments SET status = 'honore', status_source = 'agence' WHERE ghl_appointment_id = 'e2'`);
    await syncGhl(d1, 'cl', config, fake, W, NOW);
    expect((raw.prepare(`SELECT status FROM appointments WHERE ghl_appointment_id = 'e2'`).get() as any).status).toBe('honore');
  });

  it('les noms sont réduits au prénom et à une initiale', async () => {
    const { d1, raw } = db();
    await syncGhl(d1, 'cl', config, fake, W, NOW);
    expect((raw.prepare(`SELECT contact_name FROM appointments WHERE ghl_appointment_id = 'e1'`).get() as any).contact_name).toBe('Jean D.');
  });
});

describe('Atomicité', () => {
  it("une erreur pendant l'écriture ne laisse aucune trace (tout ou rien)", async () => {
    const { d1, raw } = db();
    const before = totals(raw);
    // On fait échouer la transaction : le pipeline affiché renvoie une étape sans nom (contrainte NOT NULL).
    const broken = { ...fake, pipelines: async () => ({ pipelines: [{ id: 'p1', name: 'P', stages: [{ id: 's_post', name: null, position: 1 }] }] }) } as any;
    await expect(syncGhl(d1, 'cl', config, broken, W, NOW)).rejects.toThrow();
    expect(totals(raw)).toEqual(before);
    expect((raw.prepare('SELECT COUNT(*) n FROM appointments').get() as any).n).toBe(0);
  });
});
