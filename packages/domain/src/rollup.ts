/**
 * Recalcul de metrics_rollup à partir de metrics_daily, pour un client et une plage de jours.
 * Utilisé par le job quotidien (lot 3) et par le jeu de démonstration.
 * Idempotent : INSERT OR REPLACE sur la clé primaire.
 */
const SUMS = `SUM(spend_cents), SUM(impressions), SUM(link_clicks), SUM(landing_page_views), SUM(vsl_views),
  SUM(thruplays), SUM(video_plays), SUM(leads), SUM(crm_contacts), SUM(appointments_booked),
  SUM(appointments_held), SUM(sales), SUM(cash_collected_cents)`;
const COLS = `client_id, period_type, period_start, level, entity_id, entity_name, spend_cents, impressions,
  link_clicks, landing_page_views, vsl_views, thruplays, video_plays, leads, crm_contacts,
  appointments_booked, appointments_held, sales, cash_collected_cents`;
const WHERE = `WHERE client_id = ?1 AND date >= ?2 AND date <= ?3`;

export const ROLLUP_STATEMENTS: string[] = [
  `INSERT OR REPLACE INTO metrics_rollup (${COLS})
   SELECT client_id, 'day', date, 'client', client_id, NULL, ${SUMS} FROM metrics_daily ${WHERE} GROUP BY client_id, date`,
  `INSERT OR REPLACE INTO metrics_rollup (${COLS})
   SELECT client_id, 'day', date, 'campaign', campaign_id, MAX(campaign_name), ${SUMS} FROM metrics_daily ${WHERE} GROUP BY client_id, date, campaign_id`,
  `INSERT OR REPLACE INTO metrics_rollup (${COLS})
   SELECT client_id, 'day', date, 'ad', ad_id, MAX(ad_name), ${SUMS} FROM metrics_daily ${WHERE} GROUP BY client_id, date, ad_id`,
];

/** Version littérale (pour un fichier SQL de seed), paramètres substitués. */
export function rollupSql(clientId: string, from: string, to: string): string {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  return ROLLUP_STATEMENTS.map((s) => s.replace(/\?1/g, q(clientId)).replace(/\?2/g, q(from)).replace(/\?3/g, q(to)) + ';').join('\n');
}
