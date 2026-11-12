import { useState } from 'preact/hooks';
import {
  DASH, DEAL_KIND_LABEL, DEAL_SOURCE_LABEL, addDaysYmd, formatDate, formatEuros, formatInt, formatPercent, formatRatio, safeDiv, todayParis,
  type Deal, type DealKind, type DealSource, type FinanceSummary, type LifetimeValue,
} from '@obsidian/domain';
import { api, useApi } from '../api.ts';
import { DataTable, EmptyState, ErrorBox, KpiCard, Loading, PageHead, SectionTitle, Segmented } from '../components/ui.tsx';

type MonthRow = FinanceSummary & { month: string };
interface FinanceData {
  period: { from: string; to: string };
  today: string;
  acquisition: { clientId: string | null; clientName: string | null; syncedFrom: string | null; syncedTo: string | null; candidates: { id: string; name: string }[] };
  summary: FinanceSummary;
  /** Mêmes calculs, limités aux jours où la dépense est synchronisée : source des ratios d'acquisition. */
  measured: { from: string; to: string; summary: FinanceSummary } | null;
  lifetime: LifetimeValue;
  months: MonthRow[];
  deals: Deal[];
}

type Preset = 'tout' | '30' | '90' | 'annee' | 'libre';
const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const monthLabel = (m: string) => `${MONTHS_FR[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const eur = (v: number | null | undefined) => formatEuros(v ?? null);
const eurD = (v: number | null | undefined) => formatEuros(v ?? null, { decimals: true });

/** Suivi financier de l'agence (décision 0019) : vue agence uniquement. */
export function FinanceScreen() {
  const today = todayParis();
  const [preset, setPreset] = useState<Preset>('tout');
  const [custom, setCustom] = useState({ from: addDaysYmd(today, -89), to: today });
  const range = preset === 'tout' ? null
    : preset === '30' ? { from: addDaysYmd(today, -29), to: today }
    : preset === '90' ? { from: addDaysYmd(today, -89), to: today }
    : preset === 'annee' ? { from: `${today.slice(0, 4)}-01-01`, to: today }
    : custom;
  const q = range ? `?from=${range.from}&to=${range.to}` : '';
  const { data, error, loading, reload } = useApi<FinanceData>(`/agence/finance${q}`);
  const [err, setErr] = useState<string | null>(null);

  async function setAcquisition(id: string) {
    setErr(null);
    try { await api('/agence/finance/settings', { method: 'PUT', body: JSON.stringify({ acquisitionClientId: id || null }) }); reload(); }
    catch (x) { setErr((x as Error).message); }
  }

  return (
    <>
      <PageHead a="Suivi" b="financier"
        sub="Réservé à l'agence. Les deals sont saisis ici ; la dépense, les leads et les rendez-vous viennent du compte d'acquisition de l'agence synchronisé dans l'espace." />
      {error && <ErrorBox error={error} />}
      {err && <div class="banner alert" role="alert">{err}</div>}
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:6px">
        <Segmented label="Période" value={preset} onChange={setPreset}
          options={[{ value: 'tout', label: 'Depuis le début' }, { value: 'annee', label: 'Cette année' }, { value: '90', label: '90 j' }, { value: '30', label: '30 j' }, { value: 'libre', label: 'Libre' }]} />
        {preset === 'libre' && (
          <>
            <label class="field">Du<input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: (e.target as HTMLInputElement).value })} /></label>
            <label class="field">Au<input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: (e.target as HTMLInputElement).value })} /></label>
          </>
        )}
      </div>
      {loading && !data && <Loading />}
      {data && <FinanceBody data={data} onAcquisition={setAcquisition} reload={reload} />}
    </>
  );
}

function FinanceBody({ data, onAcquisition, reload }: { data: FinanceData; onAcquisition: (id: string) => void; reload: () => void }) {
  const s = data.summary;
  // Ratios d'acquisition : uniquement sur la fenêtre où la dépense est mesurée.
  const m = data.measured?.summary ?? { ...s, spendCents: null, leads: null, booked: null, held: null, cplCents: null, costPerBookedCents: null, costPerHeldCents: null, showRate: null, closeRate: null, cacCents: null, cacAdsCents: null, roas: null, marginAfterAdsCents: null };
  const lt = data.lifetime;
  const acq = data.acquisition;
  const noSpend = !acq.clientId ? "Aucun compte d'acquisition choisi (réglage en bas de page)"
    : `Aucune donnée synchronisée sur la période${acq.syncedFrom ? ` (données du ${formatDate(acq.syncedFrom)} au ${formatDate(acq.syncedTo)})` : ''}`;
  const ltvCac = lt.ltvCents !== null && m.cacCents !== null ? safeDiv(lt.ltvCents, m.cacCents) : null;
  const partialSpend = data.measured && (data.measured.from > data.period.from || data.measured.to < data.period.to);

  return (
    <>
      <div class="small muted" style="margin-bottom:14px">
        Période du {formatDate(data.period.from, { year: true })} au {formatDate(data.period.to, { year: true })}
        {partialSpend && <> · <span style="color:var(--warn)">dépense synchronisée du {formatDate(data.measured!.from, { year: true })} au {formatDate(data.measured!.to, { year: true })} seulement : dépense, CPL, coûts par RDV, CAC, ROAS, closing et marge sont calculés sur ces jours-là, avec les deals signés ces jours-là</span></>}
      </div>

      <SectionTitle num="01" a="L'argent" b="qui rentre" />
      <div class="grid grid-4">
        <KpiCard label="CA signé" value={eur(s.signedCents)} edge="var(--accent)" sub={`${formatInt(s.deals)} deal${s.deals > 1 ? 's' : ''} · panier moyen ${eur(s.avgDealCents)}`} />
        <KpiCard label="Encaissé" value={eur(s.collectedCents)} sub={s.upcomingCents ? `${eur(s.upcomingCents)} encore à échoir` : 'mensualités comprises, à date'} />
        <KpiCard label="Dépense publicitaire" value={eur(m.spendCents)} missingReason={noSpend} />
        <KpiCard label="Marge après pub" value={eur(m.marginAfterAdsCents)} missingReason={noSpend} sub="encaissé − dépense publicitaire" />
      </div>

      <SectionTitle num="02" a="Le coût" b="de l'acquisition" />
      <div class="grid grid-4">
        <KpiCard label="Leads" value={formatInt(m.leads)} missingReason={noSpend} sub={`CPL ${eurD(m.cplCents)}`} />
        <KpiCard label="Coût par RDV pris" value={eurD(m.costPerBookedCents)} missingReason={noSpend} sub={`${formatInt(m.booked)} rendez-vous pris`} />
        <KpiCard label="Coût par RDV tenu" value={eurD(m.costPerHeldCents)} missingReason={noSpend} sub={`${formatInt(m.held)} tenus · présence ${formatPercent(m.showRate)}`} />
        <KpiCard label="CAC" value={eur(m.cacCents)} missingReason={m.spendCents === null ? noSpend : 'Aucun nouveau client sur la période'}
          sub={<>{formatInt(m.newClients)} nouveau{m.newClients > 1 ? 'x' : ''} client{m.newClients > 1 ? 's' : ''}, tous canaux{m.cacAdsCents !== null ? <> · CAC publicité {eur(m.cacAdsCents)}</> : null}</>} />
      </div>

      <SectionTitle num="03" a="Ce que vaut" b="un client" />
      <div class="grid grid-4">
        <KpiCard label="LTV" value={eur(lt.ltvCents)} sub={`CA signé moyen par client depuis le début · ${formatInt(lt.clients)} clients`} edge="var(--accent)" />
        <KpiCard label="LTV : CAC" value={ltvCac === null ? DASH : `${formatRatio(ltvCac)} ×`} missingReason="CAC non mesurable sur la période" />
        <KpiCard label="ROAS" value={m.roas === null ? DASH : `${formatRatio(m.roas)} ×`} missingReason={noSpend} sub="CA signé ÷ dépense" />
        <KpiCard label="Taux de closing" value={formatPercent(m.closeRate)} missingReason={m.held === null ? noSpend : 'Aucun rendez-vous tenu'} sub="nouveaux clients ÷ RDV tenus" />
      </div>
      <div class="small muted" style="margin-top:8px">
        Réachat : {formatPercent(lt.repeatRate)} des clients ont signé plus d'un deal · {lt.avgDealsPerClient === null ? DASH : formatRatio(lt.avgDealsPerClient)} deal par client en moyenne.
        Le CAC « tous canaux » divise la dépense publicitaire par tous les nouveaux clients ; marquez la source des deals pour obtenir le CAC publicité.
      </div>

      <SectionTitle num="04" a="Mois" b="par mois" />
      <MonthBars months={data.months} />
      <div class="section" style="margin-top:12px">
        <DataTable
          caption="Mois par mois"
          rows={data.months}
          initialSort={{ key: 'month', dir: 'desc' }}
          columns={[
            { key: 'month', label: 'Mois', value: (r) => r.month, render: (r) => monthLabel(r.month) },
            { key: 'signed', label: 'CA signé', value: (r) => r.signedCents, render: (r) => eur(r.signedCents) },
            { key: 'collected', label: 'Encaissé', value: (r) => r.collectedCents, render: (r) => eur(r.collectedCents) },
            { key: 'new', label: 'Nouveaux clients', value: (r) => r.newClients, render: (r) => formatInt(r.newClients) },
            { key: 'spend', label: 'Dépense', value: (r) => r.spendCents, render: (r) => eur(r.spendCents) },
            { key: 'leads', label: 'Leads', value: (r) => r.leads, render: (r) => formatInt(r.leads) },
            { key: 'cpl', label: 'CPL', value: (r) => r.cplCents, render: (r) => eurD(r.cplCents) },
            { key: 'booked', label: 'RDV pris', value: (r) => r.booked, render: (r) => formatInt(r.booked) },
            { key: 'cprdv', label: 'Coût / RDV', value: (r) => r.costPerBookedCents, render: (r) => eurD(r.costPerBookedCents) },
            { key: 'cac', label: 'CAC', value: (r) => r.cacCents, render: (r) => eur(r.cacCents) },
            { key: 'roas', label: 'ROAS', value: (r) => r.roas, render: (r) => (r.roas === null ? DASH : `${formatRatio(r.roas)} ×`) },
            { key: 'margin', label: 'Marge après pub', value: (r) => r.marginAfterAdsCents, render: (r) => eur(r.marginAfterAdsCents) },
          ]}
        />
      </div>

      <SectionTitle num="05" a="Les" b="deals" />
      <Deals deals={data.deals} reload={reload} />

      {lt.topClients.length > 0 && (
        <>
          <SectionTitle num="06" a="Les meilleurs" b="clients" />
          <DataTable
            caption="Meilleurs clients"
            rows={lt.topClients}
            initialSort={{ key: 'total', dir: 'desc' }}
            columns={[
              { key: 'name', label: 'Client', value: (r) => r.name },
              { key: 'total', label: 'CA signé cumulé', value: (r) => r.totalCents, render: (r) => eur(r.totalCents) },
              { key: 'deals', label: 'Deals', value: (r) => r.deals, render: (r) => formatInt(r.deals) },
            ]}
          />
        </>
      )}

      <div class="card section">
        <label class="field" style="max-width:420px">Compte d'acquisition de l'agence (dépense, leads, rendez-vous)
          <select value={acq.clientId ?? ''} onChange={(e) => onAcquisition((e.target as HTMLSelectElement).value)}>
            <option value="">Aucun</option>
            {acq.candidates.map((c) => <option value={c.id}>{c.name}</option>)}
          </select>
          <span class="hint">{acq.syncedFrom ? `Données synchronisées du ${formatDate(acq.syncedFrom, { year: true })} au ${formatDate(acq.syncedTo, { year: true })}.` : 'Aucune donnée synchronisée pour ce compte.'}</span>
        </label>
      </div>
    </>
  );
}

/** CA signé et dépense par mois, même échelle (deux montants en euros comparables). */
function MonthBars({ months }: { months: MonthRow[] }) {
  const W = 640, H = 200, PAD_B = 22, PAD_T = 8;
  const n = months.length || 1;
  const max = Math.max(1, ...months.map((m) => Math.max(m.signedCents, m.spendCents ?? 0)));
  const slot = W / n, bw = Math.max(2, slot * 0.34), h = H - PAD_B - PAD_T;
  return (
    <div class="chart card">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="CA signé et dépense publicitaire par mois">
        <line x1="0" x2={W} y1={H - PAD_B} y2={H - PAD_B} stroke="var(--border)" />
        {months.map((m, i) => {
          const x = i * slot + slot / 2;
          const ha = (m.signedCents / max) * h;
          const hb = ((m.spendCents ?? 0) / max) * h;
          return (
            <g>
              <title>{`${monthLabel(m.month)} — CA signé : ${eur(m.signedCents)} · dépense : ${eur(m.spendCents)}`}</title>
              <rect x={x - bw - 0.5} y={H - PAD_B - ha} width={bw} height={ha} rx="2" fill="var(--accent)" />
              <rect x={x + 0.5} y={H - PAD_B - hb} width={bw} height={hb} rx="2" fill="var(--series-2)" />
              {m.spendCents === null && <line x1={x + 1} x2={x + bw} y1={H - PAD_B - 3} y2={H - PAD_B - 3} stroke="var(--text-2)" />}
              <text x={x} y={H - 6} text-anchor="middle" font-size="10" font-family="var(--font-mono)" fill="var(--text-2)">{monthLabel(m.month)}</text>
            </g>
          );
        })}
      </svg>
      <div class="legend">
        <span><i style="background:var(--accent)" />CA signé</span>
        <span><i style="background:var(--series-2)" />Dépense publicitaire</span>
        <span class="mono small">même échelle · trait gris = dépense non synchronisée</span>
      </div>
    </div>
  );
}

const EMPTY = { clientName: '', date: todayParis(), amount: '', kind: 'nouveau' as DealKind, installments: '1', source: 'inconnue' as DealSource, note: '' };

function Deals({ deals, reload }: { deals: Deal[]; reload: () => void }) {
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof EMPTY) => (e: Event) => setForm({ ...form, [k]: (e.target as HTMLInputElement).value });

  async function save(e: Event) {
    e.preventDefault();
    setErr(null);
    const euros = Number(form.amount.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(euros) || euros <= 0) { setErr('Indiquez un montant positif, en euros.'); return; }
    const body = JSON.stringify({
      clientName: form.clientName, date: form.date, amountCents: Math.round(euros * 100), kind: form.kind,
      installments: Number(form.installments), source: form.source, note: form.note || null,
    });
    setBusy(true);
    try {
      await api(editing ? `/agence/finance/deals/${editing}` : '/agence/finance/deals', { method: editing ? 'PATCH' : 'POST', body });
      setForm(EMPTY); setEditing(null); reload();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  function edit(d: Deal) {
    setEditing(d.id);
    setForm({ clientName: d.clientName, date: d.date, amount: String(d.amountCents / 100), kind: d.kind, installments: String(d.installments), source: d.source, note: d.note ?? '' });
  }
  async function remove(d: Deal) {
    if (!confirm(`Supprimer le deal ${d.clientName} de ${eur(d.amountCents)} du ${formatDate(d.date)} ?`)) return;
    try { await api(`/agence/finance/deals/${d.id}`, { method: 'DELETE' }); reload(); } catch (x) { setErr((x as Error).message); }
  }

  return (
    <>
      {err && <div class="banner alert" role="alert">{err}</div>}
      <form class="card" onSubmit={save} style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
        <label class="field" style="flex:1;min-width:180px">Client<input required maxLength={120} value={form.clientName} onInput={set('clientName')} placeholder="Ex. Effinity" /></label>
        <label class="field">Date de signature<input type="date" required value={form.date} onInput={set('date')} /></label>
        <label class="field" style="width:120px">Montant (€ HT)<input inputMode="decimal" required value={form.amount} onInput={set('amount')} placeholder="1 500" /></label>
        <label class="field">Type<select value={form.kind} onChange={set('kind')}>{Object.entries(DEAL_KIND_LABEL).map(([k, l]) => <option value={k}>{l}</option>)}</select></label>
        <label class="field" style="width:110px">Mensualités<input type="number" min={1} max={36} value={form.installments} onInput={set('installments')} /></label>
        <label class="field">Source<select value={form.source} onChange={set('source')}>{Object.entries(DEAL_SOURCE_LABEL).map(([k, l]) => <option value={k}>{l}</option>)}</select></label>
        <label class="field" style="flex:1;min-width:180px">Note<input maxLength={300} value={form.note} onInput={set('note')} /></label>
        <button class="btn" type="submit" disabled={busy}>{busy ? 'Enregistrement…' : editing ? 'Enregistrer' : 'Ajouter le deal'}</button>
        {editing && <button class="ghost-btn" type="button" onClick={() => { setEditing(null); setForm(EMPTY); }}>Annuler</button>}
      </form>
      {deals.length === 0
        ? <EmptyState title="Aucun deal saisi">Ajoutez chaque deal signé : le CA, le CAC, la LTV et le ROAS se calculent à partir de ces montants.</EmptyState>
        : (
          <DataTable
            caption="Deals"
            rows={deals}
            initialSort={{ key: 'date', dir: 'desc' }}
            columns={[
              { key: 'date', label: 'Date', value: (r) => r.date, render: (r) => formatDate(r.date, { year: true }) },
              { key: 'client', label: 'Client', value: (r) => r.clientName },
              { key: 'amount', label: 'Montant', value: (r) => r.amountCents, render: (r) => eur(r.amountCents) },
              { key: 'kind', label: 'Type', value: (r) => r.kind, render: (r) => DEAL_KIND_LABEL[r.kind] },
              { key: 'inst', label: 'Paiement', value: (r) => r.installments, render: (r) => (r.installments > 1 ? `${r.installments} × ${eur(Math.round(r.amountCents / r.installments))}` : 'comptant') },
              { key: 'source', label: 'Source', value: (r) => r.source, render: (r) => DEAL_SOURCE_LABEL[r.source] },
              { key: 'note', label: 'Note', value: (r) => r.note ?? '', render: (r) => <span class="small muted">{r.note ?? ''}</span> },
              { key: 'act', label: '', value: () => 0, render: (r) => (
                <span style="display:flex;gap:6px"><button class="ghost-btn small" onClick={() => edit(r)}>Modifier</button><button class="ghost-btn small" onClick={() => remove(r)}>Supprimer</button></span>
              ) },
            ]}
          />
        )}
    </>
  );
}
