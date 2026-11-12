/**
 * Client GoHighLevel (API v2) — LECTURE SEULE (§19).
 * Il n'expose que des lectures ; `get` refuse toute autre méthode HTTP. Aucune écriture dans GHL sans décision explicite.
 * Le jeton est fourni par l'appelant (déchiffré depuis connections.token_ciphertext) et n'est jamais journalisé.
 */
const BASE = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';

export class GhlError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export interface GhlOpportunity {
  id: string; contactId: string; pipelineId: string; pipelineStageId: string; status: string;
  createdAt: string; lastStageChangeAt?: string; source?: string; name?: string;
  contact?: { id?: string; name?: string; companyName?: string };
  attributions?: { utmAdId?: string; utmCampaignId?: string; utmCampaign?: string; utmSource?: string; adSource?: string }[];
}
export interface GhlEvent {
  id: string; contactId: string; calendarId: string; startTime: string; dateAdded: string; title?: string;
  appointmentStatus?: string; appoinmentStatus?: string; deleted?: boolean;
  appointmentMeta?: { defaultFormDetails?: { firstName?: string; lastName?: string } };
}

export interface GhlClientOptions {
  token: string;
  fetchImpl?: typeof fetch;
  /** Nombre maximal d'essais par requête (429 / 5xx), avec attente croissante. */
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function createGhlClient(opts: GhlClientOptions) {
  const f = opts.fetchImpl ?? fetch;
  const maxAttempts = opts.maxAttempts ?? 4;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  async function get<T>(path: string, query: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    for (let attempt = 1; ; attempt++) {
      const res = await f(url.toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${opts.token}`, Version: VERSION, Accept: 'application/json' },
      });
      if (res.ok) return (await res.json()) as T;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= maxAttempts) {
        // Message sans jeton ni donnée personnelle.
        throw new GhlError(res.status, `GHL ${path} : HTTP ${res.status}`);
      }
      await sleep(500 * 2 ** (attempt - 1));
    }
  }

  return {
    location: (locationId: string) => get<{ location: { id: string; name: string; timezone?: string } }>(`/locations/${locationId}`, {}),

    pipelines: (locationId: string) =>
      get<{ pipelines: { id: string; name: string; stages: { id: string; name: string; position: number }[] }[] }>(
        '/opportunities/pipelines', { locationId }),

    calendars: (locationId: string) => get<{ calendars: { id: string; name: string }[] }>('/calendars/', { locationId }),

    /** Toutes les opportunités d'un pipeline (pagination par curseur ; arrêt borné). */
    async opportunities(locationId: string, pipelineId: string, maxPages = 50): Promise<GhlOpportunity[]> {
      const out: GhlOpportunity[] = [];
      let startAfter: string | undefined;
      let startAfterId: string | undefined;
      for (let page = 0; page < maxPages; page++) {
        const r = await get<{ opportunities: GhlOpportunity[]; meta: { total?: number; startAfter?: number; startAfterId?: string } }>(
          '/opportunities/search', { location_id: locationId, pipeline_id: pipelineId, status: 'all', limit: 100, startAfter, startAfterId });
        out.push(...r.opportunities);
        if (r.opportunities.length < 100 || (r.meta.total !== undefined && out.length >= r.meta.total) || !r.meta.startAfterId) break;
        startAfter = r.meta.startAfter !== undefined ? String(r.meta.startAfter) : undefined;
        startAfterId = r.meta.startAfterId;
      }
      return out;
    },

    /** Rendez-vous d'un calendrier entre deux instants (ms). */
    async events(locationId: string, calendarId: string, startMs: number, endMs: number): Promise<GhlEvent[]> {
      const r = await get<{ events: GhlEvent[] }>('/calendars/events', {
        locationId, calendarId, startTime: startMs, endTime: endMs,
      });
      return r.events.filter((e) => !e.deleted);
    },
  };
}

export type GhlClient = ReturnType<typeof createGhlClient>;
