import { ROLLUP_STATEMENTS, parisDay } from '@obsidian/domain';
import { all, first } from './db.ts';

export const MANUAL_ENTITY = 'saisie_manuelle';

/**
 * Rendez-vous ajoutés à la main (réservés hors du CRM) : ils comptent dans les chiffres du client,
 * comme ceux du CRM (pris le jour de la saisie, tenus quand le statut « honoré » est posé).
 * Recalcul complet des lignes « saisie_manuelle » de metrics_daily, puis du rollup des jours touchés.
 * La synchro GHL ne touche jamais ces lignes (source = 'manuel').
 */
export async function refreshManualAppointments(db: D1Database, clientId: string) {
  const appts = await all<{ booked_at: string; status: string }>(db,
    `SELECT a.booked_at, a.status FROM appointments a WHERE a.client_id = ?1 AND a.origin = 'saisie' AND a.counts_toward_target = 1
       AND NOT (a.ghl_contact_id IS NOT NULL AND EXISTS (SELECT 1 FROM appointments g WHERE g.client_id = a.client_id
         AND g.origin != 'saisie' AND g.ghl_contact_id = a.ghl_contact_id))`, clientId);
  // Un rendez-vous saisi rattaché à un lead qui a déjà son rendez-vous dans le CRM n'est pas compté deux fois.
  const old = await all<{ date: string }>(db, `SELECT date FROM metrics_daily WHERE client_id = ?1 AND ad_id = ?2`, clientId, MANUAL_ENTITY);
  const byDay = new Map<string, { booked: number; held: number }>();
  for (const a of appts) {
    const d = parisDay(a.booked_at);
    const x = byDay.get(d) ?? { booked: 0, held: 0 };
    x.booked++;
    if (a.status === 'honore') x.held++;
    byDay.set(d, x);
  }
  const days = [...new Set([...old.map((o) => o.date), ...byDay.keys()])].sort();
  const stmts: D1PreparedStatement[] = [
    db.prepare('DELETE FROM metrics_daily WHERE client_id = ?1 AND ad_id = ?2').bind(clientId, MANUAL_ENTITY),
  ];
  for (const [date, x] of byDay) {
    stmts.push(db.prepare(
      `INSERT INTO metrics_daily (client_id, date, ad_id, campaign_id, adset_id, campaign_name, appointments_booked, appointments_held, source)
       VALUES (?1, ?2, ?3, ?3, '', 'Rendez-vous ajoutés à la main', ?4, ?5, 'manuel')`,
    ).bind(clientId, date, MANUAL_ENTITY, x.booked, x.held));
  }
  if (days.length) {
    const from = days[0], to = days[days.length - 1];
    stmts.push(db.prepare('DELETE FROM metrics_rollup WHERE client_id = ?1 AND period_start BETWEEN ?2 AND ?3').bind(clientId, from, to));
    for (const sql of ROLLUP_STATEMENTS) stmts.push(db.prepare(sql).bind(clientId, from, to));
  }
  // Des rendez-vous saisis existent : les rendez-vous pris / tenus deviennent mesurés pour ce client.
  if (appts.length) {
    const c = await first<{ unmeasured_json: string | null }>(db, 'SELECT unmeasured_json FROM clients WHERE id = ?1', clientId);
    let list: string[] = [];
    try { list = JSON.parse(c?.unmeasured_json || '[]'); } catch { list = []; }
    const next = list.filter((k) => k !== 'appointments_booked' && k !== 'appointments_held');
    if (next.length !== list.length) stmts.push(db.prepare('UPDATE clients SET unmeasured_json = ?1 WHERE id = ?2').bind(JSON.stringify(next), clientId));
  }
  await db.batch(stmts);
}

const NR = 'non_rattache';

/**
 * Rendez-vous tenus des rendez-vous du CRM, recalculés depuis la table appointments (décision 0014) :
 * le statut effectif est celui posé dans l'espace (client ou agence), sinon celui de GHL.
 * Même clé que la synchro GHL : jour de prise (Paris) × publicité (à défaut campagne, à défaut « non rattaché »).
 */
export async function refreshHeldFromAppointments(db: D1Database, clientId: string) {
  const rows = await all<{ booked_at: string; status: string; ad_id: string | null; campaign_id: string | null }>(db,
    `SELECT booked_at, status, ad_id, campaign_id FROM appointments
     WHERE client_id = ?1 AND origin != 'saisie' AND counts_toward_target = 1`, clientId);
  const held = new Map<string, { date: string; adId: string; campaignId: string; n: number }>();
  for (const r of rows) {
    if (r.status !== 'honore') continue;
    const date = parisDay(r.booked_at);
    const adId = r.ad_id ?? (r.campaign_id ? `campagne:${r.campaign_id}` : NR);
    const key = `${date}|${adId}`;
    const x = held.get(key) ?? { date, adId, campaignId: r.campaign_id ?? NR, n: 0 };
    x.n++;
    held.set(key, x);
  }
  const old = await all<{ date: string }>(db,
    `SELECT DISTINCT date FROM metrics_daily WHERE client_id = ?1 AND source = 'ghl' AND appointments_held > 0`, clientId);
  const stmts: D1PreparedStatement[] = [
    db.prepare(`UPDATE metrics_daily SET appointments_held = 0 WHERE client_id = ?1 AND source = 'ghl' AND appointments_held > 0`).bind(clientId),
  ];
  for (const x of held.values()) {
    stmts.push(db.prepare(
      `INSERT INTO metrics_daily (client_id, date, ad_id, campaign_id, adset_id, appointments_held, source)
       VALUES (?1, ?2, ?3, ?4, '', ?5, 'ghl')
       ON CONFLICT (client_id, date, ad_id) DO UPDATE SET appointments_held = excluded.appointments_held`,
    ).bind(clientId, x.date, x.adId, x.campaignId, x.n));
  }
  const days = [...new Set([...old.map((o) => o.date), ...[...held.values()].map((x) => x.date)])].sort();
  if (days.length) {
    const from = days[0], to = days[days.length - 1];
    stmts.push(db.prepare('DELETE FROM metrics_rollup WHERE client_id = ?1 AND period_start BETWEEN ?2 AND ?3').bind(clientId, from, to));
    for (const sql of ROLLUP_STATEMENTS) stmts.push(db.prepare(sql).bind(clientId, from, to));
  }
  await db.batch(stmts);
}

export const CASH_ENTITY = 'encaissement_manuel';

/**
 * Encaissements saisis (décision 0014) : une ligne « encaissement_manuel » par jour dans metrics_daily (source = 'manuel'),
 * recalculées entièrement, puis le rollup des jours touchés. Dès qu'un encaissement existe, l'encaissé devient mesuré.
 */
export async function refreshManualCash(db: D1Database, clientId: string) {
  const days = await all<{ date: string; total: number }>(db,
    'SELECT date, SUM(amount_cents) AS total FROM cash_entries WHERE client_id = ?1 GROUP BY date', clientId);
  const old = await all<{ date: string }>(db, 'SELECT date FROM metrics_daily WHERE client_id = ?1 AND ad_id = ?2', clientId, CASH_ENTITY);
  const stmts: D1PreparedStatement[] = [
    db.prepare('DELETE FROM metrics_daily WHERE client_id = ?1 AND ad_id = ?2').bind(clientId, CASH_ENTITY),
  ];
  for (const d of days) {
    stmts.push(db.prepare(
      `INSERT INTO metrics_daily (client_id, date, ad_id, campaign_id, adset_id, campaign_name, cash_collected_cents, source)
       VALUES (?1, ?2, ?3, ?3, '', 'Encaissements saisis', ?4, 'manuel')`,
    ).bind(clientId, d.date, CASH_ENTITY, d.total));
  }
  const all_days = [...new Set([...old.map((o) => o.date), ...days.map((d) => d.date)])].sort();
  if (all_days.length) {
    const from = all_days[0], to = all_days[all_days.length - 1];
    stmts.push(db.prepare('DELETE FROM metrics_rollup WHERE client_id = ?1 AND period_start BETWEEN ?2 AND ?3').bind(clientId, from, to));
    for (const sql of ROLLUP_STATEMENTS) stmts.push(db.prepare(sql).bind(clientId, from, to));
  }
  const c = await first<{ unmeasured_json: string | null }>(db, 'SELECT unmeasured_json FROM clients WHERE id = ?1', clientId);
  let list: string[] = [];
  try { list = JSON.parse(c?.unmeasured_json || '[]'); } catch { list = []; }
  const has = list.includes('cash_collected_cents');
  if (days.length && has) stmts.push(db.prepare('UPDATE clients SET unmeasured_json = ?1 WHERE id = ?2').bind(JSON.stringify(list.filter((k) => k !== 'cash_collected_cents')), clientId));
  if (!days.length && !has) stmts.push(db.prepare('UPDATE clients SET unmeasured_json = ?1 WHERE id = ?2').bind(JSON.stringify([...list, 'cash_collected_cents']), clientId));
  await db.batch(stmts);
}
