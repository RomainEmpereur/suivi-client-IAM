/**
 * Synchronisation Meta (lot 3, décision 0010) : chiffres par publicité et par jour, en lecture seule.
 * - Contrôle : pour chaque jour, la somme des publicités est rapprochée du total du compte ; l'écart positif
 *   (publicités supprimées que Meta ne détaille plus) va dans une ligne « Campagnes supprimées ou archivées ».
 * - Devise : montants convertis en euros au taux BCE du jour (dernier taux publié avant le jour).
 * - Idempotent : les mesures Meta de la fenêtre sont remises à zéro puis réécrites, dans une seule transaction ;
 *   les mesures CRM (GHL) des mêmes lignes ne sont pas touchées.
 */
import { ROLLUP_STATEMENTS, addDaysYmd } from '../../../packages/domain/src/index.ts';
import { actionValue, type MetaClient, type MetaInsightRow } from '../../../packages/meta/src/index.ts';

export const DELETED_ID = 'supprimees';
const DELETED_NAME = 'Campagnes supprimées ou archivées';

export interface MetaSyncResult { days: number; rows: number; spendEurCents: number; currency: string; residualDays: number }

/** « 12.34 » → 1234 (unités mineures), sans erreur d'arrondi flottant. */
export function minorUnits(v: string | undefined): number {
  if (!v) return 0;
  const neg = v.startsWith('-');
  const [i, f = ''] = v.replace('-', '').split('.');
  const n = Number(i) * 100 + Number((f + '00').slice(0, 2));
  return neg ? -n : n;
}

/**
 * Leads = prospects des formulaires instantanés Meta uniquement (colonne « Prospects (formulaire) » du gestionnaire).
 * Jamais « lead » (total formulaire + pixel) ni « offsite_conversion.fb_pixel_lead » : un pixel posé sur une page
 * compte un prospect à chaque visite et gonflerait les leads (décision 0021).
 */
const LEAD_TYPES = ['onsite_conversion.lead_grouped', 'leadgen_grouped'];
const LPV_TYPES = ['landing_page_view', 'omni_landing_page_view'];

interface Measures { spendMinor: number; impressions: number; linkClicks: number; lpv: number; leads: number; plays: number; thruplays: number }
function measures(r: MetaInsightRow): Measures {
  return {
    spendMinor: minorUnits(r.spend),
    impressions: Math.round(Number(r.impressions ?? 0)),
    linkClicks: Math.round(Number(r.inline_link_clicks ?? 0)),
    lpv: actionValue(r.actions, LPV_TYPES),
    leads: actionValue(r.actions, LEAD_TYPES),
    plays: actionValue(r.video_play_actions, ['video_view']),
    thruplays: actionValue(r.video_thruplay_watched_actions, ['video_view']),
  };
}

/** Taux BCE : unités de la devise pour 1 EUR, par jour publié. */
export type FxTable = Map<string, number>;
export async function fetchFx(currency: string, from: string, to: string, fetchImpl: typeof fetch = fetch): Promise<FxTable> {
  const res = await fetchImpl(`https://api.frankfurter.dev/v1/${addDaysYmd(from, -10)}..${to}?base=EUR&symbols=${encodeURIComponent(currency)}`);
  if (!res.ok) throw new Error(`Taux de change ${currency} indisponibles (HTTP ${res.status})`);
  const body = (await res.json()) as { base: string; rates: Record<string, Record<string, number>> };
  if (body.base !== 'EUR') throw new Error('Taux de change : base EUR attendue');
  return new Map(Object.entries(body.rates).map(([d, v]) => [d, Number(v[currency])]).filter(([, v]) => Number.isFinite(v) && (v as number) > 0) as [string, number][]);
}
export function rateFor(fx: FxTable | null, day: string): number {
  if (!fx) return 1;
  let best: string | null = null;
  for (const d of [...fx.keys()].sort()) { if (d <= day) best = d; else break; }
  if (!best) throw new Error(`Aucun taux de change disponible au ${day}`);
  return fx.get(best)!;
}

export async function syncMeta(
  db: D1Database, clientId: string, accountId: string, meta: MetaClient,
  window: { from: string; to: string }, opts: { fx?: (currency: string) => Promise<FxTable> } = {},
): Promise<MetaSyncResult> {
  const account = await meta.adAccount(accountId);
  const currency = account.currency;
  const fx = currency === 'EUR' ? null : await (opts.fx ? opts.fx(currency) : fetchFx(currency, window.from, window.to));
  const [adRows, accRows, campaigns, ads] = await Promise.all([
    meta.adInsightsDaily(accountId, window.from, window.to),
    meta.accountInsightsDaily(accountId, window.from, window.to),
    meta.campaigns(accountId).catch(() => []),
    meta.ads(accountId).catch(() => []),
  ]);
  const budgetMinor = new Map(campaigns.map((c) => [c.id, c.daily_budget ? Number(c.daily_budget) : null]));
  const adStatus = new Map(ads.map((a) => [a.id, a.effective_status ?? null]));

  type Out = Record<string, string | number | null>;
  const out: Out[] = [];
  const perDay = new Map<string, Measures>();
  const add = (day: string, m: Measures) => {
    const t = perDay.get(day) ?? { spendMinor: 0, impressions: 0, linkClicks: 0, lpv: 0, leads: 0, plays: 0, thruplays: 0 };
    for (const k of Object.keys(m) as (keyof Measures)[]) t[k] += m[k];
    perDay.set(day, t);
  };
  const toRow = (day: string, m: Measures, ids: { ad: string; campaign: string; adset: string; campaignName: string | null; adsetName: string | null; adName: string | null; status: string | null }, frequency: number | null): Out => {
    const rate = rateFor(fx, day);
    const b = budgetMinor.get(ids.campaign);
    return {
      date: day, ad_id: ids.ad, campaign_id: ids.campaign, adset_id: ids.adset,
      campaign_name: ids.campaignName, adset_name: ids.adsetName, ad_name: ids.adName, ad_status: ids.status,
      campaign_daily_budget_cents: b == null ? null : Math.round(b / rate),
      spend_cents: Math.round(m.spendMinor / rate), spend_original_minor: m.spendMinor, currency, fx_rate_to_eur: 1 / rate,
      impressions: m.impressions, frequency, link_clicks: m.linkClicks, landing_page_views: m.lpv,
      thruplays: m.thruplays, video_plays: m.plays, leads: m.leads,
    };
  };

  for (const r of adRows) {
    if (!r.ad_id || r.date_start < window.from || r.date_start > window.to) continue;
    const m = measures(r);
    if (!m.spendMinor && !m.impressions && !m.leads && !m.linkClicks) continue;
    add(r.date_start, m);
    out.push(toRow(r.date_start, m, {
      ad: r.ad_id, campaign: r.campaign_id ?? '', adset: r.adset_id ?? '', campaignName: r.campaign_name ?? null,
      adsetName: r.adset_name ?? null, adName: r.ad_name ?? null, status: adStatus.get(r.ad_id) ?? null,
    }, r.frequency ? Number(r.frequency) : null));
  }

  // Rapprochement avec le total du compte, jour par jour.
  let residualDays = 0;
  for (const a of accRows) {
    const day = a.date_start;
    if (day < window.from || day > window.to) continue;
    const acc = measures(a);
    const sum = perDay.get(day) ?? { spendMinor: 0, impressions: 0, linkClicks: 0, lpv: 0, leads: 0, plays: 0, thruplays: 0 };
    if (sum.spendMinor > acc.spendMinor) throw new Error(`Contrôle Meta échoué le ${day} : les publicités dépassent le total du compte.`);
    const res: Measures = { spendMinor: 0, impressions: 0, linkClicks: 0, lpv: 0, leads: 0, plays: 0, thruplays: 0 };
    for (const k of Object.keys(res) as (keyof Measures)[]) res[k] = Math.max(0, acc[k] - sum[k]);
    if (Object.values(res).every((v) => v === 0)) continue;
    residualDays++;
    out.push(toRow(day, res, {
      ad: `campagne:${DELETED_ID}`, campaign: DELETED_ID, adset: '', campaignName: DELETED_NAME, adsetName: null, adName: null, status: null,
    }, null));
  }

  const stmts: D1PreparedStatement[] = [
    db.prepare(`UPDATE metrics_daily SET spend_cents = 0, spend_original_minor = NULL, fx_rate_to_eur = NULL, impressions = 0, frequency = NULL,
        link_clicks = 0, landing_page_views = 0, thruplays = 0, video_plays = 0, leads = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE client_id = ?1 AND date BETWEEN ?2 AND ?3`).bind(clientId, window.from, window.to),
  ];
  // Écriture groupée : une requête par paquet de lignes (limite de requêtes par exécution du Worker).
  for (let i = 0; i < out.length; i += 250) {
    stmts.push(db.prepare(
      `INSERT INTO metrics_daily (client_id, date, ad_id, campaign_id, adset_id, campaign_name, adset_name, ad_name, ad_status,
         campaign_daily_budget_cents, spend_cents, spend_original_minor, currency, fx_rate_to_eur, impressions, frequency,
         link_clicks, landing_page_views, thruplays, video_plays, leads, source)
       SELECT ?1, j.value ->> '$.date', j.value ->> '$.ad_id', j.value ->> '$.campaign_id', j.value ->> '$.adset_id',
         j.value ->> '$.campaign_name', j.value ->> '$.adset_name', j.value ->> '$.ad_name', j.value ->> '$.ad_status',
         j.value ->> '$.campaign_daily_budget_cents', j.value ->> '$.spend_cents', j.value ->> '$.spend_original_minor',
         j.value ->> '$.currency', j.value ->> '$.fx_rate_to_eur', j.value ->> '$.impressions', j.value ->> '$.frequency',
         j.value ->> '$.link_clicks', j.value ->> '$.landing_page_views', j.value ->> '$.thruplays', j.value ->> '$.video_plays',
         j.value ->> '$.leads', 'meta'
       FROM json_each(?2) AS j WHERE true
       ON CONFLICT (client_id, date, ad_id) DO UPDATE SET
         campaign_id = excluded.campaign_id, adset_id = excluded.adset_id, campaign_name = excluded.campaign_name,
         adset_name = excluded.adset_name, ad_name = excluded.ad_name, ad_status = excluded.ad_status,
         campaign_daily_budget_cents = excluded.campaign_daily_budget_cents, spend_cents = excluded.spend_cents,
         spend_original_minor = excluded.spend_original_minor, currency = excluded.currency, fx_rate_to_eur = excluded.fx_rate_to_eur,
         impressions = excluded.impressions, frequency = excluded.frequency, link_clicks = excluded.link_clicks,
         landing_page_views = excluded.landing_page_views, thruplays = excluded.thruplays, video_plays = excluded.video_plays,
         leads = excluded.leads, source = 'meta', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    ).bind(clientId, JSON.stringify(out.slice(i, i + 250))));
  }
  // Lignes devenues vides (anciens imports ponctuels par campagne) : supprimées.
  stmts.push(db.prepare(`DELETE FROM metrics_daily WHERE client_id = ?1 AND date BETWEEN ?2 AND ?3
      AND spend_cents = 0 AND impressions = 0 AND link_clicks = 0 AND landing_page_views = 0 AND vsl_views = 0 AND thruplays = 0
      AND video_plays = 0 AND leads = 0 AND crm_contacts = 0 AND appointments_booked = 0 AND appointments_held = 0 AND sales = 0
      AND cash_collected_cents = 0`).bind(clientId, window.from, window.to));
  stmts.push(db.prepare('DELETE FROM metrics_rollup WHERE client_id = ?1 AND period_start BETWEEN ?2 AND ?3').bind(clientId, window.from, window.to));
  for (const sql of ROLLUP_STATEMENTS) stmts.push(db.prepare(sql).bind(clientId, window.from, window.to));
  stmts.push(db.prepare('UPDATE clients SET ad_account_currency = ?1, ad_account_timezone = ?2 WHERE id = ?3').bind(currency, account.timezone_name, clientId));
  await db.batch(stmts);

  const total = out.reduce((s, r) => s + Number(r.spend_cents), 0);
  return { days: accRows.length, rows: out.length, spendEurCents: total, currency, residualDays };
}

/**
 * Publicités actives (décision 0026) : visuel, texte et lien d'aperçu, réécrits à chaque passage.
 * Un échec ici ne bloque jamais la synchro des chiffres : l'écran garde le dernier état connu.
 */
export async function syncActiveAds(db: D1Database, clientId: string, accountId: string, meta: MetaClient, now = new Date().toISOString()) {
  const ads = await meta.activeAds(accountId);
  const rows = ads.filter((a) => a.effective_status === 'ACTIVE').map((a) => ({
    ad_id: a.id, name: a.name ?? null, campaign_name: a.campaign?.name ?? null, created_time: a.created_time ?? null,
    object_type: a.creative?.object_type ?? null, title: a.creative?.title ?? null, body: a.creative?.body ?? null,
    thumbnail_url: a.creative?.thumbnail_url ?? null, image_url: a.creative?.image_url ?? null,
    preview_url: a.preview_shareable_link ?? null, page_id: a.creative?.actor_id ?? null,
  }));
  const pageId = rows.find((r) => r.page_id)?.page_id ?? null;
  await db.batch([
    db.prepare('DELETE FROM meta_ads_live WHERE client_id = ?1').bind(clientId),
    db.prepare(`INSERT INTO meta_ads_live (client_id, ad_id, name, campaign_name, created_time, object_type, title, body, thumbnail_url, image_url, preview_url, page_id, synced_at)
      SELECT ?1, j.value ->> '$.ad_id', j.value ->> '$.name', j.value ->> '$.campaign_name', j.value ->> '$.created_time', j.value ->> '$.object_type',
        j.value ->> '$.title', j.value ->> '$.body', j.value ->> '$.thumbnail_url', j.value ->> '$.image_url', j.value ->> '$.preview_url',
        j.value ->> '$.page_id', ?3 FROM json_each(?2) AS j WHERE true`).bind(clientId, JSON.stringify(rows), now),
    // Page Facebook : renseignée automatiquement si la fiche n'en a pas.
    db.prepare('UPDATE clients SET facebook_page_id = ?1 WHERE id = ?2 AND facebook_page_id IS NULL AND ?1 IS NOT NULL').bind(pageId, clientId),
  ]);
  return rows.length;
}
