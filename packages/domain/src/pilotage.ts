/**
 * Pilotage (§9, lot 5) : indicateurs, verdicts, funnel et regroupement par granularité.
 * Règle de lecture partout : une absence de mesure vaut null (« — » avec sa raison), jamais 0.
 */
import { addDaysYmd } from './appointments.ts';
import { derived, safeDiv, type Totals } from './kpis.ts';
import { verdict, type Thresholds, type Verdict } from './thresholds.ts';

export type Granularity = 'day' | 'week' | 'month';

/** Début du seau (lundi de la semaine, 1er du mois) d'un jour AAAA-MM-JJ. */
export function bucketStart(day: string, g: Granularity): string {
  if (g === 'day') return day;
  if (g === 'month') return `${day.slice(0, 7)}-01`;
  const dow = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7; // lundi = 0
  return addDaysYmd(day, -dow);
}

export type SeriesPoint = Partial<Record<keyof Totals, number | null>> & { date: string };

/** Regroupe une série journalière. Un seau sans aucun jour mesuré reste null. */
export function bucketSeries(rows: SeriesPoint[], g: Granularity, keys: (keyof Totals)[]): SeriesPoint[] {
  const out = new Map<string, SeriesPoint>();
  for (const r of rows) {
    const b = bucketStart(r.date, g);
    const cur = out.get(b) ?? Object.fromEntries([['date', b], ...keys.map((k) => [k, null])]) as SeriesPoint;
    for (const k of keys) {
      const v = r[k];
      if (v == null) continue;
      cur[k] = ((cur[k] as number | null) ?? 0) + v;
    }
    out.set(b, cur);
  }
  return [...out.values()];
}

/** Ratios d'un point (CPM, CTR, CPC, coût par rendez-vous) ; null si le dénominateur manque. */
export function pointRatios(p: SeriesPoint) {
  const n = (k: keyof Totals) => (p[k] == null ? null : (p[k] as number));
  const spend = n('spend_cents'), imp = n('impressions'), clicks = n('link_clicks'), booked = n('appointments_booked');
  return {
    cpm_cents: spend != null && imp ? (spend / imp) * 1000 : null,
    ctr: clicks != null && imp ? clicks / imp : null,
    cpc_cents: spend != null && clicks ? spend / clicks : null,
    cost_per_booked_cents: spend != null && booked ? spend / booked : null,
  };
}

export interface KpiDef {
  key: string; label: string; format: 'euros' | 'int' | 'percent' | 'ratio';
  /** Seuil appliqué (clé de Thresholds) et sens. */
  threshold?: { key: keyof Thresholds; kind: 'max' | 'min' };
  higherIsBetter: boolean;
}

/** Les 16 indicateurs du bloc 02, dans l'ordre du cahier des charges. */
export const PILOTAGE_KPIS: KpiDef[] = [
  { key: 'spend_cents', label: 'Dépense', format: 'euros', higherIsBetter: true },
  { key: 'appointments_booked', label: 'Rendez-vous réservés', format: 'int', higherIsBetter: true },
  { key: 'cost_per_booked_cents', label: 'Coût par rendez-vous', format: 'euros', threshold: { key: 'cost_per_booked_max_cents', kind: 'max' }, higherIsBetter: false },
  { key: 'visitor_to_booked', label: 'Visiteur → rendez-vous', format: 'percent', higherIsBetter: true },
  { key: 'sales', label: 'Nouveaux clients', format: 'int', higherIsBetter: true },
  { key: 'cash_collected_cents', label: "Chiffre d'affaires encaissé", format: 'euros', higherIsBetter: true },
  { key: 'roas_cash', label: 'ROAS encaissé', format: 'ratio', threshold: { key: 'roas_cash_min', kind: 'min' }, higherIsBetter: true },
  { key: 'cac_cents', label: "Coût d'acquisition", format: 'euros', higherIsBetter: false },
  { key: 'link_clicks', label: 'Clics', format: 'int', higherIsBetter: true },
  { key: 'ctr', label: 'CTR', format: 'percent', threshold: { key: 'ctr_min', kind: 'min' }, higherIsBetter: true },
  { key: 'cpc_cents', label: 'CPC', format: 'euros', threshold: { key: 'cpc_max_cents', kind: 'max' }, higherIsBetter: false },
  { key: 'cpm_cents', label: 'CPM', format: 'euros', threshold: { key: 'cpm_max_cents', kind: 'max' }, higherIsBetter: false },
  { key: 'vsl_views', label: 'Vues de VSL', format: 'int', higherIsBetter: true },
  { key: 'cancel_rate', label: "Taux d'annulation", format: 'percent', threshold: { key: 'cancel_rate_max', kind: 'max' }, higherIsBetter: false },
  { key: 'show_rate', label: 'Taux de présence', format: 'percent', higherIsBetter: true },
  { key: 'mrr_added_cents', label: 'MRR ajouté', format: 'euros', higherIsBetter: true },
];

/** Mesures brutes dont dépend chaque indicateur : si l'une n'est pas mesurée pour le client, l'indicateur ne l'est pas. */
export const KPI_DEPENDS: Record<string, (keyof Totals)[]> = {
  spend_cents: ['spend_cents'], appointments_booked: ['appointments_booked'], cost_per_booked_cents: ['spend_cents', 'appointments_booked'],
  visitor_to_booked: ['landing_page_views', 'appointments_booked'], sales: ['sales'], cash_collected_cents: ['cash_collected_cents'],
  roas_cash: ['cash_collected_cents', 'spend_cents'], cac_cents: ['spend_cents', 'sales'], link_clicks: ['link_clicks'],
  ctr: ['link_clicks', 'impressions'], cpc_cents: ['spend_cents', 'link_clicks'], cpm_cents: ['spend_cents', 'impressions'],
  vsl_views: ['vsl_views'], cancel_rate: ['appointments_booked'], show_rate: ['appointments_held'], mrr_added_cents: [],
};

export interface KpiValue { key: string; value: number | null; previous: number | null; verdict: Verdict | null; reason: string | null }

export interface AppointmentRates { cancel_rate: number | null; show_rate: number | null; reasonShow: string | null; reasonCancel: string | null }

export function kpiValues(
  cur: Totals | null, prev: Totals | null, rates: { cur: AppointmentRates; prev: AppointmentRates },
  thresholds: Thresholds, unmeasured: Set<string>,
): KpiValue[] {
  const pick = (t: Totals | null, r: AppointmentRates, key: string): number | null => {
    if (key === 'cancel_rate') return r.cancel_rate;
    if (key === 'show_rate') return r.show_rate;
    if (key === 'mrr_added_cents' || !t) return null;
    if (key in t) return t[key as keyof Totals];
    return (derived(t) as Record<string, number | null>)[key] ?? null;
  };
  return PILOTAGE_KPIS.map((k) => {
    const deps = KPI_DEPENDS[k.key];
    const notMeasured = k.key === 'mrr_added_cents' || deps.some((d) => unmeasured.has(d));
    if (notMeasured) {
      return { key: k.key, value: null, previous: null, verdict: k.threshold ? 'non_mesure' : null,
        reason: k.key === 'mrr_added_cents' ? 'Aucune source ne fournit encore le MRR' : 'Non synchronisé pour ce client' };
    }
    let value = pick(cur, rates.cur, k.key);
    let previous = pick(prev, rates.prev, k.key);
    // Aucune source ne mesure encore les vues de VSL : un 0 n'est pas une mesure.
    if (k.key === 'vsl_views' && !value) {
      return { key: k.key, value: null, previous: null, verdict: null, reason: 'Pas encore mesuré (aucune source ne remonte les vues de VSL)' };
    }
    let reason: string | null = null;
    if (value == null) {
      reason = !cur ? 'Aucune donnée synchronisée sur la période'
        : k.key === 'show_rate' ? rates.cur.reasonShow : k.key === 'cancel_rate' ? rates.cur.reasonCancel
        : 'Dénominateur nul sur la période';
    }
    const limit = k.threshold ? (thresholds[k.threshold.key] as number | null) : null;
    return {
      key: k.key, value, previous, reason,
      verdict: k.threshold ? (limit == null ? 'non_mesure' : verdict(value, limit, k.threshold.kind)) : null,
    };
  });
}

export interface FunnelStep { key: keyof Totals; label: string; value: number | null; rate: number | null; verdict: Verdict | null }

/** Funnel du bloc 03 : impressions → clics → pages chargées → vues de VSL → RDV réservés → tenus → nouveaux clients. */
export function funnel(t: Totals | null, thresholds: Thresholds, unmeasured: Set<string>): FunnelStep[] {
  const steps: [keyof Totals, string][] = [
    ['impressions', 'Impressions'], ['link_clicks', 'Clics'], ['landing_page_views', 'Pages chargées'], ['vsl_views', 'Vues de VSL'],
    ['appointments_booked', 'Rendez-vous réservés'], ['appointments_held', 'Rendez-vous tenus'], ['sales', 'Nouveaux clients'],
  ];
  let prevVal: number | null = null;
  return steps.map(([key, label], i) => {
    let value = !t || unmeasured.has(key) ? null : t[key];
    // Aucune source ne mesure encore les vues de VSL : un 0 n'est pas une mesure, le palier est sauté.
    if (key === 'vsl_views' && value === 0) value = null;
    const rate = i === 0 || value == null || prevVal == null ? null : safeDiv(value, prevVal);
    const v: Verdict | null = key === 'link_clicks' ? verdict(rate, thresholds.ctr_min, 'min') : null;
    if (value != null && value > 0) prevVal = value;
    return { key, label, value, rate, verdict: v };
  });
}
