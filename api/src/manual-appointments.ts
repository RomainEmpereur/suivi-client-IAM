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
    `SELECT booked_at, status FROM appointments WHERE client_id = ?1 AND origin = 'saisie' AND counts_toward_target = 1`, clientId);
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
