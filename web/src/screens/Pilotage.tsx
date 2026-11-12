import { useState } from 'preact/hooks';
import {
  DASH, PILOTAGE_KPIS, VERDICT_LABEL, addDaysYmd, delta, formatDate, formatEuros, formatInt, formatPercent, formatRatio, todayParis,
  type Thresholds, type Verdict,
} from '@obsidian/domain';
import { ApiError, api, useApi } from '../api.ts';
import { useSession } from '../session.ts';
import { useLastSync } from './Screens.tsx';
import { AnalysesBlock } from './Analyses.tsx';
import { AgencyNote, DataTable, EmptyState, ErrorBox, KpiCard, Loading, PageHead, Pill, SectionTitle, Segmented } from '../components/ui.tsx';

type G = 'day' | 'week' | 'month';
type Point = Record<string, number | null> & { date: string };
interface KpiValue { key: string; value: number | null; previous: number | null; verdict: Verdict | null; reason: string | null }
interface Pilotage {
  period: { from: string; to: string; prevFrom: string; prevTo: string; days: number };
  granularity: G; dataRange: { first: string | null; last: string | null };
  currency: { adAccount: string; shown: string };
  thresholds: Thresholds; unmeasured: string[];
  kpis: KpiValue[];
  funnel: { key: string; label: string; value: number | null; rate: number | null; verdict: Verdict | null }[];
  costs: { per_click_cents: number | null; per_visitor_cents: number | null; per_booked_cents: number | null; per_client_cents: number | null } | null;
  series: Point[]; seriesPrevious: Point[];
  events: { id: string; date: string; label: string; description: string | null }[];
  campaigns: Record<string, any>[];
  ads: Record<string, any>[];
}

const fmt = (format: string, v: number | null) =>
  v == null ? DASH : format === 'euros' ? formatEuros(v, { decimals: v < 100000 }) : format === 'int' ? formatInt(v)
    : format === 'percent' ? formatPercent(v, v < 0.1 ? 2 : 1) : formatRatio(v);

function monthBounds(offset: number) {
  const y = addDaysYmd(todayParis(), -1);
  const d = new Date(`${y.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + offset);
  const from = d.toISOString().slice(0, 10);
  const end = new Date(d); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
  const to = end.toISOString().slice(0, 10);
  return { from, to: to < y ? to : y };
}

export function PilotageScreen({ clientId, search }: { clientId: string; search?: string }) {
  const lastSync = useLastSync(clientId);
  const yesterday = addDaysYmd(todayParis(), -1);
  const initDays = Number(new URLSearchParams(search ?? '').get('jours'));
  const [preset, setPreset] = useState<string>([7, 14, 30, 90].includes(initDays) ? String(initDays) : '30');
  const [range, setRange] = useState({ from: addDaysYmd(yesterday, -29), to: yesterday });
  const [draft, setDraft] = useState(range);
  const [g, setG] = useState<G>('day');
  const [compare, setCompare] = useState(true);
  const query = ['7', '14', '30', '90'].includes(preset) ? `days=${preset}` : `from=${range.from}&to=${range.to}`;
  const { data, error, loading, reload } = useApi<Pilotage>(`/clients/${clientId}/pilotage?${query}&g=${g}`);

  function choose(p: string) {
    setPreset(p);
    if (p === 'mois') setRange(monthBounds(0));
    if (p === 'mois-1') setRange(monthBounds(-1));
    if (p === 'tout' && data?.dataRange.first) setRange({ from: data.dataRange.first, to: yesterday });
    if (p.startsWith('jalon:')) {
      const e = data?.events.find((x) => x.id === p.slice(6));
      if (e) setRange({ from: e.date, to: yesterday });
    }
  }

  return (
    <>
      <PageHead a="Pilotage" b="détaillé" lastSync={lastSync} sub="L'écran de travail : l'analyse, les chiffres clés, le funnel, l'évolution, les campagnes et les publicités." />
      <AnalysesBlock clientId={clientId} />

      <div class="card section" style="display:flex;flex-direction:column;gap:10px;position:sticky;top:0;z-index:2">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <Segmented label="Période" value={preset} onChange={choose} options={[
            { value: '7', label: '7 j' }, { value: '14', label: '14 j' }, { value: '30', label: '30 j' }, { value: '90', label: '90 j' },
            { value: 'mois', label: 'Ce mois' }, { value: 'mois-1', label: 'Mois dernier' }, { value: 'tout', label: 'Tout' }, { value: 'perso', label: 'Dates…' },
          ]} />
          {data && data.events.length > 0 && (
            <select class="client-select" style="width:auto" aria-label="Depuis un jalon" value={preset.startsWith('jalon:') ? preset : ''}
              onChange={(e) => choose((e.target as HTMLSelectElement).value)}>
              <option value="">Depuis un jalon…</option>
              {data.events.map((e) => <option value={`jalon:${e.id}`}>Depuis « {e.label} » ({formatDate(e.date)})</option>)}
            </select>
          )}
          <Segmented label="Granularité" value={g} onChange={setG} options={[{ value: 'day', label: 'Jour' }, { value: 'week', label: 'Semaine' }, { value: 'month', label: 'Mois' }]} />
          <label class="small muted" style="display:inline-flex;gap:6px;align-items:center">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare((e.target as HTMLInputElement).checked)} /> vs période précédente
          </label>
        </div>
        {preset === 'perso' && (
          <form class="date-range" onSubmit={(e) => { e.preventDefault(); if (draft.from <= draft.to) setRange(draft); }}>
            <input type="date" aria-label="Du" value={draft.from} max={draft.to} onInput={(e) => setDraft({ ...draft, from: (e.target as HTMLInputElement).value })} />
            <input type="date" aria-label="Au" value={draft.to} min={draft.from} max={yesterday} onInput={(e) => setDraft({ ...draft, to: (e.target as HTMLInputElement).value })} />
            <button class="ghost-btn" type="submit">Appliquer</button>
          </form>
        )}
        {data && (
          <span class="mono small muted">
            Du {formatDate(data.period.from, { year: true })} au {formatDate(data.period.to, { year: true })} · {data.period.days} j
            {compare && <> · comparé au {formatDate(data.period.prevFrom)} → {formatDate(data.period.prevTo)}</>}
            {data.currency.adAccount !== 'EUR' && <> · montants en euros (compte en {data.currency.adAccount}, converti au taux BCE du jour)</>}
          </span>
        )}
      </div>

      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading />}
      {data && <Blocks clientId={clientId} d={data} compare={compare} onEvents={reload} />}
    </>
  );
}

function Blocks({ clientId, d, compare, onEvents }: { clientId: string; d: Pilotage; compare: boolean; onEvents: () => void }) {
  const noData = d.kpis.find((k) => k.key === 'spend_cents')?.value == null && d.kpis.find((k) => k.key === 'appointments_booked')?.value == null;
  return (
    <>
      {/* 02 · KPI clés */}
      <div class="section">
        <SectionTitle num="02" a="KPI" b="clés" />
        <div class="grid grid-4">
          {PILOTAGE_KPIS.map((def) => {
            const k = d.kpis.find((x) => x.key === def.key)!;
            return (
              <KpiCard label={def.label} value={fmt(def.format, k.value)} missingReason={k.reason}
                delta={compare ? delta(k.value, k.previous) : undefined} higherIsBetter={def.higherIsBetter}
                verdict={k.value != null && k.verdict && k.verdict !== 'non_mesure' ? k.verdict : undefined}
                sub={compare ? <>Préc. {fmt(def.format, k.previous)}{def.threshold && d.thresholds[def.threshold.key] != null ? <> · seuil {fmt(def.format, d.thresholds[def.threshold.key] as number)}</> : null}</> : null} />
            );
          })}
        </div>
      </div>

      {noData ? (
        <div class="section"><EmptyState title="Aucun chiffre sur cette période">Choisissez une autre période : les chiffres apparaissent après la synchronisation de 6 h.</EmptyState></div>
      ) : (
        <>
          {/* 03 · Du clic à la vente */}
          <div class="section">
            <SectionTitle num="03" a="Du clic" b="à la vente" />
            <div class="card"><Funnel steps={d.funnel} /></div>
            {d.costs && (
              <div class="grid grid-4" style="margin-top:10px">
                <KpiCard label="Coût par clic" value={fmt('euros', d.costs.per_click_cents)} missingReason="Aucun clic" />
                <KpiCard label="Coût par visiteur" value={fmt('euros', d.costs.per_visitor_cents)} missingReason="Aucune page chargée mesurée" />
                <KpiCard label="Coût par rendez-vous" value={fmt('euros', d.costs.per_booked_cents)} missingReason={d.unmeasured.includes('appointments_booked') ? 'Non synchronisé pour ce client' : 'Aucun rendez-vous'} />
                <KpiCard label="Coût par client" value={fmt('euros', d.costs.per_client_cents)} missingReason={d.unmeasured.includes('sales') ? 'Non synchronisé pour ce client' : 'Aucun nouveau client'} />
              </div>
            )}
          </div>

          {/* 04 · Évolution */}
          <Evolution clientId={clientId} d={d} compare={compare} onEvents={onEvents} />

          {/* 05 · Campagnes */}
          <div class="section">
            <SectionTitle num="05" a="Campagnes" b="sur la période" />
            <DataTable caption="Campagnes" rows={d.campaigns} initialSort={{ key: 'spend', dir: 'desc' }} columns={[
              { key: 'name', label: 'Campagne', value: (r) => r.name },
              { key: 'budget', label: 'Budget / jour', value: (r) => r.daily_budget_cents, render: (r) => fmt('euros', r.daily_budget_cents) },
              { key: 'spend', label: 'Dépense', value: (r) => r.spend_cents, render: (r) => formatEuros(r.spend_cents) },
              { key: 'imp', label: 'Impressions', value: (r) => r.impressions, render: (r) => formatInt(r.impressions) },
              { key: 'cpm', label: 'CPM', value: (r) => r.cpm_cents, render: (r) => fmt('euros', r.cpm_cents) },
              { key: 'clicks', label: 'Clics', value: (r) => r.link_clicks, render: (r) => formatInt(r.link_clicks) },
              { key: 'ctr', label: 'CTR', value: (r) => r.ctr, render: (r) => fmt('percent', r.ctr) },
              { key: 'cpc', label: 'CPC', value: (r) => r.cpc_cents, render: (r) => fmt('euros', r.cpc_cents) },
              { key: 'vis', label: 'Visiteurs', value: (r) => r.visitors, render: (r) => formatInt(r.visitors) },
              { key: 'cpv', label: 'Coût / visiteur', value: (r) => r.cost_per_visitor_cents, render: (r) => fmt('euros', r.cost_per_visitor_cents) },
              { key: 'vsl', label: 'Vues VSL', value: (r) => r.vsl_views, render: (r) => fmt('int', r.vsl_views) },
              { key: 'leads', label: 'Opt-ins', value: (r) => r.leads, render: (r) => formatInt(r.leads) },
              { key: 'rdv', label: 'Rendez-vous', value: (r) => r.appointments_booked, render: (r) => fmt('int', r.appointments_booked) },
            ]} />
          </div>

          {/* 06 · Publicités */}
          <Ads d={d} />
        </>
      )}
    </>
  );
}

function Funnel({ steps }: { steps: Pilotage['funnel'] }) {
  const vals = steps.map((s) => s.value ?? 0).filter((v) => v > 0);
  const max = Math.log10(Math.max(10, ...vals));
  return (
    <div class="bars" role="list" aria-label="Funnel, échelle logarithmique">
      {steps.map((s) => (
        <div class="bar-row" role="listitem" style="grid-template-columns:minmax(120px,170px) 1fr minmax(90px,auto) minmax(150px,auto)">
          <span>{s.label}</span>
          <div class="bar-track" aria-hidden="true"><div style={{ width: s.value ? `${Math.max(2, (Math.log10(Math.max(1, s.value)) / max) * 100)}%` : '0%' }} /></div>
          <span class="mono" style="text-align:right">{s.value == null ? DASH : formatInt(s.value)}</span>
          <span class="small" style="display:flex;gap:6px;align-items:center;justify-content:flex-end">
            {s.rate != null ? <span class="mono">{formatPercent(s.rate, s.rate < 0.1 ? 2 : 1)}</span> : <span class="muted">{s.value == null ? 'non mesuré' : ''}</span>}
            {s.verdict && <Pill kind={s.verdict}>{VERDICT_LABEL[s.verdict]}</Pill>}
          </span>
        </div>
      ))}
      <div class="mono small muted">Échelle logarithmique · taux = passage depuis le palier mesuré précédent</div>
    </div>
  );
}

const EVOLUTION = [
  { key: 'spend_cents', label: 'Dépense', format: 'euros' },
  { key: 'appointments_booked', label: 'Rendez-vous', format: 'int' },
  { key: 'cost_per_booked_cents', label: 'Coût / RDV', format: 'euros' },
  { key: 'leads', label: 'Leads', format: 'int' },
  { key: 'link_clicks', label: 'Clics', format: 'int' },
  { key: 'landing_page_views', label: 'Visiteurs', format: 'int' },
  { key: 'appointments_held', label: 'RDV tenus', format: 'int' },
] as const;

function Evolution({ clientId, d, compare, onEvents }: { clientId: string; d: Pilotage; compare: boolean; onEvents: () => void }) {
  const [tab, setTab] = useState<string>('spend_cents');
  const cur = EVOLUTION.find((e) => e.key === tab)!;
  const ev = d.events.filter((e) => e.date >= d.period.from && e.date <= d.period.to);
  return (
    <div class="section">
      <SectionTitle num="04" a="Évolution" b="et repères" />
      <div class="card">
        <Segmented label="Indicateur" value={tab} onChange={setTab} options={EVOLUTION.map((e) => ({ value: e.key, label: e.label }))} />
        <LineChart series={d.series} previous={compare ? d.seriesPrevious : null} k={cur.key} format={(v) => fmt(cur.format, v)} events={ev} />
      </div>
      <div class="grid grid-3" style="margin-top:10px">
        {([['cpm_cents', 'CPM', 'euros', d.thresholds.cpm_max_cents], ['ctr', 'CTR', 'percent', d.thresholds.ctr_min], ['cpc_cents', 'CPC', 'euros', d.thresholds.cpc_max_cents]] as const).map(([k, label, f, th]) => (
          <div class="card">
            <div class="label" style="margin-bottom:6px">{label} · seuil {fmt(f, th)}</div>
            <LineChart series={d.series} previous={null} k={k} format={(v) => fmt(f, v)} events={ev} threshold={th} small />
          </div>
        ))}
      </div>
      <EventsEditor clientId={clientId} events={d.events} onChange={onEvents} />
    </div>
  );
}

/** Courbe SVG : période en trait plein, précédente en pointillés, repères de funnel verticaux annotés, seuil en pointillé. */
function LineChart({ series, previous, k, format, events, threshold, small }: {
  series: Point[]; previous: Point[] | null; k: string; format: (v: number) => string;
  events: { date: string; label: string }[]; threshold?: number | null; small?: boolean;
}) {
  const W = 640, H = small ? 120 : 220, PT = 18, PB = 20, PL = 4, PR = 4;
  const vals = [...series, ...(previous ?? [])].map((p) => p[k]).filter((v): v is number => v != null);
  if (!vals.length) return <p class="muted small" style="margin:12px 0">Pas de donnée mesurée sur la période.</p>;
  // Ratios (CPM, CTR, CPC) : échelle resserrée autour des valeurs et du seuil, pour voir les variations.
  const lo = small ? Math.min(...vals, threshold ?? Infinity) * 0.8 : 0;
  const max = Math.max(...vals, threshold ?? 0) * 1.1 || 1;
  const n = Math.max(series.length, 2);
  const x = (i: number) => PL + (i / (n - 1)) * (W - PL - PR);
  const y = (v: number) => H - PB - ((v - lo) / (max - lo || 1)) * (H - PB - PT);
  const path = (pts: Point[]) => {
    let dstr = '', open = false;
    pts.forEach((p, i) => {
      const v = p[k];
      if (v == null) { open = false; return; }
      dstr += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `; open = true;
    });
    return dstr;
  };
  const idxOf = (date: string) => { let j = 0; series.forEach((p, i) => { if (p.date <= date) j = i; }); return j; };
  const tickEvery = Math.ceil(series.length / 6);
  const total = series.reduce((s, p) => s + ((p[k] as number | null) ?? 0), 0);
  return (
    <div class="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Évolution sur la période">
        <line x1="0" x2={W} y1={H - PB} y2={H - PB} stroke="var(--border)" />
        {threshold != null && <line x1="0" x2={W} y1={y(threshold)} y2={y(threshold)} stroke="var(--warn)" stroke-dasharray="4 4" />}
        {events.map((e) => {
          const ex = x(idxOf(e.date));
          return (
            <g>
              <line x1={ex} x2={ex} y1={PT - 6} y2={H - PB} stroke="var(--agency)" stroke-dasharray="2 3" />
              {!small && <text x={ex + 3} y={PT - 6} font-size="10" fill="var(--agency)" font-family="var(--font-mono)">{e.label}</text>}
              <title>{`${formatDate(e.date)} — ${e.label}`}</title>
            </g>
          );
        })}
        {previous && <path d={path(previous)} fill="none" stroke="var(--text-2)" stroke-width="1.5" stroke-dasharray="4 4" />}
        <path d={path(series)} fill="none" stroke="var(--accent)" stroke-width="2" />
        {series.map((p, i) => p[k] != null && (
          <circle cx={x(i)} cy={y(p[k] as number)} r={small ? 1.5 : 2.5} fill="var(--accent)"><title>{`${formatDate(p.date)} : ${format(p[k] as number)}`}</title></circle>
        ))}
        {!small && series.map((p, i) => i % tickEvery === 0 && (
          <text x={x(i)} y={H - 5} text-anchor="middle" font-size="10" font-family="var(--font-mono)" fill="var(--text-2)">{formatDate(p.date, { year: false })}</text>
        ))}
      </svg>
      {!small && (
        <div class="legend">
          <span><i style="background:var(--accent)" />Période{['spend_cents', 'appointments_booked', 'leads', 'link_clicks', 'landing_page_views', 'appointments_held'].includes(k) ? ` · ${format(total)}` : ''}</span>
          {previous && <span><i style="background:var(--text-2)" />Période précédente (pointillés)</span>}
          {events.length > 0 && <span><i style="background:var(--agency)" />Repères de funnel</span>}
        </div>
      )}
    </div>
  );
}

function EventsEditor({ clientId, events, onChange }: { clientId: string; events: Pilotage['events']; onChange: () => void }) {
  const { me, view } = useSession();
  const [date, setDate] = useState(addDaysYmd(todayParis(), -1));
  const [label, setLabel] = useState('');
  const [err, setErr] = useState<string | null>(null);
  if (me.user.role !== 'agence' || view !== 'agence') {
    return events.length ? <p class="small muted" style="margin-top:8px">Repères : {events.map((e) => `${formatDate(e.date)} · ${e.label}`).join(' — ')}</p> : null;
  }
  async function add(e: Event) {
    e.preventDefault(); setErr(null);
    try { await api(`/clients/${clientId}/funnel-events`, { method: 'POST', body: JSON.stringify({ date, label }) }); setLabel(''); onChange(); }
    catch (x) { setErr((x as ApiError).message); }
  }
  async function remove(id: string) {
    if (!confirm('Supprimer ce repère ?')) return;
    await api(`/clients/${clientId}/funnel-events/${id}`, { method: 'DELETE' }).catch(() => {});
    onChange();
  }
  return (
    <div class="card" style="margin-top:10px;border-color:var(--agency);display:flex;flex-direction:column;gap:8px">
      <span class="label" style="color:var(--agency)">Vue agence · repères de funnel (visibles par le client)</span>
      {events.map((e) => (
        <div class="small" style="display:flex;gap:8px;align-items:center">
          <span class="mono">{formatDate(e.date, { year: true })}</span><strong>{e.label}</strong>
          <button class="ghost-btn" onClick={() => remove(e.id)}>Supprimer</button>
        </div>
      ))}
      <form class="date-range" onSubmit={add}>
        <input type="date" value={date} max={todayParis()} onInput={(e) => setDate((e.target as HTMLInputElement).value)} aria-label="Date du repère" />
        <input type="text" value={label} maxLength={60} placeholder="Ex. : VSL directe, calendrier simplifié" onInput={(e) => setLabel((e.target as HTMLInputElement).value)} aria-label="Libellé du repère" />
        <button class="btn" type="submit" disabled={!label.trim()}>Ajouter le repère</button>
      </form>
      {err && <span class="small" style="color:var(--alert)">{err}</span>}
    </div>
  );
}

function Ads({ d }: { d: Pilotage }) {
  const [spentOnly, setSpentOnly] = useState(true);
  const [activeOnly, setActiveOnly] = useState(false);
  const crm = !d.unmeasured.includes('appointments_booked');
  const rows = d.ads.filter((a) => (!spentOnly || a.spend_cents > 0) && (!activeOnly || a.status === 'ACTIVE'));
  const wasted = d.ads.filter((a) => crm && !a.aggregate && a.spend_cents > 0 && a.appointments_booked === 0);
  const wastedTotal = wasted.reduce((s, a) => s + a.spend_cents, 0);
  return (
    <div class="section">
      <SectionTitle num="06" a="Publicités" b="à garder ou couper" />
      {wasted.length > 0 && (
        <div class="banner alert" role="status"><span><strong>{formatEuros(wastedTotal)}</strong> dépensés sur {wasted.length} publicité{wasted.length > 1 ? 's' : ''} sans aucun rendez-vous sur la période.</span></div>
      )}
      <div style="display:flex;gap:14px;margin-bottom:8px" class="small muted">
        <label><input type="checkbox" checked={spentOnly} onChange={(e) => setSpentOnly((e.target as HTMLInputElement).checked)} /> Seulement celles qui ont dépensé</label>
        <label><input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly((e.target as HTMLInputElement).checked)} /> Actives seulement</label>
      </div>
      <DataTable caption="Publicités" rows={rows} initialSort={{ key: 'spend', dir: 'desc' }}
        rowClass={(r) => (crm && !r.aggregate && r.spend_cents > 0 && r.appointments_booked === 0 ? 'row-alert' : '')}
        columns={[
          { key: 'name', label: 'Publicité', value: (r) => r.name, render: (r) => <span title={r.campaign ?? ''}>{r.name}{r.adset && <div class="small muted">{r.adset}</div>}</span> },
          { key: 'status', label: 'Statut', value: (r) => r.status, render: (r) => r.status ? <span class="mono small">{STATUS[r.status] ?? r.status}</span> : DASH },
          { key: 'spend', label: 'Dépense', value: (r) => r.spend_cents, render: (r) => formatEuros(r.spend_cents) },
          { key: 'imp', label: 'Impressions', value: (r) => r.impressions, render: (r) => formatInt(r.impressions) },
          { key: 'cpm', label: 'CPM', value: (r) => r.cpm_cents, render: (r) => fmt('euros', r.cpm_cents) },
          { key: 'ctr', label: 'CTR', value: (r) => r.ctr, render: (r) => fmt('percent', r.ctr) },
          { key: 'cpc', label: 'CPC', value: (r) => r.cpc_cents, render: (r) => fmt('euros', r.cpc_cents) },
          { key: 'vis', label: 'Visiteurs', value: (r) => r.visitors, render: (r) => formatInt(r.visitors) },
          { key: 'cpv', label: 'Coût / visiteur', value: (r) => r.cost_per_visitor_cents, render: (r) => fmt('euros', r.cost_per_visitor_cents) },
          { key: 'vsl', label: 'Vues VSL', value: (r) => r.vsl_views, render: (r) => fmt('int', r.vsl_views) },
          { key: 'rdv', label: 'Rendez-vous', value: (r) => r.appointments_booked, render: (r) => fmt('int', r.appointments_booked) },
          { key: 'cprdv', label: 'Coût / RDV', value: (r) => r.cost_per_booked_cents ?? (crm && r.spend_cents > 0 && r.appointments_booked === 0 ? Number.MAX_SAFE_INTEGER : null),
            render: (r) => crm && r.spend_cents > 0 && r.appointments_booked === 0
              ? <span class="cell-neg">{formatEuros(r.spend_cents)} sans RDV</span>
              : fmt('euros', r.cost_per_booked_cents) },
          { key: 'tp', label: 'ThruPlay', value: (r) => r.thruplay_rate, render: (r) => fmt('percent', r.thruplay_rate) },
        ]} />
      {!crm && <AgencyNote>les rendez-vous ne sont pas encore synchronisés pour ce client (jeton GHL) : la colonne reste « — » au lieu de 0.</AgencyNote>}
    </div>
  );
}

const STATUS: Record<string, string> = { ACTIVE: 'Active', PAUSED: 'En pause', CAMPAIGN_PAUSED: 'Campagne en pause', ADSET_PAUSED: 'Ensemble en pause', ARCHIVED: 'Archivée', DELETED: 'Supprimée', DISAPPROVED: 'Refusée', WITH_ISSUES: 'Problème' };
