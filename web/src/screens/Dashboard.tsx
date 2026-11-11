import { useState } from 'preact/hooks';
import {
  DASH, addDaysYmd, delta, todayParis, formatDate, formatEuros, formatInt, formatPercent, verdict, type AppointmentCounter, type Thresholds, type Totals,
} from '@obsidian/domain';
import { useApi } from '../api.ts';
import { Counter } from '../components/Counter.tsx';
import { ClientAlerts, type ClientOverview } from '../components/ClientAlerts.tsx';
import {
  DataTable, DualBarChart, EmptyState, ErrorBox, HBars, KpiCard, Loading, PageHead, SectionTitle, Segmented,
} from '../components/ui.tsx';

type Derived = Record<string, number | null>;
interface Dashboard {
  period: { days: number; from: string; to: string };
  lastSync: string | null;
  current: { totals: Totals; derived: Derived } | null;
  previous: { totals: Totals; derived: Derived } | null;
  attendance: { held: number; noShow: number; missingStatus: number; upcoming: number; rate: number | null; reason: string | null };
  series: { date: string; spend_cents: number | null; leads: number | null; crm_contacts: number | null; appointments_booked: number | null }[];
  campaigns: { id: string; name: string | null; spend_cents: number; link_clicks: number; leads: number; cost_per_lead_cents: number | null }[];
  pipeline: { stage_name: string; open_opportunities: number }[];
  sources: { source: string; contacts: number }[];
  counter: AppointmentCounter;
  thresholds: Thresholds;
  /** Indicateurs qu'aucune source ne fournit pour ce client : affichés « — », jamais 0. */
  unmeasured: string[];
}

export function DashboardScreen({ clientId, search }: { clientId: string; search: string }) {
  const initial = Number(new URLSearchParams(search).get('jours')) || 30;
  // Période : 7 / 30 / 90 jours, depuis le 1er janvier, ou dates libres (toujours closes à hier au plus tard).
  const yesterday = addDaysYmd(todayParis(), -1);
  const [mode, setMode] = useState<string>([7, 30, 90].includes(initial) ? String(initial) : '30');
  const [custom, setCustom] = useState({ from: `${yesterday.slice(0, 4)}-01-01`, to: yesterday });
  const [applied, setApplied] = useState(custom);
  const days = Number(mode) || 30;
  const query = mode === 'annee' ? `from=${yesterday.slice(0, 4)}-01-01&to=${yesterday}`
    : mode === 'perso' ? `from=${applied.from}&to=${applied.to}` : `days=${days}`;
  const overview = useApi<ClientOverview>(`/clients/${clientId}`);
  const { data, error, loading } = useApi<Dashboard>(`/clients/${clientId}/dashboard?${query}`);

  const NO_DATA = 'Aucune donnée synchronisée sur la période';
  const cur = data?.current?.totals;
  const prev = data?.previous?.totals;
  const dv = data?.current?.derived;
  const pdv = data?.previous?.derived;
  const um = new Set(data?.unmeasured ?? []);
  const val = (k: keyof Totals) => (cur && !um.has(k) ? cur[k] : null);
  const d = (k: keyof Totals) => (um.has(k) ? null : delta(cur ? cur[k] : null, prev ? prev[k] : null));
  const reason = (k: keyof Totals) => (um.has(k) ? 'Non synchronisé pour ce client' : NO_DATA);
  const ceiling = data?.thresholds.cost_per_booked_max_cents ?? null;

  return (
    <>
      <PageHead
        a="Tableau" b="de bord"
        sub="Vos publicités Meta et votre CRM réunis : où vous en êtes en ce moment."
        lastSync={data ? data.lastSync : overview.data ? overview.data.lastSync : undefined}
        right={
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <Segmented label="Période" value={mode} onChange={setMode}
              options={[...['7', '30', '90'].map((v) => ({ value: v, label: `${v} j` })), { value: 'annee', label: 'Depuis janv.' }, { value: 'perso', label: 'Dates…' }]} />
            {mode === 'perso' && (
              <form class="date-range" onSubmit={(e) => { e.preventDefault(); if (custom.from <= custom.to) setApplied(custom); }}>
                <input type="date" aria-label="Du" value={custom.from} max={custom.to} onInput={(e) => setCustom({ ...custom, from: (e.target as HTMLInputElement).value })} />
                <input type="date" aria-label="Au" value={custom.to} min={custom.from} max={yesterday} onInput={(e) => setCustom({ ...custom, to: (e.target as HTMLInputElement).value })} />
                <button class="ghost-btn" type="submit">Appliquer</button>
              </form>
            )}
            <a class="btn" href={`/c/${clientId}/pilotage?jours=${days}`}>Pilotage détaillé →</a>
          </div>
        }
      />

      {overview.data && <ClientAlerts clientId={clientId} overview={overview.data} />}
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading />}

      {data && (
        <>
          {data.counter.windowStart && <Counter clientId={clientId} counter={data.counter} />}

          <div class="section">
            <div class="label" style="margin-bottom:8px">
              Du {formatDate(data.period.from)} au {formatDate(data.period.to)} · {data.period.days} jours, comparés aux {data.period.days} jours précédents
            </div>
            <div class="grid grid-5">
              <KpiCard label="Dépense publicitaire" value={formatEuros(val('spend_cents'))} missingReason={NO_DATA} delta={d('spend_cents')} sub={dv && `CPM ${formatEuros(dv.cpm_cents, { decimals: true })}`} edge="var(--accent)" />
              <KpiCard label="Leads Meta" value={formatInt(val('leads'))} missingReason={NO_DATA} delta={d('leads')} sub={dv && `Coût par lead ${formatEuros(dv.cost_per_lead_cents, { decimals: true })}`} />
              <KpiCard label="Clics sur le lien" value={formatInt(val('link_clicks'))} missingReason={NO_DATA} delta={d('link_clicks')} sub={dv && `CTR ${formatPercent(dv.ctr, 2)}`} />
              <KpiCard label="Nouveaux contacts CRM" value={formatInt(val('crm_contacts'))} missingReason={NO_DATA} delta={d('crm_contacts')} />
              <KpiCard
                label="Rendez-vous pris" value={formatInt(val('appointments_booked'))} missingReason={NO_DATA} delta={d('appointments_booked')}
                verdict={dv ? verdict(dv.cost_per_booked_cents, ceiling, 'max') : undefined}
                sub={dv && <>Coût par RDV {formatEuros(dv.cost_per_booked_cents, { decimals: true })}{ceiling ? <> · plafond {formatEuros(ceiling, { decimals: true })}</> : null}</>}
              />
            </div>
            <div class="grid grid-3" style="margin-top:12px">
              <KpiCard
                label="Présence aux rendez-vous"
                value={data.attendance.rate === null ? DASH : formatPercent(data.attendance.rate)}
                missingReason={data.attendance.reason}
                sub={<>{data.attendance.upcoming} à venir{data.attendance.missingStatus ? <> · <span style="color:var(--warn)">{data.attendance.missingStatus} sans statut</span></> : null}</>}
              />
              <KpiCard label="Ventes gagnées" value={formatInt(val('sales'))} missingReason={reason('sales')} delta={d('sales')} sub={dv && `Coût d'acquisition ${formatEuros(dv.cac_cents)}`} />
              <KpiCard
                label="Encaissé" value={formatEuros(val('cash_collected_cents'))} missingReason={reason('cash_collected_cents')} delta={d('cash_collected_cents')}
                sub={dv && <>ROAS encaissé {dv.roas_cash == null ? DASH : dv.roas_cash.toFixed(1).replace('.', ',')}{pdv?.roas_cash != null ? ` (préc. ${pdv.roas_cash.toFixed(1).replace('.', ',')})` : ''}</>}
              />
            </div>
          </div>

          {data.current ? (
            <>
              <div class="section grid grid-2 stack">
                <div class="card">
                  <div class="label" style="margin-bottom:10px">Dépense et leads, par jour</div>
                  <DualBarChart
                    data={data.series.map((s) => ({ date: s.date, a: s.spend_cents, b: s.leads }))}
                    a={{ label: 'Dépense', format: (v) => formatEuros(v) }}
                    b={{ label: 'Leads', format: formatInt }}
                  />
                </div>
                <div class="card">
                  <div class="label" style="margin-bottom:10px">Nouveaux contacts et rendez-vous pris, par jour</div>
                  <DualBarChart
                    data={data.series.map((s) => ({ date: s.date, a: s.crm_contacts, b: s.appointments_booked }))}
                    a={{ label: 'Contacts', format: formatInt }}
                    b={{ label: 'Rendez-vous', format: formatInt }}
                  />
                </div>
              </div>

              <div class="section">
                <SectionTitle a="Campagnes" b="sur la période" />
                <DataTable
                  caption="Campagnes"
                  rows={data.campaigns}
                  initialSort={{ key: 'spend', dir: 'desc' }}
                  columns={[
                    { key: 'name', label: 'Campagne', value: (r) => r.name ?? r.id },
                    { key: 'spend', label: 'Dépense', value: (r) => r.spend_cents, render: (r) => formatEuros(r.spend_cents) },
                    { key: 'clicks', label: 'Clics', value: (r) => r.link_clicks, render: (r) => formatInt(r.link_clicks) },
                    { key: 'leads', label: 'Leads', value: (r) => r.leads, render: (r) => formatInt(r.leads) },
                    { key: 'cpl', label: 'Coût par lead', value: (r) => r.cost_per_lead_cents, render: (r) => r.leads === 0 && r.spend_cents > 0 ? <span class="cell-neg">{formatEuros(r.spend_cents)} sans lead</span> : formatEuros(r.cost_per_lead_cents, { decimals: true }) },
                  ]}
                />
              </div>
            </>
          ) : (
            <div class="section">
              <EmptyState title="Pas encore de résultats à afficher">
                Les chiffres apparaissent ici dès que les campagnes tournent et que la première synchronisation quotidienne (6 h 00) a eu lieu.
                En attendant, l'avancement de votre infrastructure est sur l'écran Infrastructure.
              </EmptyState>
            </div>
          )}

          <div class="section grid grid-2 stack">
            <div class="card">
              <div class="label" style="margin-bottom:12px">Pipeline CRM · opportunités ouvertes</div>
              {data.pipeline.length
                ? <HBars rows={data.pipeline.map((p) => ({ label: p.stage_name, value: p.open_opportunities }))} format={formatInt} />
                : <p class="muted small">Le pipeline apparaît après la première synchronisation GoHighLevel.</p>}
            </div>
            <div class="card">
              <div class="label" style="margin-bottom:12px">Sources des contacts · 90 jours</div>
              {data.sources.length
                ? <HBars rows={data.sources.map((s) => ({ label: s.source, value: s.contacts }))} format={formatInt} />
                : <p class="muted small">Aucun contact synchronisé sur 90 jours.</p>}
            </div>
          </div>
        </>
      )}
    </>
  );
}
