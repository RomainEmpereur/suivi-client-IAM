import { addDaysYmd } from './appointments.ts';
import { safeDiv, type Totals } from './kpis.ts';

/** Optimisations (décision 0025) : reprise ciblée de pièces en ligne, mesurée 14 jours avant / 14 jours après. */
export const OPTIMISATION_WINDOW_DAYS = 14;
/** Pièces qu'une optimisation peut reprendre (étapes de la chaîne). */
export const OPTIMISATION_STEPS = ['s4', 's6', 's3', 's5', 's7'] as const;
export type OptimisationStep = (typeof OPTIMISATION_STEPS)[number];
export const OPTIMISATION_STEP_LABEL: Record<OptimisationStep, string> = {
  s4: 'Nouvelle vague de publicités', s6: 'Formulaire et qualification', s3: 'Landing page', s5: 'Séquences de relance', s7: 'Structure de campagne',
};
export const OPTIMISATION_STATUS_LABEL: Record<string, string> = {
  en_preparation: 'En préparation', prete: 'Prête à mettre en ligne', en_ligne: 'En ligne · mesure en cours', terminee: 'Terminée', abandonnee: 'Abandonnée',
};
export const OPTIMISATION_VERDICT_LABEL: Record<string, string> = { garder: 'On garde', revenir: 'On revient à la version précédente' };

/**
 * Fenêtres de mesure : les 14 jours avant la mise en ligne, et les 14 jours à partir de la mise en ligne,
 * bornés à hier (les données du jour arrivent le lendemain).
 */
export function optimisationWindows(launchedOn: string, today: string) {
  const n = OPTIMISATION_WINDOW_DAYS;
  const before = { from: addDaysYmd(launchedOn, -n), to: addDaysYmd(launchedOn, -1) };
  const afterEnd = addDaysYmd(launchedOn, n - 1);
  const yesterday = addDaysYmd(today, -1);
  const afterTo = afterEnd < yesterday ? afterEnd : yesterday;
  const started = afterTo >= launchedOn;
  const elapsed = started ? Math.round((Date.parse(`${afterTo}T00:00:00Z`) - Date.parse(`${launchedOn}T00:00:00Z`)) / 86_400_000) + 1 : 0;
  return {
    before,
    after: started ? { from: launchedOn, to: afterTo } : null,
    elapsedDays: elapsed,
    complete: elapsed >= n,
    completeOn: addDaysYmd(afterEnd, 1),
  };
}

export interface OptimisationMetric {
  key: 'spend_cents' | 'leads' | 'cost_per_lead_cents' | 'appointments_booked' | 'cost_per_booked_cents' | 'booking_rate';
  label: string;
  unit: 'euros' | 'int' | 'percent';
  before: number | null;
  after: number | null;
  /** Variation relative (ratios uniquement : les volumes dépendent de la durée mesurée). */
  delta: number | null;
  /** true = la variation va dans le bon sens ; null = pas de comparaison. */
  better: boolean | null;
}

/** Avant / après. Aucune donnée synchronisée sur une fenêtre → null partout (« — »), jamais zéro. */
export function compareOptimisation(before: Totals | null, after: Totals | null): OptimisationMetric[] {
  const ratio = (t: Totals | null, k: 'cpl' | 'cpb' | 'rate') =>
    !t ? null : k === 'cpl' ? safeDiv(t.spend_cents, t.leads) : k === 'cpb' ? safeDiv(t.spend_cents, t.appointments_booked) : safeDiv(t.appointments_booked, t.leads);
  const row = (key: OptimisationMetric['key'], label: string, unit: OptimisationMetric['unit'], b: number | null, a: number | null, lowerIsBetter: boolean | null): OptimisationMetric => {
    const delta = lowerIsBetter === null || a === null || b === null || b === 0 ? null : (a - b) / b;
    return { key, label, unit, before: b, after: a, delta, better: delta === null || delta === 0 ? null : lowerIsBetter ? delta < 0 : delta > 0 };
  };
  return [
    row('spend_cents', 'Dépense', 'euros', before?.spend_cents ?? null, after?.spend_cents ?? null, null),
    row('leads', 'Leads', 'int', before?.leads ?? null, after?.leads ?? null, null),
    row('cost_per_lead_cents', 'Coût par lead', 'euros', ratio(before, 'cpl'), ratio(after, 'cpl'), true),
    row('appointments_booked', 'Rendez-vous pris', 'int', before?.appointments_booked ?? null, after?.appointments_booked ?? null, null),
    row('cost_per_booked_cents', 'Coût par rendez-vous', 'euros', ratio(before, 'cpb'), ratio(after, 'cpb'), true),
    row('booking_rate', 'Taux de réservation (rendez-vous / leads)', 'percent', ratio(before, 'rate'), ratio(after, 'rate'), false),
  ];
}
