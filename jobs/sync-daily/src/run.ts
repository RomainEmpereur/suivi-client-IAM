/**
 * Orchestration de la synchronisation (§13) : un client à la fois, chaque échec isolé,
 * journal dans sync_runs, état de la connexion mis à jour. Lecture seule côté GHL ; aucun email.
 * Meta sera branché ici dès que le jeton système est disponible.
 */
import { addDaysYmd, todayParis, type GhlClientConfig } from '../../../packages/domain/src/index.ts';
import { createGhlClient, GhlError } from '../../../packages/ghl/src/index.ts';
import { decryptToken } from '../../../api/src/crypto.ts';
import { syncGhl, type GhlSyncResult } from './ghl.ts';

export interface SyncEnv { DB: D1Database; TOKEN_ENCRYPTION_KEY?: string }

const id = (p: string) => `${p}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

export function parseGhlConfig(json: string | null | undefined, locationId: string | null): GhlClientConfig | null {
  let c: Partial<GhlClientConfig> = {};
  try { c = JSON.parse(json || '{}'); } catch { return null; }
  const loc = c.locationId ?? locationId;
  if (!loc || !c.pipelineIds?.length || !c.calendarIds?.length) return null;
  return {
    locationId: loc, pipelineIds: c.pipelineIds, displayPipelineId: c.displayPipelineId ?? null, calendarIds: c.calendarIds,
    postCallStageIds: c.postCallStageIds ?? [], noShowStageIds: c.noShowStageIds ?? [], wonStageIds: c.wonStageIds ?? [],
    testTitlePrefixes: c.testTitlePrefixes ?? [],
  };
}

/** Synchronise GHL pour un client. Fenêtre par défaut : les 30 derniers jours (les statuts évoluent après coup). */
export async function runGhlForClient(env: SyncEnv, clientId: string, opts: { from?: string; to?: string; fetchImpl?: typeof fetch } = {})
  : Promise<{ ok: true; result: GhlSyncResult } | { ok: false; error: string }> {
  const to = opts.to ?? addDaysYmd(todayParis(), -1);
  const from = opts.from ?? addDaysYmd(to, -29);
  const started = new Date().toISOString();
  const runId = id('sr');
  const client = await env.DB.prepare('SELECT ghl_config_json FROM clients WHERE id = ?1').bind(clientId).first<{ ghl_config_json: string }>();
  const conn = await env.DB.prepare(`SELECT external_id, token_ciphertext FROM connections WHERE client_id = ?1 AND type = 'ghl'`)
    .bind(clientId).first<{ external_id: string | null; token_ciphertext: string | null }>();
  const config = parseGhlConfig(client?.ghl_config_json, conn?.external_id ?? null);

  const finish = async (ok: boolean, rows: number, error: string | null, state: string, clientAction: string | null) => {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO sync_runs (id, client_id, source, started_at, finished_at, rows_written, ok, error) VALUES (?1, ?2, 'ghl', ?3, ?4, ?5, ?6, ?7)`)
        .bind(runId, clientId, started, now, rows, ok ? 1 : 0, error),
      env.DB.prepare(`UPDATE connections SET state = ?1, last_checked_at = ?2, error_message = ?3, client_action = ?4, updated_at = ?2 WHERE client_id = ?5 AND type = 'ghl'`)
        .bind(state, now, ok ? null : error, clientAction, clientId),
    ]);
  };

  if (!conn?.token_ciphertext) return { ok: false, error: 'Aucun jeton GHL enregistré.' };
  if (!config) {
    await finish(false, 0, 'Réglages GHL incomplets (pipelines, calendriers).', 'degrade', 'Synchronisation en attente de réglage par Obsidian Partners.');
    return { ok: false, error: 'Réglages GHL incomplets.' };
  }
  try {
    const token = await decryptToken(conn.token_ciphertext, env.TOKEN_ENCRYPTION_KEY);
    const ghl = createGhlClient({ token, fetchImpl: opts.fetchImpl });
    const result = await syncGhl(env.DB, clientId, config, ghl, { from, to });
    await finish(true, result.rowsWritten, null, 'ok', null);
    return { ok: true, result };
  } catch (e) {
    const auth = e instanceof GhlError && (e.status === 401 || e.status === 403);
    const msg = e instanceof Error ? e.message : 'Erreur inconnue';
    await finish(false, 0, msg, 'casse', auth
      ? "L'accès à votre CRM a été retiré ou a expiré : Obsidian Partners doit renouveler le jeton d'intégration."
      : 'La lecture du CRM a échoué ce matin ; nouvel essai demain à 6 h.');
    return { ok: false, error: msg };
  }
}

/** Passage quotidien : tous les clients suivis, l'échec d'un client n'empêche pas les autres. */
export async function runDaily(env: SyncEnv) {
  const clients = await env.DB.prepare(
    `SELECT c.id FROM clients c JOIN connections k ON k.client_id = c.id AND k.type = 'ghl' AND k.token_ciphertext IS NOT NULL
     WHERE c.status IN ('onboarding', 'build', 'actif') AND c.is_demo = 0`).all<{ id: string }>();
  const out: Record<string, string> = {};
  for (const c of clients.results ?? []) {
    const r = await runGhlForClient(env, c.id).catch((e) => ({ ok: false as const, error: String(e) }));
    out[c.id] = r.ok ? 'ok' : r.error;
  }
  return out;
}
