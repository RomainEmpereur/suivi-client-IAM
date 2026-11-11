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

export const DEFAULT_THRESHOLDS: Thresholds = {
  cpm_max_cents: 1500,
  cpc_max_cents: 100,
  ctr_min: 0.015,
  thruplay_min: 0.12,
  cancel_rate_max: 0.15,
  roas_cash_min: 3,
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

/** Verdict simple : tenu / à surveiller (écart ≤ 20 %) / à corriger. */
export function verdict(value: number | null, limit: number | null, kind: 'max' | 'min'): Verdict {
  if (value === null || limit === null) return 'non_mesure';
  const ok = kind === 'max' ? value <= limit : value >= limit;
  if (ok) return 'tenu';
  const gap = kind === 'max' ? (value - limit) / limit : (limit - value) / limit;
  return gap <= 0.2 ? 'surveiller' : 'corriger';
}
