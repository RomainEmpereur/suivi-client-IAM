/**
 * Suivi financier de l'agence (décision 0019) : deals signés croisés avec la dépense, les leads et les rendez-vous
 * de l'acquisition de l'agence. Aucune donnée inventée : un ratio sans dénominateur mesuré vaut null (« — »).
 */
import { safeDiv } from './kpis.ts';

export type DealKind = 'nouveau' | 'renouvellement' | 'upsell';
export type DealSource = 'publicite' | 'autre' | 'inconnue';
export const DEAL_KIND_LABEL: Record<DealKind, string> = { nouveau: 'Nouveau client', renouvellement: 'Renouvellement', upsell: 'Upsell' };
export const DEAL_SOURCE_LABEL: Record<DealSource, string> = { publicite: 'Publicité', autre: 'Autre canal', inconnue: 'Non précisée' };

export interface Deal {
  id: string;
  clientName: string;
  date: string;
  amountCents: number;
  kind: DealKind;
  installments: number;
  source: DealSource;
  note: string | null;
}

/** Chiffres d'acquisition de l'agence sur une période (null = rien de synchronisé). */
export interface AcquisitionTotals {
  spend_cents: number;
  leads: number;
  appointments_booked: number;
  appointments_held: number;
}

/** Même jour, N mois plus tard (borné à la fin du mois : 31 janv. + 1 mois → 28 ou 29 févr.). */
export function addMonthsYmd(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

/** Échéancier : N mensualités à partir du jour de signature ; le reste des centimes va sur la première. */
export function dealPayments(deal: Pick<Deal, 'date' | 'amountCents' | 'installments'>): { date: string; amountCents: number }[] {
  const n = Math.max(1, Math.floor(deal.installments));
  const base = Math.floor(deal.amountCents / n);
  return Array.from({ length: n }, (_, k) => ({ date: addMonthsYmd(deal.date, k), amountCents: base + (k === 0 ? deal.amountCents - base * n : 0) }));
}

const key = (name: string) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export interface FinanceSummary {
  signedCents: number;
  collectedCents: number;
  /** Mensualités pas encore échues (au jour du calcul), sur les deals signés de la période. */
  upcomingCents: number;
  deals: number;
  newClients: number;
  newClientsFromAds: number;
  avgDealCents: number | null;
  spendCents: number | null;
  leads: number | null;
  booked: number | null;
  held: number | null;
  cplCents: number | null;
  costPerBookedCents: number | null;
  costPerHeldCents: number | null;
  showRate: number | null;
  /** Nouveaux clients / rendez-vous tenus. */
  closeRate: number | null;
  /** Dépense / nouveaux clients, tous canaux confondus. */
  cacCents: number | null;
  /** Dépense / nouveaux clients marqués « publicité » (null si aucun deal n'est marqué). */
  cacAdsCents: number | null;
  /** CA signé / dépense. */
  roas: number | null;
  /** Encaissé − dépense publicitaire. */
  marginAfterAdsCents: number | null;
}

export function summarize(deals: Deal[], acq: AcquisitionTotals | null, from: string, to: string, today: string): FinanceSummary {
  const inPeriod = deals.filter((d) => d.date >= from && d.date <= to);
  const signed = inPeriod.reduce((s, d) => s + d.amountCents, 0);
  let collected = 0, upcoming = 0;
  for (const d of deals) for (const p of dealPayments(d)) {
    if (p.date >= from && p.date <= to && p.date <= today) collected += p.amountCents;
  }
  for (const d of inPeriod) for (const p of dealPayments(d)) if (p.date > today) upcoming += p.amountCents;
  const newClients = inPeriod.filter((d) => d.kind === 'nouveau').length;
  const tagged = inPeriod.some((d) => d.source !== 'inconnue');
  const newFromAds = inPeriod.filter((d) => d.kind === 'nouveau' && d.source === 'publicite').length;
  const spend = acq?.spend_cents ?? null;
  return {
    signedCents: signed,
    collectedCents: collected,
    upcomingCents: upcoming,
    deals: inPeriod.length,
    newClients,
    newClientsFromAds: newFromAds,
    avgDealCents: safeDiv(signed, inPeriod.length),
    spendCents: spend,
    leads: acq?.leads ?? null,
    booked: acq?.appointments_booked ?? null,
    held: acq?.appointments_held ?? null,
    cplCents: acq ? safeDiv(acq.spend_cents, acq.leads) : null,
    costPerBookedCents: acq ? safeDiv(acq.spend_cents, acq.appointments_booked) : null,
    costPerHeldCents: acq ? safeDiv(acq.spend_cents, acq.appointments_held) : null,
    showRate: acq ? safeDiv(acq.appointments_held, acq.appointments_booked) : null,
    closeRate: acq ? safeDiv(newClients, acq.appointments_held) : null,
    cacCents: spend === null ? null : safeDiv(spend, newClients),
    cacAdsCents: spend === null || !tagged ? null : safeDiv(spend, newFromAds),
    roas: spend === null ? null : safeDiv(signed, spend),
    marginAfterAdsCents: spend === null ? null : collected - spend,
  };
}

export interface LifetimeValue {
  clients: number;
  /** CA signé moyen par client, depuis le premier deal. */
  ltvCents: number | null;
  /** Part des clients qui ont signé plus d'un deal. */
  repeatRate: number | null;
  avgDealsPerClient: number | null;
  topClients: { name: string; totalCents: number; deals: number }[];
}

export function lifetimeValue(deals: Deal[]): LifetimeValue {
  const by = new Map<string, { name: string; totalCents: number; deals: number }>();
  for (const d of deals) {
    const k = key(d.clientName);
    const cur = by.get(k) ?? { name: d.clientName, totalCents: 0, deals: 0 };
    cur.totalCents += d.amountCents;
    cur.deals += 1;
    by.set(k, cur);
  }
  const list = [...by.values()].sort((a, b) => b.totalCents - a.totalCents);
  const total = list.reduce((s, c) => s + c.totalCents, 0);
  return {
    clients: list.length,
    ltvCents: safeDiv(total, list.length),
    repeatRate: safeDiv(list.filter((c) => c.deals > 1).length, list.length),
    avgDealsPerClient: safeDiv(deals.length, list.length),
    topClients: list.slice(0, 10),
  };
}

/** Mois AAAA-MM de `from` à `to` inclus. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonthsYmd(`${m}-01`, 1).slice(0, 7)) out.push(m);
  return out;
}

export function lastDayOfMonth(month: string): string {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
}
