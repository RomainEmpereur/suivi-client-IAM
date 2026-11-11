import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { DASH, VERDICT_LABEL, formatDate, formatDateTime, formatDelta, type Verdict } from '@obsidian/domain';
import { useSession } from '../session.ts';

/** Titre en deux temps : romaine puis italique (§15). */
export function TwoTone({ a, b }: { a: string; b: string }) {
  return <>{a} <em>{b}</em></>;
}

export function PageHead(props: { a: string; b: string; sub?: ComponentChildren; lastSync?: string | null | undefined; right?: ComponentChildren }) {
  return (
    <header class="page-head">
      <div>
        <SyncStamp at={props.lastSync} />
        <h1 class="page-title"><TwoTone a={props.a} b={props.b} /></h1>
        {props.sub && <p class="page-sub">{props.sub}</p>}
      </div>
      {props.right && <div class="no-print">{props.right}</div>}
    </header>
  );
}

/** Date de dernière synchronisation, en haut de chaque écran (§15). */
export function SyncStamp({ at }: { at?: string | null }) {
  if (at === undefined) return null;
  return <div class="sync-stamp">{at ? `Dernière synchronisation : ${formatDateTime(at)}` : 'Aucune synchronisation pour le moment'}</div>;
}

export function SectionTitle({ num, a, b, right }: { num?: string; a: string; b: string; right?: ComponentChildren }) {
  return (
    <h2 class="section-title">
      {num && <span class="num">{num} ·</span>}
      <span><TwoTone a={a} b={b} /></span>
      {right && <span style="margin-left:auto">{right}</span>}
    </h2>
  );
}

export function Pill({ kind, children }: { kind: string; children: ComponentChildren }) {
  // La couleur n'est jamais seule : la pastille porte toujours son libellé (§17).
  return <span class={`pill ${kind}`}>{children}</span>;
}

export function VerdictPill({ v }: { v: Verdict }) {
  return <Pill kind={v}>{VERDICT_LABEL[v]}</Pill>;
}

export const SEVERITY_LABEL: Record<string, string> = { info: 'Information', surveiller: 'À surveiller', corriger: 'À corriger' };
export const SEVERITY_EDGE: Record<string, string> = { info: 'var(--accent)', surveiller: 'var(--warn)', corriger: 'var(--alert)' };

export function KpiCard(props: {
  label: string;
  value: string;
  /** Raison affichée quand la valeur est absente (« — »). */
  missingReason?: string | null;
  delta?: number | null;
  higherIsBetter?: boolean;
  sub?: ComponentChildren;
  edge?: string;
  verdict?: Verdict;
}) {
  const missing = props.value === DASH;
  const d = props.delta;
  const cls = d == null || Math.round(d * 100) === 0 ? 'flat' : (d > 0) === (props.higherIsBetter ?? true) ? 'good' : 'bad';
  return (
    <div class="card edge kpi" style={props.edge ? { '--edge': props.edge } : undefined}>
      <div class="kpi-row"><span class="label">{props.label}</span>{props.verdict && <VerdictPill v={props.verdict} />}</div>
      <div class={`kpi-value ${missing ? 'missing' : ''}`}>{props.value}</div>
      {missing
        ? <div class="kpi-sub">{props.missingReason ?? 'Pas encore de donnée'}</div>
        : (
          <>
            {d !== undefined && <span class={`delta ${cls}`} title="Variation par rapport à la période précédente">{d == null ? `${DASH} vs préc.` : `${formatDelta(d)} vs préc.`}</span>}
            {props.sub && <div class="kpi-sub">{props.sub}</div>}
          </>
        )}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ComponentChildren; action?: ComponentChildren }) {
  return (
    <div class="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div style="margin-top:14px">{action}</div>}
    </div>
  );
}

export function Loading() {
  return <div class="muted mono small" role="status">Chargement…</div>;
}

export function ErrorBox({ error }: { error: Error }) {
  return <div class="banner alert" role="alert">{error.message}</div>;
}

/** Mention grise visible seulement en vue agence (§4). */
export function AgencyNote({ children }: { children: ComponentChildren }) {
  const { view, isAgency } = useSession();
  if (!isAgency || view !== 'agence') return null;
  return <div class="agency-note">Vue agence : {children}</div>;
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div class="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** Barres par jour, deux séries, échelles indépendantes, légende sous le graphique (§8). */
export function DualBarChart(props: {
  data: { date: string; a: number | null; b: number | null }[];
  a: { label: string; format: (v: number) => string };
  b: { label: string; format: (v: number) => string };
}) {
  const W = 640, H = 190, PAD_B = 22, PAD_T = 8;
  const n = props.data.length || 1;
  const maxA = Math.max(1, ...props.data.map((d) => d.a ?? 0));
  const maxB = Math.max(1, ...props.data.map((d) => d.b ?? 0));
  const slot = W / n;
  const bw = Math.max(1.5, slot * 0.36);
  const h = H - PAD_B - PAD_T;
  const totalA = props.data.reduce((s, d) => s + (d.a ?? 0), 0);
  const totalB = props.data.reduce((s, d) => s + (d.b ?? 0), 0);
  const tickEvery = Math.ceil(n / 6);
  return (
    <div class="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${props.a.label} et ${props.b.label} par jour`}>
        <line x1="0" x2={W} y1={H - PAD_B} y2={H - PAD_B} stroke="var(--border)" />
        {props.data.map((d, i) => {
          const x = i * slot + slot / 2;
          const ha = d.a == null ? 0 : (d.a / maxA) * h;
          const hb = d.b == null ? 0 : (d.b / maxB) * h;
          return (
            <g>
              <title>{`${formatDate(d.date)} — ${props.a.label} : ${d.a == null ? DASH : props.a.format(d.a)} · ${props.b.label} : ${d.b == null ? DASH : props.b.format(d.b)}`}</title>
              <rect x={x - bw - 0.5} y={H - PAD_B - ha} width={bw} height={ha} rx="1.5" fill="var(--accent)" />
              <rect x={x + 0.5} y={H - PAD_B - hb} width={bw} height={hb} rx="1.5" fill="var(--series-2)" />
              {d.a == null && <line x1={x - 3} x2={x + 3} y1={H - PAD_B - 3} y2={H - PAD_B - 3} stroke="var(--text-2)" />}
              {i % tickEvery === 0 && (
                <text x={x} y={H - 6} text-anchor="middle" font-size="10" font-family="var(--font-mono)" fill="var(--text-2)">
                  {formatDate(d.date, { year: false })}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div class="legend">
        <span><i style="background:var(--accent)" />{props.a.label} · {props.a.format(totalA)}</span>
        <span><i style="background:var(--series-2)" />{props.b.label} · {props.b.format(totalB)}</span>
        <span class="mono small">échelles indépendantes</span>
      </div>
    </div>
  );
}

export function HBars({ rows, format }: { rows: { label: string; value: number }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div class="bars">
      {rows.map((r) => (
        <div class="bar-row">
          <span>{r.label}</span>
          <div class="bar-track" aria-hidden="true"><div style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <span class="mono" style="text-align:right">{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

export interface Column<R> {
  key: string;
  label: string;
  value: (r: R) => number | string | null;
  render?: (r: R) => ComponentChildren;
}

/** Tableau triable, première colonne figée, défilement horizontal dans son conteneur (§15, §17). */
export function DataTable<R>({ rows, columns, initialSort, rowClass, caption }: {
  rows: R[]; columns: Column<R>[]; initialSort?: { key: string; dir: 'asc' | 'desc' }; rowClass?: (r: R) => string; caption: string;
}) {
  const [sort, setSort] = useState(initialSort ?? { key: columns[0].key, dir: 'desc' as const });
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key)!;
    return [...rows].sort((x, y) => {
      const a = col.value(x), b = col.value(y);
      if (a === b) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      const r = a < b ? -1 : 1;
      return sort.dir === 'asc' ? r : -r;
    });
  }, [rows, sort, columns]);
  return (
    <div class="table-wrap">
      <table>
        <caption class="label" style="position:absolute;left:-9999px">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th scope="col" aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button type="button" onClick={() => setSort({ key: c.key, dir: sort.key === c.key && sort.dir === 'desc' ? 'asc' : 'desc' })}>
                  {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr class={rowClass?.(r) ?? ''}>
              {columns.map((c) => <td>{c.render ? c.render(r) : (c.value(r) ?? DASH)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
