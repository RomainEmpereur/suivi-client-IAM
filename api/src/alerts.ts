import { addDaysYmd, clientThresholds, derived, formatEuros, formatPercent, todayParis, verdict, type Verdict } from '@obsidian/domain';
import type { ClientRow } from './env.ts';
import { all, first, newId } from './db.ts';
import { clientTotals, entityTotals } from './metrics.ts';

/**
 * Alertes quotidiennes de l'agence (décision 0014). Vue agence uniquement, jamais exposées au client.
 * Période : les 7 derniers jours complets (J-7 à J-1, Paris). Chaque calcul remplace les alertes du jour du client.
 * Une mesure absente ne déclenche rien : aucune alerte ne repose sur un chiffre inventé.
 */
export interface AlertDraft {
  rule_key: string; severity: 'surveiller' | 'corriger'; title: string; detail: string;
  metric: string; value: number | null; threshold: number | null; entity_id?: string | null;
}

const MIN_IMPRESSIONS = 2000;      // en dessous, CPM / CTR / CPC ne sont pas significatifs
const AD_SPEND_FLOOR_CENTS = 5000; // 50 € sans rendez-vous, à défaut de plafond de coût par rendez-vous

export async function computeClientAlerts(db: D1Database, client: ClientRow, now = new Date()): Promise<AlertDraft[]> {
  const today = todayParis(now);
  const to = addDaysYmd(today, -1);
  const from = addDaysYmd(to, -6);
  const out: AlertDraft[] = [];
  const unmeasured = new Set<string>((() => { try { return JSON.parse(client.unmeasured_json || '[]'); } catch { return []; } })());
  const crmMeasured = !unmeasured.has('appointments_booked');
  const th = clientThresholds(client.thresholds_json, client.unit_economics_json);

  // 1. Connexions et synchros
  const conns = await all<{ type: string; state: string; error_message: string | null; token: number }>(db,
    `SELECT type, state, error_message, token_ciphertext IS NOT NULL AS token FROM connections WHERE client_id = ?1 AND type IN ('meta','ghl')`, client.id);
  for (const k of conns) {
    const name = k.type === 'meta' ? 'Meta' : 'GoHighLevel';
    if (k.token && k.state === 'casse') {
      out.push({ rule_key: `connexion_${k.type}`, severity: 'corriger', metric: 'connexion', value: null, threshold: null,
        title: `Synchro ${name} en échec`, detail: k.error_message ? k.error_message.slice(0, 300) : `La dernière synchro ${name} a échoué : les chiffres ne sont plus à jour.` });
    }
    if (k.token && k.state !== 'casse') {
      const last = await first<{ at: string | null }>(db, `SELECT MAX(finished_at) AS at FROM sync_runs WHERE client_id = ?1 AND source = ?2 AND ok = 1`, client.id, k.type);
      if (!last?.at || Date.parse(last.at) < now.getTime() - 36 * 3_600_000) {
        out.push({ rule_key: `synchro_${k.type}`, severity: 'corriger', metric: 'synchro', value: null, threshold: null,
          title: `Aucune synchro ${name} réussie depuis plus de 36 h`, detail: last?.at ? `Dernière synchro réussie le ${last.at.slice(0, 10)}.` : 'Aucune synchro réussie à ce jour.' });
      }
    }
  }

  // 2. Chiffres des 7 derniers jours
  const t7 = await clientTotals(db, client.id, from, to);
  if (t7 && t7.spend_cents > 0) {
    const d = derived(t7);
    if (crmMeasured && t7.appointments_booked === 0) {
      out.push({ rule_key: 'depense_sans_rdv', severity: 'corriger', metric: 'appointments_booked', value: 0, threshold: null,
        title: 'Aucun rendez-vous sur 7 jours, la dépense tourne',
        detail: `${formatEuros(t7.spend_cents)} dépensés du ${from} au ${to} sans un seul rendez-vous pris.` });
    }
    const check = (key: string, label: string, value: number | null, limit: number | null, kind: 'max' | 'min', fmt: (v: number) => string, enough: boolean) => {
      if (!enough || value == null || limit == null) return;
      const v: Verdict = verdict(value, limit, kind);
      if (v === 'surveiller' || v === 'corriger') {
        out.push({ rule_key: `seuil_${key}`, severity: v, metric: key, value, threshold: limit,
          title: `${label} ${kind === 'max' ? 'au-dessus' : 'en dessous'} du seuil`,
          detail: `${label} sur 7 jours : ${fmt(value)} (seuil ${kind === 'max' ? 'max' : 'min'} ${fmt(limit)}).` });
      }
    };
    const enough = t7.impressions >= MIN_IMPRESSIONS;
    check('cpm', 'CPM', d.cpm_cents, th.cpm_max_cents, 'max', (v) => formatEuros(Math.round(v)), enough);
    check('cpc', 'CPC', d.cpc_cents, th.cpc_max_cents, 'max', (v) => formatEuros(Math.round(v)), enough && t7.link_clicks >= 20);
    check('ctr', 'CTR', d.ctr, th.ctr_min, 'min', (v) => formatPercent(v, 2), enough);
    if (crmMeasured) check('cout_rdv', 'Coût par rendez-vous', d.cost_per_booked_cents, th.cost_per_booked_max_cents, 'max', (v) => formatEuros(Math.round(v)), t7.appointments_booked > 0);

    // Publicités qui ont dépensé sans rendez-vous
    if (crmMeasured) {
      const floor = th.cost_per_booked_max_cents ?? AD_SPEND_FLOOR_CENTS;
      const ads = (await entityTotals(db, client.id, 'ad', from, to))
        .filter((a) => a.spend_cents >= floor && a.appointments_booked === 0 && !['saisie_manuelle', 'encaissement_manuel', 'non_rattache'].includes(a.entity_id) && !a.entity_id.startsWith('campagne:'))
        .slice(0, 5);
      for (const a of ads) {
        out.push({ rule_key: 'pub_sans_rdv', severity: th.cost_per_booked_max_cents != null ? 'corriger' : 'surveiller', metric: 'spend_cents',
          value: a.spend_cents, threshold: floor, entity_id: a.entity_id,
          title: `Pub sans rendez-vous : ${a.entity_name ?? a.entity_id}`,
          detail: `${formatEuros(a.spend_cents)} dépensés sur 7 jours, 0 rendez-vous (seuil ${formatEuros(floor)}${th.cost_per_booked_max_cents != null ? ', plafond de coût par rendez-vous' : ''}). À couper ou à revoir.` });
      }
    }
  }

  // 3. Campagnes à l'arrêt : rien depuis 3 jours alors qu'il y avait de la dépense les 7 jours d'avant
  if (client.status === 'actif') {
    const last3 = await clientTotals(db, client.id, addDaysYmd(to, -2), to);
    const before = await clientTotals(db, client.id, addDaysYmd(to, -9), addDaysYmd(to, -3));
    const metaOk = conns.some((k) => k.type === 'meta' && k.token && k.state === 'ok');
    if (metaOk && before && before.spend_cents > 0 && last3 && last3.spend_cents === 0) {
      out.push({ rule_key: 'campagnes_arret', severity: 'surveiller', metric: 'spend_cents', value: 0, threshold: null,
        title: 'Campagnes à l\'arrêt depuis 3 jours',
        detail: `Aucune dépense du ${addDaysYmd(to, -2)} au ${to}, alors que ${formatEuros(before.spend_cents)} ont été dépensés les 7 jours précédents. Pause voulue ?` });
    }
  }

  // 4. Rendez-vous passés sans statut (à renseigner par le client) et taux d'annulation
  const cutoff = new Date(now.getTime() - 2 * 86_400_000).toISOString();
  const missing = await first<{ n: number }>(db,
    `SELECT COUNT(*) AS n FROM appointments WHERE client_id = ?1 AND status = 'prevu' AND counts_toward_target = 1 AND scheduled_at < ?2`, client.id, cutoff);
  if (missing && missing.n > 0) {
    out.push({ rule_key: 'rdv_sans_statut', severity: missing.n >= 5 ? 'corriger' : 'surveiller', metric: 'appointments', value: missing.n, threshold: null,
      title: `${missing.n} rendez-vous passé${missing.n > 1 ? 's' : ''} sans statut`,
      detail: 'Le client doit indiquer s\'ils ont été honorés (page Rendez-vous) : sans cela, le taux de présence n\'est pas mesuré.' });
  }
  const appts = await all<{ status: string }>(db,
    `SELECT status FROM appointments WHERE client_id = ?1 AND counts_toward_target = 1 AND scheduled_at >= ?2 AND scheduled_at < ?3`,
    client.id, `${from}T00:00:00Z`, `${today}T00:00:00Z`);
  if (appts.length >= 4) {
    const rate = appts.filter((a) => a.status === 'annule').length / appts.length;
    const v = verdict(rate, th.cancel_rate_max, 'max');
    if (v === 'surveiller' || v === 'corriger') {
      out.push({ rule_key: 'seuil_annulation', severity: v, metric: 'cancel_rate', value: rate, threshold: th.cancel_rate_max,
        title: 'Taux d\'annulation au-dessus du seuil',
        detail: `${formatPercent(rate)} des ${appts.length} rendez-vous prévus sur 7 jours ont été annulés (seuil max ${formatPercent(th.cancel_rate_max)}).` });
    }
  }

  // 5. Tâches client en retard
  const late = await all<{ label: string; due_date: string; blocking: number }>(db,
    `SELECT label, due_date, blocking FROM tasks WHERE client_id = ?1 AND owner = 'client' AND status != 'fait' AND due_date IS NOT NULL AND due_date < ?2 ORDER BY due_date`,
    client.id, today);
  if (late.length) {
    out.push({ rule_key: 'taches_client_retard', severity: late.some((t) => t.blocking) ? 'corriger' : 'surveiller', metric: 'tasks', value: late.length, threshold: null,
      title: `${late.length} tâche${late.length > 1 ? 's' : ''} client en retard`,
      detail: late.slice(0, 4).map((t) => `${t.label} (échéance ${t.due_date}${t.blocking ? ', bloquante' : ''})`).join(' · ') });
  }
  return out;
}

/** Calcule et enregistre les alertes du jour d'un client : elles remplacent les précédentes (seul le dernier calcul compte). */
export async function storeClientAlerts(db: D1Database, client: ClientRow, now = new Date()) {
  const runDate = todayParis(now);
  const to = addDaysYmd(runDate, -1);
  const from = addDaysYmd(to, -6);
  const drafts = await computeClientAlerts(db, client, now);
  const stmts = [db.prepare('DELETE FROM alerts WHERE client_id = ?1 AND run_date IS NOT NULL').bind(client.id)];
  for (const a of drafts) {
    stmts.push(db.prepare(
      `INSERT INTO alerts (id, client_id, period_start, period_end, metric, value, threshold, verdict, run_date, rule_key, title, detail, entity_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
    ).bind(newId('al'), client.id, from, to, a.metric, a.value, a.threshold, a.severity, runDate, a.rule_key, a.title, a.detail, a.entity_id ?? null));
  }
  await db.batch(stmts);
  return drafts.length;
}

/** Tous les clients suivis (hors démo en production). */
export async function storeAllAlerts(db: D1Database, production: boolean, now = new Date()) {
  const list = await all<ClientRow>(db,
    `SELECT * FROM clients WHERE status IN ('onboarding','build','actif') ${production ? 'AND is_demo = 0' : ''} ORDER BY name`);
  let n = 0;
  for (const cl of list) {
    try { n += await storeClientAlerts(db, cl, now); } catch (e) { console.log('Alertes en échec', cl.id, e instanceof Error ? e.message : 'erreur'); }
  }
  return { clients: list.length, alerts: n };
}

export interface AlertRow {
  id: string; client_id: string; run_date: string; rule_key: string | null; verdict: string; title: string | null; detail: string | null;
  metric: string; value: number | null; threshold: number | null; entity_id: string | null; period_start: string; period_end: string;
}

export function serializeAlert(a: AlertRow) {
  return {
    id: a.id, clientId: a.client_id, runDate: a.run_date, ruleKey: a.rule_key, severity: a.verdict, title: a.title, detail: a.detail,
    metric: a.metric, value: a.value, threshold: a.threshold, entityId: a.entity_id, from: a.period_start, to: a.period_end,
  };
}

/** Alertes du dernier calcul (chaque calcul remplace le précédent pour le client). */
export async function latestAlerts(db: D1Database, clientIds?: string[]) {
  const rows = await all<AlertRow>(db,
    `SELECT * FROM alerts WHERE run_date IS NOT NULL ORDER BY client_id, (verdict = 'corriger') DESC, title`);
  const set = clientIds ? new Set(clientIds) : null;
  return rows.filter((r) => !set || set.has(r.client_id)).map(serializeAlert);
}
