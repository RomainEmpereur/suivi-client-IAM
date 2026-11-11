/** Totaux bruts sur une période (sommes de metrics_rollup niveau client). */
export interface Totals {
  spend_cents: number;
  impressions: number;
  link_clicks: number;
  landing_page_views: number;
  vsl_views: number;
  thruplays: number;
  video_plays: number;
  leads: number;
  crm_contacts: number;
  appointments_booked: number;
  appointments_held: number;
  sales: number;
  cash_collected_cents: number;
}

export const TOTAL_FIELDS: (keyof Totals)[] = [
  'spend_cents', 'impressions', 'link_clicks', 'landing_page_views', 'vsl_views', 'thruplays',
  'video_plays', 'leads', 'crm_contacts', 'appointments_booked', 'appointments_held', 'sales',
  'cash_collected_cents',
];

export function emptyTotals(): Totals {
  return Object.fromEntries(TOTAL_FIELDS.map((k) => [k, 0])) as unknown as Totals;
}

/** Division protégée : renvoie null (→ « — ») quand le dénominateur est nul. */
export function safeDiv(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

export function derived(t: Totals) {
  return {
    ctr: safeDiv(t.link_clicks, t.impressions),
    cpc_cents: safeDiv(t.spend_cents, t.link_clicks),
    cpm_cents: t.impressions > 0 ? (t.spend_cents / t.impressions) * 1000 : null,
    cost_per_lead_cents: safeDiv(t.spend_cents, t.leads),
    cost_per_visitor_cents: safeDiv(t.spend_cents, t.landing_page_views),
    cost_per_booked_cents: safeDiv(t.spend_cents, t.appointments_booked),
    cost_per_held_cents: safeDiv(t.spend_cents, t.appointments_held),
    cac_cents: safeDiv(t.spend_cents, t.sales),
    roas_cash: safeDiv(t.cash_collected_cents, t.spend_cents),
    visitor_to_booked: safeDiv(t.appointments_booked, t.landing_page_views),
    thruplay_rate: safeDiv(t.thruplays, t.video_plays),
  };
}

/** Variation relative ; null si la période précédente est vide (pas de « +∞ % »). */
export function delta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

/** Sens favorable d'un indicateur, pour colorer une variation (§15). */
export const HIGHER_IS_BETTER: Record<string, boolean> = {
  spend_cents: true, leads: true, link_clicks: true, crm_contacts: true, appointments_booked: true,
  appointments_held: true, sales: true, cash_collected_cents: true, ctr: true, roas_cash: true,
  show_rate: true, thruplay_rate: true, visitor_to_booked: true,
  cpc_cents: false, cpm_cents: false, cost_per_lead_cents: false, cost_per_booked_cents: false,
  cost_per_held_cents: false, cac_cents: false, cancel_rate: false,
};
