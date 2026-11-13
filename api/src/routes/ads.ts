import { Hono } from 'hono';
import { addDaysYmd, safeDiv, todayParis } from '@obsidian/domain';
import type { AppEnv } from '../env.ts';
import { scopeClient } from '../scope.ts';
import { all, first } from '../db.ts';
import { entityTotals } from '../metrics.ts';

/**
 * Vos publicités (décision 0026) : les publicités actives du client, telles que la synchro Meta les a lues ce matin
 * (visuel, texte, lien d'aperçu), avec leurs chiffres des 30 derniers jours, et le lien vers la bibliothèque publicitaire Meta.
 * Visible du client et de l'agence. Brouillons, publicités en pause ou terminées : jamais affichés.
 */
export const ads = new Hono<AppEnv>();
ads.use('/:clientId/publicites', scopeClient);

/** Bibliothèque publicitaire Meta : publique, sans connexion, publicités actives de la page. */
export const adLibraryUrl = (pageId: string) =>
  `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&view_all_page_id=${encodeURIComponent(pageId)}`;

ads.get('/:clientId/publicites', async (c) => {
  const db = c.env.DB;
  const client = c.get('client');
  const to = addDaysYmd(todayParis(), -1);
  const from = addDaysYmd(to, -29);
  const [rows, conn, totals] = await Promise.all([
    all<{ ad_id: string; name: string | null; campaign_name: string | null; created_time: string | null; object_type: string | null; title: string | null;
      body: string | null; thumbnail_url: string | null; image_url: string | null; preview_url: string | null; synced_at: string }>(db,
      'SELECT * FROM meta_ads_live WHERE client_id = ?1 ORDER BY created_time DESC', client.id),
    first<{ token: number }>(db, `SELECT token_ciphertext IS NOT NULL AS token FROM connections WHERE client_id = ?1 AND type = 'meta'`, client.id),
    entityTotals(db, client.id, 'ad', from, to),
  ]);
  const byAd = new Map(totals.map((t) => [t.entity_id, t]));
  return c.json({
    libraryUrl: client.facebook_page_id ? adLibraryUrl(client.facebook_page_id) : null,
    synced: Boolean(conn?.token),
    syncedAt: rows[0]?.synced_at ?? null,
    period: { from, to },
    ads: rows.map((r) => {
      const t = byAd.get(r.ad_id);
      return {
        id: r.ad_id, name: r.name, campaign: r.campaign_name, createdTime: r.created_time, format: r.object_type,
        title: r.title, body: r.body, image: r.image_url || r.thumbnail_url, previewUrl: r.preview_url,
        spendCents: t ? t.spend_cents : null, leads: t ? t.leads : null, costPerLeadCents: t ? safeDiv(t.spend_cents, t.leads) : null,
      };
    }),
  });
});
