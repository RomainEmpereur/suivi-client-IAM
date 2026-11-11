/**
 * Formats d'affichage français (§15) : espace avant €, espace fine insécable comme séparateur
 * de milliers (Intl fr-FR), dates abrégées, fuseau Europe/Paris. Une absence de mesure
 * s'affiche « — », jamais 0.
 */
export const DASH = '—';
const TZ = 'Europe/Paris';

const eur0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const dec1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const dec2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

const isMissing = (v: number | null | undefined): v is null | undefined =>
  v === null || v === undefined || Number.isNaN(v) || !Number.isFinite(v);

/** Montant en centimes → « 1 234 € » (ou avec centimes si < 100 € ou demandé). */
export function formatEuros(cents: number | null | undefined, opts: { decimals?: boolean } = {}): string {
  if (isMissing(cents)) return DASH;
  const euros = cents / 100;
  const withDecimals = opts.decimals ?? Math.abs(euros) < 100;
  return (withDecimals ? eur2 : eur0).format(euros);
}

export function formatInt(v: number | null | undefined): string {
  return isMissing(v) ? DASH : int.format(v);
}

/** Ratio 0..1 → « 1,8 % ». */
export function formatPercent(ratio: number | null | undefined, digits: 1 | 2 = 1): string {
  if (isMissing(ratio)) return DASH;
  return `${(digits === 1 ? dec1 : dec2).format(ratio * 100)} %`;
}

export function formatRatio(v: number | null | undefined): string {
  return isMissing(v) ? DASH : dec2.format(v);
}

/** Variation relative (0.12 → « +12 % »). */
export function formatDelta(ratio: number | null | undefined): string {
  if (isMissing(ratio)) return DASH;
  const pct = Math.round(ratio * 100);
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${sign}${int.format(Math.abs(pct))} %`;
}

/** « 12 nov. 2026 » — accepte AAAA-MM-JJ (jour calendaire) ou ISO horodaté (converti à Paris). */
export function formatDate(value: string | null | undefined, opts: { year?: boolean } = {}): string {
  if (!value) return DASH;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = dateOnly ? new Date(`${value}T12:00:00Z`) : new Date(value);
  if (Number.isNaN(d.getTime())) return DASH;
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric', month: 'short', ...(opts.year === false ? {} : { year: 'numeric' }),
    timeZone: dateOnly ? 'UTC' : TZ,
  }).format(d);
}

/** « 12 nov. 2026 à 06 h 04 » */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  const date = formatDate(iso);
  const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ, hourCycle: 'h23' })
    .format(d).replace(':', ' h ');
  return `${date} à ${time}`;
}

/** Date du jour à Paris, AAAA-MM-JJ. */
export function todayParis(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
