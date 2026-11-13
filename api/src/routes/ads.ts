import { Hono } from 'hono';
import { addDaysYmd, safeDiv, todayParis } from '@obsidian/domain';
import type { AppEnv, Bindings } from '../env.ts';
import { scopeClient } from '../scope.ts';
import { all, first } from '../db.ts';
import { HttpError } from '../errors.ts';
import { entityTotals } from '../metrics.ts';
import { decryptToken } from '../crypto.ts';
import { createMetaClient, type MetaLiveAd } from '../../../packages/meta/src/index.ts';

/**
 * Vos publicités (décision 0026), visible du client et de l'agence.
 * - « En ce moment » : les publicités actives, lues par la synchro Meta (table meta_ads_live).
 * - Une période (from, to) : les publicités qui ont dépensé sur la période, quel que soit leur statut aujourd'hui, avec leurs chiffres
 *   sur la période. Visuels lus dans Meta à la demande (lecture seule), gardés en cache (meta_ad_creatives).
 * Rien n'est jamais activé ni modifié dans Meta.
 */
export const ads = new Hono<AppEnv>();
ads.use('/:clientId/publicites', scopeClient);

/** Bibliothèque publicitaire Meta : publique, sans connexion, publicités actives de la page. */
export const adLibraryUrl = (pageId: string) =>
  `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&view_all_page_id=${encodeURIComponent(pageId)}`;

const MAX_ADS = 60;
const STALE_MS = 2 * 86_400_000;
const isYmd = (v: string | undefined) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)));

interface CreativeRow {
  ad_id: string; name: string | null; campaign_name: string | null; created_time: string | null; effective_status: string | null; object_type: string | null;
  title: string | null; body: string | null; thumbnail_url: string | null; image_url: string | null; preview_url: string | null; fetched_at: string;
}

/** Visuels manquants ou périmés : lus dans Meta (lecture seule) et mis en cache. Échec → on garde le cache, sans bloquer l'écran. */
async function refreshCreatives(env: Bindings, clientId: string, ids: string[], cached: Map<string, CreativeRow>) {
  const now = Date.now();
  const todo = ids.filter((id) => { const r = cached.get(id); return !r || now - Date.parse(r.fetched_at) > STALE_MS; });
  if (!todo.length) return { fetched: 0, error: null as string | null };
  const conn = await first<{ external_id: string | null; token_ciphertext: string | null }>(env.DB,
    `SELECT external_id, token_ciphertext FROM connections WHERE client_id = ?1 AND type = 'meta'`, clientId);
  if (!conn?.token_ciphertext || !env.TOKEN_ENCRYPTION_KEY) return { fetched: 0, error: null };
  let found: Record<string, MetaLiveAd>;
  try {
    const meta = createMetaClient({ token: await decryptToken(conn.token_ciphertext, env.TOKEN_ENCRYPTION_KEY), maxAttempts: 2 });
    found = await meta.adsByIds(todo);
  } catch (e) {
    return { fetched: 0, error: e instanceof Error ? e.message : 'Lecture Meta impossible' };
  }
  const fetchedAt = new Date().toISOString();
  const rows = todo.map((id) => {
    const a = found[id];
    return {
      ad_id: id, name: a?.name ?? cached.get(id)?.name ?? null, campaign_name: a?.campaign?.name ?? null, created_time: a?.created_time ?? null,
      effective_status: a?.effective_status ?? null, object_type: a?.creative?.object_type ?? null, title: a?.creative?.title ?? null,
      body: a?.creative?.body ?? null, thumbnail_url: a?.creative?.thumbnail_url ?? null, image_url: a?.creative?.image_url ?? null,
      preview_url: a?.preview_shareable_link ?? null, fetched_at: fetchedAt,
    };
  });
  await env.DB.prepare(`INSERT INTO meta_ad_creatives (client_id, ad_id, name, campaign_name, created_time, effective_status, object_type, title, body, thumbnail_url, image_url, preview_url, fetched_at)
    SELECT ?1, j.value ->> '$.ad_id', j.value ->> '$.name', j.value ->> '$.campaign_name', j.value ->> '$.created_time', j.value ->> '$.effective_status',
      j.value ->> '$.object_type', j.value ->> '$.title', j.value ->> '$.body', j.value ->> '$.thumbnail_url', j.value ->> '$.image_url',
      j.value ->> '$.preview_url', j.value ->> '$.fetched_at' FROM json_each(?2) AS j WHERE true
    ON CONFLICT (client_id, ad_id) DO UPDATE SET name = excluded.name, campaign_name = excluded.campaign_name, created_time = excluded.created_time,
      effective_status = excluded.effective_status, object_type = excluded.object_type, title = excluded.title, body = excluded.body,
      thumbnail_url = excluded.thumbnail_url, image_url = excluded.image_url, preview_url = excluded.preview_url, fetched_at = excluded.fetched_at`)
    .bind(clientId, JSON.stringify(rows)).run();
  for (const r of rows) cached.set(r.ad_id, r);
  return { fetched: rows.length, error: null };
}

ads.get('/:clientId/publicites', async (c) => {
  const db = c.env.DB;
  const client = c.get('client');
  const qFrom = c.req.query('from');
  const qTo = c.req.query('to');
  const history = Boolean(qFrom || qTo);
  const yesterday = addDaysYmd(todayParis(), -1);
  let from = addDaysYmd(yesterday, -29);
  let to = yesterday;
  if (history) {
    if (!isYmd(qFrom) || !isYmd(qTo) || qFrom! > qTo!) throw new HttpError(400, 'Période invalide (AAAA-MM-JJ, début avant fin).');
    from = qFrom!; to = qTo! > yesterday ? yesterday : qTo!;
    if (Date.parse(to) - Date.parse(from) > 400 * 86_400_000) throw new HttpError(400, 'Période trop longue (400 jours au plus).');
  }
  const conn = await first<{ token: number }>(db, `SELECT token_ciphertext IS NOT NULL AS token FROM connections WHERE client_id = ?1 AND type = 'meta'`, client.id);
  const totals = from <= to ? await entityTotals(db, client.id, 'ad', from, to) : [];
  const byAd = new Map(totals.map((t) => [t.entity_id, t]));
  const metrics = (id: string) => {
    const t = byAd.get(id);
    return { spendCents: t ? t.spend_cents : null, leads: t ? t.leads : null, costPerLeadCents: t ? safeDiv(t.spend_cents, t.leads) : null };
  };
  const base = {
    libraryUrl: client.facebook_page_id ? adLibraryUrl(client.facebook_page_id) : null,
    synced: Boolean(conn?.token), period: { from, to }, mode: history ? 'periode' : 'actives',
  };

  if (!history) {
    const rows = await all<CreativeRow & { synced_at: string }>(db, 'SELECT * FROM meta_ads_live WHERE client_id = ?1 ORDER BY created_time DESC', client.id);
    return c.json({
      ...base, syncedAt: client.ads_live_synced_at ?? null, truncated: 0, fetchError: null,
      ads: rows.map((r) => ({
        id: r.ad_id, name: r.name, campaign: r.campaign_name, createdTime: r.created_time, format: r.object_type, status: 'ACTIVE',
        title: r.title, body: r.body, image: r.image_url || r.thumbnail_url, previewUrl: r.preview_url, ...metrics(r.ad_id),
      })),
    });
  }

  // Période : publicités Meta (identifiants numériques) qui ont dépensé, les plus dépensières d'abord.
  const spent = totals.filter((t) => /^\d+$/.test(t.entity_id) && t.spend_cents > 0).sort((a, b) => b.spend_cents - a.spend_cents);
  const ids = spent.slice(0, MAX_ADS).map((t) => t.entity_id);
  const cached = new Map((ids.length ? await all<CreativeRow>(db,
    `SELECT * FROM meta_ad_creatives WHERE client_id = ?1 AND ad_id IN (SELECT value FROM json_each(?2))`, client.id, JSON.stringify(ids)) : []).map((r) => [r.ad_id, r]));
  const { error } = await refreshCreatives(c.env, client.id, ids, cached);
  const items = ids.map((id) => {
    const r = cached.get(id);
    return {
      id, name: r?.name ?? byAd.get(id)?.entity_name ?? null, campaign: r?.campaign_name ?? null, createdTime: r?.created_time ?? null,
      format: r?.object_type ?? null, status: r ? r.effective_status ?? 'DELETED' : null, title: r?.title ?? null, body: r?.body ?? null,
      image: r?.image_url || r?.thumbnail_url || null, previewUrl: r?.preview_url ?? null, ...metrics(id),
    };
  });
  // Meilleurs résultats d'abord : le plus de leads, puis le coût par lead le plus bas, puis la dépense.
  items.sort((a, b) => (b.leads ?? 0) - (a.leads ?? 0)
    || (a.costPerLeadCents ?? Infinity) - (b.costPerLeadCents ?? Infinity) || (b.spendCents ?? 0) - (a.spendCents ?? 0));
  return c.json({ ...base, syncedAt: null, truncated: Math.max(0, spent.length - MAX_ADS), fetchError: error ? 'Les visuels n’ont pas pu être relus dans Meta pour le moment.' : null, ads: items });
});
