/**
 * Client de l'API Marketing Meta — LECTURE SEULE (§19).
 * Il n'expose que des lectures ; `get` n'émet que des requêtes GET. Aucune méthode d'écriture n'existe ici.
 * Le jeton est fourni par l'appelant (déchiffré depuis connections.token_ciphertext) et n'est jamais journalisé.
 */
export const META_GRAPH_VERSION = 'v23.0';
const BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export class MetaError extends Error {
  status: number;
  code: number | null;
  constructor(status: number, code: number | null, message: string) { super(message); this.status = status; this.code = code; }
}

export interface MetaAction { action_type: string; value: string }
export interface MetaInsightRow {
  date_start: string; date_stop: string;
  campaign_id?: string; campaign_name?: string; adset_id?: string; adset_name?: string; ad_id?: string; ad_name?: string;
  spend?: string; impressions?: string; frequency?: string; inline_link_clicks?: string;
  actions?: MetaAction[]; video_play_actions?: MetaAction[]; video_thruplay_watched_actions?: MetaAction[];
}

export interface MetaClientOptions {
  token: string;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

const INSIGHT_FIELDS = ['spend', 'impressions', 'frequency', 'inline_link_clicks', 'actions', 'video_play_actions', 'video_thruplay_watched_actions'];
/** Toutes les publicités, y compris supprimées ou archivées : sans ce filtre, Meta omet leurs chiffres. */
const ALL_STATUSES = ['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'DISAPPROVED', 'PENDING_REVIEW',
  'PREAPPROVED', 'PENDING_BILLING_INFO', 'WITH_ISSUES', 'IN_PROCESS'];

export function createMetaClient(opts: MetaClientOptions) {
  const f = opts.fetchImpl ?? fetch;
  const maxAttempts = opts.maxAttempts ?? 4;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  async function get<T>(pathOrUrl: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(pathOrUrl.startsWith('https://') ? pathOrUrl : BASE + pathOrUrl);
    if (url.origin !== 'https://graph.facebook.com') throw new MetaError(0, null, 'Adresse Meta inattendue.');
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    url.searchParams.delete('access_token'); // le jeton passe dans l'en-tête, jamais dans une URL journalisable
    for (let attempt = 1; ; attempt++) {
      const res = await f(url.toString(), { method: 'GET', headers: { Authorization: `Bearer ${opts.token}`, Accept: 'application/json' } });
      if (res.ok) return (await res.json()) as T;
      let code: number | null = null;
      try { code = ((await res.json()) as { error?: { code?: number } }).error?.code ?? null; } catch { /* corps illisible */ }
      // 17 / 4 / 613 / 80004 : limites de débit Meta.
      const retryable = res.status >= 500 || res.status === 429 || [4, 17, 613, 80004].includes(code ?? -1);
      if (!retryable || attempt >= maxAttempts) {
        throw new MetaError(res.status, code, `Meta ${url.pathname.replace(/^\/v[\d.]+/, '')} : HTTP ${res.status}${code ? ` (code ${code})` : ''}`);
      }
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }

  async function paged<T>(path: string, query: Record<string, string | number | undefined>, maxPages = 200): Promise<T[]> {
    const out: T[] = [];
    let r = await get<{ data: T[]; paging?: { next?: string } }>(path, query);
    out.push(...r.data);
    for (let p = 1; p < maxPages && r.paging?.next; p++) {
      r = await get<{ data: T[]; paging?: { next?: string } }>(r.paging.next);
      out.push(...r.data);
    }
    return out;
  }

  const actId = (id: string) => (id.startsWith('act_') ? id : `act_${id}`);

  return {
    /** Test de lecture : le compte publicitaire est-il accessible avec ce jeton ? */
    adAccount: (accountId: string) =>
      get<{ id: string; name: string; currency: string; timezone_name: string; account_status: number }>(
        `/${actId(accountId)}`, { fields: 'name,currency,timezone_name,account_status' }),

    /** Chiffres par publicité et par jour (jours du fuseau du compte). */
    adInsightsDaily: (accountId: string, from: string, to: string) =>
      paged<MetaInsightRow>(`/${actId(accountId)}/insights`, {
        level: 'ad', time_increment: 1, time_range: JSON.stringify({ since: from, until: to }),
        fields: ['campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name', ...INSIGHT_FIELDS].join(','),
        filtering: JSON.stringify([{ field: 'ad.effective_status', operator: 'IN', value: ALL_STATUSES }]),
        limit: 500,
      }),

    /** Totaux du compte par jour : contrôle de la somme des publicités. */
    accountInsightsDaily: (accountId: string, from: string, to: string) =>
      paged<MetaInsightRow>(`/${actId(accountId)}/insights`, {
        level: 'account', time_increment: 1, time_range: JSON.stringify({ since: from, until: to }),
        fields: INSIGHT_FIELDS.join(','), limit: 500,
      }),

    /** Statut et budget quotidien des campagnes (affichage). */
    campaigns: (accountId: string) =>
      paged<{ id: string; name: string; daily_budget?: string; effective_status?: string }>(`/${actId(accountId)}/campaigns`, {
        fields: 'id,name,daily_budget,effective_status', limit: 500,
      }, 20),

    /** Statut des publicités (affichage). */
    ads: (accountId: string) =>
      paged<{ id: string; effective_status?: string }>(`/${actId(accountId)}/ads`, { fields: 'id,effective_status', limit: 500 }, 40),
  };
}
export type MetaClient = ReturnType<typeof createMetaClient>;

/** Somme d'un tableau d'actions Meta pour les types donnés (premier type présent dans l'ordre de préférence). */
export function actionValue(actions: MetaAction[] | undefined, types: string[]): number {
  if (!actions?.length) return 0;
  for (const t of types) {
    const a = actions.find((x) => x.action_type === t);
    if (a) return Math.round(Number(a.value) || 0);
  }
  return 0;
}
