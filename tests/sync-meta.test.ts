import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { syncMeta, minorUnits, rateFor } from '../jobs/sync-daily/src/meta.ts';
import { createMetaClient, type MetaClient, type MetaInsightRow } from '../packages/meta/src/index.ts';
import { createTestDb } from './helpers/d1.ts';

// Le total « lead » et le pixel (visites de page) sont ignorés : seuls les prospects des formulaires comptent.
const act = (lead: number, lpv: number) => [
  { action_type: 'lead', value: String(lead + 7) }, { action_type: 'offsite_conversion.fb_pixel_lead', value: '7' },
  { action_type: 'onsite_conversion.lead_grouped', value: String(lead) }, { action_type: 'landing_page_view', value: String(lpv) },
];
const adRows: MetaInsightRow[] = [
  { date_start: '2026-11-02', date_stop: '2026-11-02', ad_id: 'ad1', ad_name: 'Pub 1', campaign_id: 'camp1', campaign_name: 'Campagne 1', adset_id: 'as1',
    spend: '30.10', impressions: '1000', inline_link_clicks: '20', frequency: '1.2', actions: act(2, 15) },
  { date_start: '2026-11-02', date_stop: '2026-11-02', ad_id: 'ad2', ad_name: 'Pub 2', campaign_id: 'camp1', campaign_name: 'Campagne 1', adset_id: 'as1',
    spend: '10.00', impressions: '400', inline_link_clicks: '5', actions: act(0, 3) },
  { date_start: '2026-11-03', date_stop: '2026-11-03', ad_id: 'ad1', ad_name: 'Pub 1', campaign_id: 'camp1', campaign_name: 'Campagne 1', adset_id: 'as1',
    spend: '20.00', impressions: '800', inline_link_clicks: '10', actions: act(1, 8) },
];
// Le compte a dépensé 5 € de plus le 2 (publicité supprimée que Meta ne détaille plus).
const accRows: MetaInsightRow[] = [
  { date_start: '2026-11-02', date_stop: '2026-11-02', spend: '45.10', impressions: '1600', inline_link_clicks: '27', actions: act(3, 18) },
  { date_start: '2026-11-03', date_stop: '2026-11-03', spend: '20.00', impressions: '800', inline_link_clicks: '10', actions: act(1, 8) },
];
const fake = (currency = 'EUR', ads = adRows, acc = accRows) => ({
  adAccount: async () => ({ id: 'act_1', name: 'Compte', currency, timezone_name: 'Europe/Paris', account_status: 1 }),
  adInsightsDaily: async () => ads, accountInsightsDaily: async () => acc,
  campaigns: async () => [{ id: 'camp1', name: 'Campagne 1', daily_budget: '5000' }], ads: async () => [{ id: 'ad1', effective_status: 'ACTIVE' }],
}) as unknown as MetaClient;

function db() {
  const { d1, raw } = createTestDb();
  raw.exec(`INSERT INTO clients (id, name, slug) VALUES ('cl', 'Client', 'cl')`);
  // Ancien import ponctuel par campagne (sera remplacé) et chiffres CRM déjà synchronisés sur ad1 (conservés).
  raw.exec(`INSERT INTO metrics_daily (client_id, date, ad_id, campaign_id, adset_id, spend_cents, impressions, leads, source)
            VALUES ('cl', '2026-11-02', 'campagne:camp1', 'camp1', '', 4000, 1400, 2, 'mcp')`);
  raw.exec(`INSERT INTO metrics_daily (client_id, date, ad_id, campaign_id, adset_id, crm_contacts, appointments_booked, source)
            VALUES ('cl', '2026-11-02', 'ad1', 'camp1', '', 3, 1, 'ghl')`);
  return { d1, raw };
}
const W = { from: '2026-11-01', to: '2026-11-03' };
const clientTotal = (raw: any) => raw.prepare(`SELECT SUM(spend_cents) s, SUM(impressions) i, SUM(leads) l, SUM(landing_page_views) v, SUM(crm_contacts) c FROM metrics_rollup WHERE client_id = 'cl' AND level = 'client'`).get();

describe('Synchronisation Meta', () => {
  it('écrit par publicité et par jour, rapproche du total du compte, garde le CRM, remplace l’import ponctuel', async () => {
    const { d1, raw } = db();
    const r = await syncMeta(d1 as any, 'cl', 'act_1', fake(), W);
    expect(r).toMatchObject({ rows: 4, spendEurCents: 6510, residualDays: 1, currency: 'EUR' });
    // Total identique au compte, au centime.
    expect(clientTotal(raw)).toEqual({ s: 6510, i: 2400, l: 4, v: 26, c: 3 });
    const ad1 = raw.prepare(`SELECT * FROM metrics_daily WHERE client_id = 'cl' AND date = '2026-11-02' AND ad_id = 'ad1'`).get() as any;
    expect(ad1).toMatchObject({ spend_cents: 3010, leads: 2, crm_contacts: 3, appointments_booked: 1, ad_status: 'ACTIVE', ad_name: 'Pub 1', source: 'meta' });
    expect(raw.prepare(`SELECT COUNT(*) n FROM metrics_daily WHERE ad_id = 'campagne:camp1'`).get()).toEqual({ n: 0 });
    const res = raw.prepare(`SELECT * FROM metrics_daily WHERE ad_id = 'campagne:supprimees'`).get() as any;
    expect(res).toMatchObject({ date: '2026-11-02', spend_cents: 500, impressions: 200, leads: 1, campaign_name: 'Campagnes supprimées ou archivées' });
    // Plus de ligne de rollup pour l'ancienne entité « campagne:camp1 » au niveau publicité.
    expect(raw.prepare(`SELECT COUNT(*) n FROM metrics_rollup WHERE level = 'ad' AND entity_id = 'campagne:camp1'`).get()).toEqual({ n: 0 });
  });

  it('est idempotente', async () => {
    const { d1, raw } = db();
    await syncMeta(d1 as any, 'cl', 'act_1', fake(), W);
    const first = raw.prepare('SELECT * FROM metrics_daily ORDER BY date, ad_id').all().map((x: any) => ({ ...x, updated_at: null, created_at: null }));
    await syncMeta(d1 as any, 'cl', 'act_1', fake(), W);
    const second = raw.prepare('SELECT * FROM metrics_daily ORDER BY date, ad_id').all().map((x: any) => ({ ...x, updated_at: null, created_at: null }));
    expect(second).toEqual(first);
  });

  it('convertit une autre devise en euros au taux du jour (dernier taux publié)', async () => {
    const { d1, raw } = db();
    const fx = async () => new Map([['2026-10-31', 40], ['2026-11-03', 50]]);
    await syncMeta(d1 as any, 'cl', 'act_1', fake('THB'), W, { fx });
    const ad1 = raw.prepare(`SELECT spend_cents, spend_original_minor, currency FROM metrics_daily WHERE date = '2026-11-02' AND ad_id = 'ad1'`).get();
    expect(ad1).toEqual({ spend_cents: 75, spend_original_minor: 3010, currency: 'THB' }); // 30,10 THB ÷ 40
    expect(raw.prepare(`SELECT ad_account_currency c FROM clients WHERE id = 'cl'`).get()).toEqual({ c: 'THB' });
  });

  it("n'écrit rien si les publicités dépassent le total du compte", async () => {
    const { d1, raw } = db();
    const acc = [{ ...accRows[0], spend: '1.00' }, accRows[1]];
    await expect(syncMeta(d1 as any, 'cl', 'act_1', fake('EUR', adRows, acc), W)).rejects.toThrow(/Contrôle Meta échoué/);
    expect(raw.prepare(`SELECT COUNT(*) n FROM metrics_daily WHERE source = 'mcp'`).get()).toEqual({ n: 1 });
  });

  it('outils : montants exacts et taux de change', () => {
    expect(minorUnits('12.3')).toBe(1230);
    expect(minorUnits('0.07')).toBe(7);
    expect(minorUnits('1530')).toBe(153000);
    expect(rateFor(new Map([['2026-11-01', 38]]), '2026-11-04')).toBe(38);
    expect(() => rateFor(new Map([['2026-11-05', 38]]), '2026-11-04')).toThrow();
  });
});

describe('Client Meta : lecture seule', () => {
  it("n'émet que des GET vers graph.facebook.com, jeton en en-tête et jamais dans l'URL", async () => {
    const calls: { url: string; method: string; auth: string }[] = [];
    const f = async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method!, auth: (init.headers as Record<string, string>).Authorization });
      return new Response(JSON.stringify({ data: [], paging: {} }), { status: 200 });
    };
    const m = createMetaClient({ token: 'JETON', fetchImpl: f as any });
    await m.adInsightsDaily('123', '2026-11-01', '2026-11-02');
    await m.campaigns('act_123');
    expect(calls.every((c) => c.method === 'GET' && c.url.startsWith('https://graph.facebook.com/') && !c.url.includes('JETON') && c.auth === 'Bearer JETON')).toBe(true);
    expect(calls[0].url).toContain('/act_123/insights');
    expect(calls[0].url).toContain('DELETED');
  });
  it("le module n'expose aucune écriture", () => {
    const src = readFileSync(resolve(__dirname, '../packages/meta/src/index.ts'), 'utf8');
    expect(src).not.toMatch(/method:\s*'(POST|PUT|DELETE|PATCH)'/);
    expect(Object.keys(createMetaClient({ token: 'x' })).sort()).toEqual(['accessibleAccounts', 'accountInsightsDaily', 'adAccount', 'adInsightsDaily', 'ads', 'campaigns']);
  });
});
