/**
 * ⚠️ SEUL ENDROIT où se définit un « rendez-vous validé » (§6, règle non négociable).
 * Toute évolution de cette définition est une décision (docs/decisions) et se journalise.
 *
 * Définition par défaut (§20, en attente de confirmation) :
 *   un rendez-vous est validé s'il a eu lieu (statut « honoré »), n'a pas été annulé,
 *   et n'a pas été marqué hors cible par l'agence (counts_toward_target = 1).
 *   Il compte s'il s'est tenu pendant la fenêtre contractuelle
 *   [campaigns_launched_at ; campaigns_launched_at + window_days[ (fuseau Europe/Paris).
 *
 * Un rendez-vous passé sans statut renseigné dans GoHighLevel reste « prévu » : il n'est
 * PAS compté comme validé, et l'écart est affiché explicitement (pendingStatus).
 */
export const VALIDATED_APPOINTMENT_DEFINITION =
  "Un rendez-vous est validé s'il a eu lieu (statut « honoré » dans le CRM), n'a pas été annulé " +
  "et n'a pas été marqué hors cible par l'agence. Il compte s'il s'est tenu pendant la fenêtre " +
  'contractuelle qui démarre au lancement des campagnes. Un rendez-vous passé dont le statut ' +
  "n'est pas renseigné reste « prévu » et n'est pas compté.";

export type AppointmentStatus = 'prevu' | 'annule' | 'honore' | 'absent';

export interface AppointmentLike {
  scheduled_at: string; // ISO UTC
  status: AppointmentStatus;
  counts_toward_target: number | boolean;
}

export interface CounterClient {
  campaigns_launched_at: string | null; // AAAA-MM-JJ
  appointment_target: number;
  window_days: number;
}

export interface AppointmentCounter {
  started: boolean;
  validated: number;
  target: number;
  windowDays: number;
  windowStart: string | null; // AAAA-MM-JJ
  windowEnd: string | null; // AAAA-MM-JJ, exclu
  daysElapsed: number;
  daysRemaining: number;
  /** Passés, dans la fenêtre, toujours « prévu » : statut manquant dans le CRM. */
  pendingStatus: number;
  /** À venir, dans la fenêtre. */
  upcoming: number;
  excluded: number;
  /** Nombre attendu à ce stade si le rythme était linéaire. */
  expectedByNow: number;
  onPace: boolean;
  /** Rendez-vous validés nécessaires par semaine restante pour atteindre l'objectif. */
  requiredPerWeek: number | null;
  definition: string;
}

export function isValidatedAppointment(a: AppointmentLike): boolean {
  return a.status === 'honore' && Boolean(Number(a.counts_toward_target));
}

const DAY_MS = 86_400_000;

/** Début de journée Europe/Paris (en ms UTC) pour une date AAAA-MM-JJ. */
export function parisDayStartMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  // Décalage de Paris à midi UTC ce jour-là (évite les ambiguïtés de changement d'heure).
  const noonUtc = Date.UTC(y, m - 1, d, 12);
  const offsetMin = parisOffsetMinutes(noonUtc);
  return Date.UTC(y, m - 1, d) - offsetMin * 60_000;
}

export function parisOffsetMinutes(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - utcMs) / 60_000);
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

export function computeAppointmentCounter(
  client: CounterClient,
  appointments: AppointmentLike[],
  now: Date = new Date(),
): AppointmentCounter {
  const target = client.appointment_target;
  const windowDays = client.window_days;
  const base = {
    target, windowDays, definition: VALIDATED_APPOINTMENT_DEFINITION,
  };
  if (!client.campaigns_launched_at) {
    return {
      ...base, started: false, validated: 0, windowStart: null, windowEnd: null,
      daysElapsed: 0, daysRemaining: windowDays, pendingStatus: 0, upcoming: 0, excluded: 0,
      expectedByNow: 0, onPace: true, requiredPerWeek: null,
    };
  }
  const windowStart = client.campaigns_launched_at;
  const windowEnd = addDaysYmd(windowStart, windowDays);
  const startMs = parisDayStartMs(windowStart);
  const endMs = parisDayStartMs(windowEnd);
  const nowMs = now.getTime();

  let validated = 0, pendingStatus = 0, upcoming = 0, excluded = 0;
  for (const a of appointments) {
    const t = Date.parse(a.scheduled_at);
    if (Number.isNaN(t) || t < startMs || t >= endMs) continue;
    if (!Number(a.counts_toward_target)) { excluded++; continue; }
    if (isValidatedAppointment(a)) validated++;
    else if (a.status === 'prevu' && t <= nowMs) pendingStatus++;
    else if (a.status === 'prevu') upcoming++;
  }

  const daysElapsed = Math.min(windowDays, Math.max(0, Math.floor((nowMs - startMs) / DAY_MS)));
  const daysRemaining = Math.max(0, windowDays - daysElapsed);
  const expectedByNow = Math.round((target * daysElapsed) / windowDays * 10) / 10;
  const missing = Math.max(0, target - validated);
  return {
    ...base,
    started: nowMs >= startMs,
    validated, windowStart, windowEnd, daysElapsed, daysRemaining,
    pendingStatus, upcoming, excluded, expectedByNow,
    onPace: validated >= Math.floor(expectedByNow),
    requiredPerWeek: daysRemaining > 0 ? Math.round((missing / (daysRemaining / 7)) * 10) / 10 : null,
  };
}
