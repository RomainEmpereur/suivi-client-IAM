/** Seuils par défaut (§14), modifiables par client via clients.thresholds_json. */
export interface Thresholds {
  cpm_max_cents: number;
  cpc_max_cents: number;
  ctr_min: number;
  thruplay_min: number;
  cancel_rate_max: number;
  roas_cash_min: number;
  /** Plafond du coût par rendez-vous : calculé à l'onboarding (§14). null tant que non calculé. */
  cost_per_booked_max_cents: number | null;
}

/**
 * Seuils par défaut (décision 0012) : larges, adaptés au B2B et aux campagnes de lancement,
 * dont les premiers chiffres sont peu fiables. Un client peut avoir ses propres seuils (clients.thresholds_json).
 */
export const DEFAULT_THRESHOLDS: Thresholds = {
  cpm_max_cents: 4000,      // 40 € : un CPM B2B de 25 à 40 € est courant
  cpc_max_cents: 300,       // 3 €
  ctr_min: 0.007,           // 0,7 %
  thruplay_min: 0.08,       // 8 %
  cancel_rate_max: 0.25,    // 25 %
  roas_cash_min: 1,         // au lancement, rentrer dans ses frais suffit
  cost_per_booked_max_cents: null,
};

export function resolveThresholds(json: string | null | undefined): Thresholds {
  let custom: Partial<Thresholds> = {};
  try { custom = json ? JSON.parse(json) : {}; } catch { custom = {}; }
  return { ...DEFAULT_THRESHOLDS, ...custom };
}

export interface UnitEconomics {
  monthly_ticket_cents?: number;
  lifetime_months?: number;
  gross_margin?: number;      // 0..1
  demo_close_rate?: number;   // 0..1
  acceptable_share?: number;  // 0..1
}

/** Plafond du coût par rendez-vous = ticket × durée de vie × marge × closing × part acceptable. */
export function costPerAppointmentCeilingCents(u: UnitEconomics): number | null {
  const { monthly_ticket_cents, lifetime_months, gross_margin, demo_close_rate, acceptable_share } = u;
  if ([monthly_ticket_cents, lifetime_months, gross_margin, demo_close_rate, acceptable_share].some((v) => v == null)) return null;
  return Math.round(monthly_ticket_cents! * lifetime_months! * gross_margin! * demo_close_rate! * acceptable_share!);
}

export type Verdict = 'tenu' | 'surveiller' | 'corriger' | 'non_mesure';
export const VERDICT_LABEL: Record<Verdict, string> = {
  tenu: 'Objectif tenu',
  surveiller: 'À surveiller',
  corriger: 'À corriger',
  non_mesure: 'Non mesuré',
};

/** Verdict simple : tenu / à surveiller (écart ≤ 30 %, lancement B2B) / à corriger. */
export function verdict(value: number | null, limit: number | null, kind: 'max' | 'min'): Verdict {
  if (value === null || limit === null) return 'non_mesure';
  const ok = kind === 'max' ? value <= limit : value >= limit;
  if (ok) return 'tenu';
  const gap = kind === 'max' ? (value - limit) / limit : (limit - value) / limit;
  return gap <= 0.3 ? 'surveiller' : 'corriger';
}

/** Seuils effectifs : surcharges du client, et à défaut, plafond calculé depuis les chiffres unitaires. */
export function clientThresholds(thresholdsJson: string | null | undefined, unitEconomicsJson: string | null | undefined): Thresholds {
  const t = resolveThresholds(thresholdsJson);
  if (t.cost_per_booked_max_cents == null) {
    let ue: UnitEconomics = {};
    try { ue = unitEconomicsJson ? JSON.parse(unitEconomicsJson) : {}; } catch { ue = {}; }
    t.cost_per_booked_max_cents = costPerAppointmentCeilingCents(ue);
  }
  return t;
}
