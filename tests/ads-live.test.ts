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

describe('Vos publicités : historique sur une période', () => {
  const testKey = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

  it('liste les publicités qui ont dépensé, lit leurs visuels dans Meta (lecture seule) et les garde en cache', async () => {
    const { encryptToken } = await import('../api/src/crypto.ts');
    const { vi } = await import('vitest');
    const key = testKey();
    const { call, raw } = setup({ TOKEN_ENCRYPTION_KEY: key });
    raw.prepare(`UPDATE connections SET token_ciphertext = ?, external_id = 'act_1' WHERE client_id = ? AND type = 'meta'`).run(await encryptToken('jeton-meta-test', key), A);
    const today = new Date(); const y = new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10);
    const from = new Date(today.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
    const ids = (raw.prepare(`SELECT DISTINCT entity_id FROM metrics_rollup WHERE client_id = ? AND level = 'ad' AND spend_cents > 0 AND period_start BETWEEN ? AND ?`).all(A, from, y) as any[])
      .map((r) => r.entity_id).filter((i) => /^\d+$/.test(i));
    expect(ids.length).toBeGreaterThan(0);
    const calls: { url: string; method: string }[] = [];
    const fetchMock = vi.fn(async (u: string, init?: RequestInit) => {
      calls.push({ url: u, method: init?.method ?? 'GET' });
      const asked = new URL(u).searchParams.get('ids')!.split(',');
      return new Response(JSON.stringify(Object.fromEntries(asked.map((id, i) => [id, {
        id, name: `Pub ${id}`, effective_status: i === 0 ? 'PAUSED' : 'ARCHIVED', preview_shareable_link: `https://fb.me/${id}`,
        creative: { thumbnail_url: `https://scontent/${id}.jpg`, object_type: 'VIDEO' },
      }]))));
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const r1 = await call(`/clients/${A}/publicites?from=${from}&to=${y}`, { as: CLIENT_A });
      expect(r1.status).toBe(200);
      const d = (await r1.json()) as any;
      expect(d.mode).toBe('periode');
      expect(d.ads.length).toBe(Math.min(ids.length, 60));
      expect(d.ads.every((a: any) => a.previewUrl?.startsWith('https://fb.me/') && a.status && a.spendCents > 0)).toBe(true);
      // Meilleurs résultats d'abord.
      for (let i = 1; i < d.ads.length; i++) expect((d.ads[i - 1].leads ?? 0) >= (d.ads[i].leads ?? 0)).toBe(true);
      expect(calls.every((c) => c.method === 'GET' && c.url.startsWith('https://graph.facebook.com/'))).toBe(true);
      const n = calls.length;
      // Deuxième ouverture : tout vient du cache.
      await call(`/clients/${A}/publicites?from=${from}&to=${y}`, { as: CLIENT_A });
      expect(calls.length).toBe(n);
    } finally { vi.unstubAllGlobals(); }
  });

  it('Meta injoignable : les chiffres restent, avec un avertissement ; période invalide refusée', async () => {
    const { encryptToken } = await import('../api/src/crypto.ts');
    const { vi } = await import('vitest');
    const key = testKey();
    const { call, raw } = setup({ TOKEN_ENCRYPTION_KEY: key });
    raw.prepare(`UPDATE connections SET token_ciphertext = ?, external_id = 'act_1' WHERE client_id = ? AND type = 'meta'`).run(await encryptToken('jeton-meta-test', key), A);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"code":190}}', { status: 401 })));
    try {
      const y = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const d = (await (await call(`/clients/${A}/publicites?from=${from}&to=${y}`, { as: AGENCE })).json()) as any;
      expect(d.fetchError).toBeTruthy();
      expect(d.ads.length).toBeGreaterThan(0);
      expect(d.ads[0].image).toBeNull();
      expect((await call(`/clients/${A}/publicites?from=2026-10-10&to=2026-09-01`, { as: AGENCE })).status).toBe(400);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('Vos publicités : lecture Meta par identifiants', () => {
  it('une publicité supprimée (code 100) est relue seule ; une erreur d’accès est remontée', async () => {
    let n = 0;
    const meta = createMetaClient({ token: 't', maxAttempts: 1, fetchImpl: (async (u: string) => {
      n++;
      const url = new URL(u);
      if (url.searchParams.get('ids')) return new Response('{"error":{"code":100}}', { status: 400 });
      if (url.pathname.endsWith('/111')) return new Response(JSON.stringify({ id: '111', effective_status: 'PAUSED' }));
      return new Response('{"error":{"code":100}}', { status: 400 });
    }) as any });
    const r = await meta.adsByIds(['111', '222']);
    expect(Object.keys(r)).toEqual(['111']);
    expect(n).toBe(3);
    const denied = createMetaClient({ token: 't', maxAttempts: 1, fetchImpl: (async () => new Response('{"error":{"code":190}}', { status: 401 })) as any });
    await expect(denied.adsByIds(['111'])).rejects.toThrow();
  });
});
