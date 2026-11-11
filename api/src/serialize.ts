import type { Audience } from './env.ts';

/** Ce qui sort de l'API dépend de la vue. Aucun jeton ne sort, jamais, dans aucune vue. */

export interface DeliverableRow {
  id: string; type: string; phase: string; title: string; status: string; version: number;
  external_url: string | null; r2_key: string | null; client_summary: string | null;
  visible_client: number; published_at: string | null; origin: string; updated_at: string;
}

export function serializeDeliverable(d: DeliverableRow, audience: Audience) {
  if (audience === 'agence') {
    return {
      id: d.id, type: d.type, phase: d.phase, title: d.title, status: d.status, version: d.version,
      externalUrl: d.external_url, hasFile: Boolean(d.r2_key), clientSummary: d.client_summary,
      published: Boolean(d.visible_client), publishedAt: d.published_at, origin: d.origin, updatedAt: d.updated_at,
    };
  }
  const published = Boolean(d.visible_client) && d.status !== 'brouillon';
  if (!published || d.status === 'en_preparation') {
    // « En préparation » et rien d'autre (§10).
    return { id: d.id, type: d.type, phase: d.phase, title: d.title, status: 'en_preparation', published: false };
  }
  return {
    id: d.id, type: d.type, phase: d.phase, title: d.title, status: d.status, version: d.version,
    externalUrl: d.external_url, hasFile: Boolean(d.r2_key), clientSummary: d.client_summary,
    published: true, publishedAt: d.published_at,
  };
}

export interface ConnectionRow {
  id: string; type: string; external_id: string | null; state: string; last_checked_at: string | null;
  error_message: string | null; client_action: string | null; guide_id: string | null;
  token_ciphertext?: string | null; token_expires_at: string | null;
}

export function serializeConnection(r: ConnectionRow, audience: Audience) {
  const base = {
    id: r.id, type: r.type, state: r.state, lastCheckedAt: r.last_checked_at,
    clientAction: r.client_action, guideId: r.guide_id,
  };
  if (audience === 'client') return base;
  // Vue agence : erreur technique et expiration, mais toujours PAS la valeur du jeton.
  return {
    ...base, externalId: r.external_id, errorMessage: r.error_message,
    tokenConfigured: Boolean(r.token_ciphertext), tokenExpiresAt: r.token_expires_at,
  };
}

export interface RecoRow {
  id: string; date: string; severity: string; rule_key: string; title: string; body: string;
  internal_note: string | null; client_title: string | null; client_body: string | null; metrics_json: string;
  visible_client: number; published_at: string | null; state: string; state_changed_at: string | null; repeat_count: number;
}

export function serializeReco(r: RecoRow, audience: Audience) {
  if (audience === 'client') {
    return {
      id: r.id, date: r.date, severity: r.severity, title: r.client_title ?? r.title, body: r.client_body ?? r.body,
      state: r.state, stateChangedAt: r.state_changed_at, repeatCount: r.repeat_count,
    };
  }
  return {
    id: r.id, date: r.date, severity: r.severity, ruleKey: r.rule_key, title: r.title, body: r.body,
    internalNote: r.internal_note, clientTitle: r.client_title, clientBody: r.client_body,
    metrics: safeJson(r.metrics_json), published: Boolean(r.visible_client), publishedAt: r.published_at,
    state: r.state, stateChangedAt: r.state_changed_at, repeatCount: r.repeat_count,
  };
}

export function safeJson(s: string | null): unknown {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}
