import { TOTAL_FIELDS, addDaysYmd, todayParis, type Totals } from '@obsidian/domain';
import { all, first } from './db.ts';

/** Bornes d'une période de N jours, close à hier (les données du jour arrivent le lendemain matin). */
export function periodBounds(days: number, now = new Date()) {
  const today = todayParis(now);
  const to = addDaysYmd(today, -1);
  const from = addDaysYmd(to, -(days - 1));
  const prevTo = addDaysYmd(from, -1);
  const prevFrom = addDaysYmd(prevTo, -(days - 1));
  return { from, to, prevFrom, prevTo };
}

const SUM_COLS = TOTAL_FIELDS.map((f) => `SUM(${f}) AS ${f}`).join(', ');

/** Totaux niveau client depuis metrics_rollup. null = aucune donnée synchronisée sur la période. */
export async function clientTotals(db: D1Database, clientId: string, from: string, to: string): Promise<Totals | null> {
  const row = await first<Totals & { n: number }>(
    db,
    `SELECT COUNT(*) AS n, ${SUM_COLS} FROM metrics_rollup
     WHERE client_id = ?1 AND period_type = 'day' AND level = 'client' AND period_start BETWEEN ?2 AND ?3`,
    clientId, from, to,
  );
  if (!row || !row.n) return null;
  const { n: _n, ...totals } = row;
  return totals as Totals;
}

export async function dailySeries(db: D1Database, clientId: string, from: string, to: string) {
  const rows = await all<{ date: string; spend_cents: number; leads: number; crm_contacts: number; appointments_booked: number }>(
    db,
    `SELECT period_start AS date, spend_cents, leads, crm_contacts, appointments_booked FROM metrics_rollup
     WHERE client_id = ?1 AND period_type = 'day' AND level = 'client' AND period_start BETWEEN ?2 AND ?3
     ORDER BY period_start`,
    clientId, from, to,
  );
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out = [];
  for (let d = from; d <= to; d = addDaysYmd(d, 1)) {
    const r = byDate.get(d);
    // Jour absent = non synchronisé → null (et pas zéro).
    out.push({ date: d, spend_cents: r?.spend_cents ?? null, leads: r?.leads ?? null, crm_contacts: r?.crm_contacts ?? null, appointments_booked: r?.appointments_booked ?? null });
  }
  return out;
}

export async function entityTotals(db: D1Database, clientId: string, level: 'campaign' | 'ad', from: string, to: string) {
  return all<Totals & { entity_id: string; entity_name: string | null }>(
    db,
    `SELECT entity_id, MAX(entity_name) AS entity_name, ${SUM_COLS} FROM metrics_rollup
     WHERE client_id = ?1 AND period_type = 'day' AND level = ?2 AND period_start BETWEEN ?3 AND ?4
     GROUP BY entity_id ORDER BY spend_cents DESC`,
    clientId, level, from, to,
  );
}

export async function lastSuccessfulSync(db: D1Database, clientId: string): Promise<string | null> {
  const r = await first<{ at: string | null }>(db, 'SELECT MAX(finished_at) AS at FROM sync_runs WHERE client_id = ?1 AND ok = 1', clientId);
  return r?.at ?? null;
}
