import { describe, expect, it } from 'vitest';
import { syncActiveAds } from '../jobs/sync-daily/src/meta.ts';
import { createMetaClient, type MetaClient } from '../packages/meta/src/index.ts';
import { createTestDb } from './helpers/d1.ts';
import { A, AGENCE, B, CLIENT_A, CLIENT_B, setup } from './helpers/app.ts';

const live = [
  { id: 'ad1', name: 'Pub 1', created_time: '2026-11-10T10:00:00+0100', effective_status: 'ACTIVE', preview_shareable_link: 'https://fb.me/adspreview/ads/abc',
    campaign: { name: 'Campagne 1' }, creative: { thumbnail_url: 'https://scontent.xx.fbcdn.net/t.jpg', title: 'Titre', body: 'Texte', object_type: 'VIDEO', actor_id: '123456789' } },
  { id: 'ad2', name: 'Pub en pause', effective_status: 'PAUSED' },
];
const fake = (rows = live) => ({ activeAds: async () => rows }) as unknown as MetaClient;

describe('Vos publicités : synchro', () => {
  it('garde seulement les publicités actives, remplace la liste et renseigne la page Facebook', async () => {
    const { d1, raw } = createTestDb();
    raw.exec(`INSERT INTO clients (id, name, slug) VALUES ('cl', 'Client', 'cl')`);
    raw.exec(`INSERT INTO meta_ads_live (client_id, ad_id, synced_at) VALUES ('cl', 'ancienne', 'x')`);
    expect(await syncActiveAds(d1, 'cl', 'act_1', fake(), '2026-11-13T05:00:00Z')).toBe(1);
    expect(raw.prepare(`SELECT ad_id, preview_url, page_id FROM meta_ads_live`).all()).toEqual([{ ad_id: 'ad1', preview_url: 'https://fb.me/adspreview/ads/abc', page_id: '123456789' }]);
    expect(raw.prepare(`SELECT facebook_page_id p, ads_live_synced_at s FROM clients`).get()).toEqual({ p: '123456789', s: '2026-11-13T05:00:00Z' });
    // Une page saisie à la main n'est jamais écrasée ; plus aucune publicité active → liste vide.
    raw.exec(`UPDATE clients SET facebook_page_id = '999999'`);
    await syncActiveAds(d1, 'cl', 'act_1', fake([]));
    expect(raw.prepare(`SELECT COUNT(*) n FROM meta_ads_live`).get()).toEqual({ n: 0 });
    expect(raw.prepare(`SELECT facebook_page_id p FROM clients`).get()).toEqual({ p: '999999' });
  });

  it('demande à Meta uniquement les publicités actives, avec visuel et aperçu', async () => {
    const urls: string[] = [];
    const meta = createMetaClient({ token: 't', fetchImpl: (async (u: string) => { urls.push(u); return new Response(JSON.stringify({ data: [] })); }) as any });
    await meta.activeAds('123');
    const u = new URL(urls[0]);
    expect(u.pathname).toMatch(/\/act_123\/ads$/);
    expect(u.searchParams.get('fields')).toContain('preview_shareable_link');
    expect(u.searchParams.get('fields')).toContain('thumbnail_url');
    expect(JSON.parse(u.searchParams.get('filtering')!)).toEqual([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]);
  });
});

describe('Vos publicités : écran', () => {
  it('le client voit ses publicités actives et le lien de la bibliothèque, jamais celles d’un autre client', async () => {
    const { call, raw } = setup();
    raw.prepare(`UPDATE clients SET facebook_page_id = '123456789' WHERE id = ?`).run(B);
    raw.prepare(`INSERT INTO meta_ads_live (client_id, ad_id, name, preview_url, thumbnail_url, synced_at) VALUES (?, 'ad_x', 'Pub X', 'https://fb.me/p', 'https://scontent/t.jpg', '2026-11-13T05:00:00Z')`).run(B);
    const r = (await (await call(`/clients/${B}/publicites`, { as: CLIENT_B })).json()) as any;
    expect(r.libraryUrl).toBe('https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&view_all_page_id=123456789');
    expect(r.ads).toHaveLength(1);
    expect(r.syncedAt).toBeNull(); // jamais lu par la synchro : l'écran le dit, au lieu de « en pause »
    expect(r.ads[0]).toMatchObject({ id: 'ad_x', previewUrl: 'https://fb.me/p', image: 'https://scontent/t.jpg', spendCents: null });
    expect((await call(`/clients/${B}/publicites`, { as: CLIENT_A })).status).toBe(404);
    const a = (await (await call(`/clients/${A}/publicites`, { as: AGENCE })).json()) as any;
    expect(a.ads).toHaveLength(0);
  });

  it('la page Facebook se saisit dans la fiche client (chiffres uniquement)', async () => {
    const { call } = setup();
    expect((await call(`/agence/clients/${B}`, { as: AGENCE, method: 'PATCH', body: { facebookPageId: 'pas-un-id' } })).status).toBe(400);
    expect((await call(`/agence/clients/${B}`, { as: AGENCE, method: 'PATCH', body: { facebookPageId: '1234567890' } })).status).toBe(200);
    const r = (await (await call(`/clients/${B}/publicites`, { as: CLIENT_B })).json()) as any;
    expect(r.libraryUrl).toContain('view_all_page_id=1234567890');
  });
});
