import { useState } from 'preact/hooks';
import { formatDate, formatEuros, todayParis } from '@obsidian/domain';
import { api, useApi } from '../api.ts';
import { useSession } from '../session.ts';
import { DataTable, EmptyState, ErrorBox, Loading, PageHead } from '../components/ui.tsx';

interface CashEntry { id: string; date: string; amountCents: number; label: string | null; createdBy: string; createdAt: string }

/** Encaissements saisis à la main (décision 0014) : seule source du chiffre d'affaires encaissé et du ROAS. */
export function CashScreen({ clientId }: { clientId: string }) {
  const { data, error, loading, reload } = useApi<{ entries: CashEntry[] }>(`/clients/${clientId}/cash`);
  const { me, view } = useSession();
  const canWrite = me.user.role === 'client' || (me.user.role === 'agence' && view === 'agence');
  const [date, setDate] = useState(todayParis());
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add(e: Event) {
    e.preventDefault();
    setErr(null);
    const euros = Number(amount.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(euros) || euros <= 0) { setErr('Indiquez un montant positif, en euros.'); return; }
    setBusy(true);
    try {
      await api(`/clients/${clientId}/cash`, { method: 'POST', body: JSON.stringify({ date, amountCents: Math.round(euros * 100), label: label || null }) });
      setAmount(''); setLabel('');
      reload();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  async function remove(entry: CashEntry) {
    if (!confirm(`Supprimer l'encaissement de ${formatEuros(entry.amountCents, { decimals: true })} du ${formatDate(entry.date)} ?`)) return;
    setErr(null);
    try { await api(`/clients/${clientId}/cash/${entry.id}`, { method: 'DELETE' }); reload(); } catch (x) { setErr((x as Error).message); }
  }

  const total = (data?.entries ?? []).reduce((s, e) => s + e.amountCents, 0);
  return (
    <>
      <PageHead a="Encaissements" b="saisis" sub="Ce que vous avez réellement encaissé grâce aux campagnes. Ces montants alimentent le chiffre d'affaires encaissé et le ROAS du tableau de bord : sans saisie, ils restent « — »." />
      {error && <ErrorBox error={error} />}
      {err && <div class="banner alert" role="alert">{err}</div>}
      {!canWrite && me.user.role === 'agence' && <div class="small" style="color:var(--agency);margin-bottom:8px">Aperçu : le client saisit ici ses encaissements. En vue client (lecture seule), l'agence ne peut pas en ajouter ; elle le peut depuis la vue agence.</div>}
      {(canWrite || me.user.role === 'agence') && (
        <form class="card section" onSubmit={(e) => { if (!canWrite) { e.preventDefault(); return; } add(e); }} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end', opacity: canWrite ? 1 : 0.6, pointerEvents: canWrite ? 'auto' : 'none' }}>
          <label class="field">Date d'encaissement
            <input type="date" required value={date} max={todayParis()} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
          </label>
          <label class="field">Montant encaissé (€ HT)
            <input inputMode="decimal" required placeholder="1 500" value={amount} onInput={(e) => setAmount((e.target as HTMLInputElement).value)} />
          </label>
          <label class="field" style="flex:1;min-width:200px">Libellé (facultatif)
            <input maxLength={160} placeholder="Ex. nouveau client, acompte, facture n°…" value={label} onInput={(e) => setLabel((e.target as HTMLInputElement).value)} />
          </label>
          <button class="btn" type="submit" disabled={busy}>{busy ? 'Ajout…' : 'Ajouter'}</button>
        </form>
      )}
      {loading && !data && <Loading />}
      {data && (data.entries.length === 0
        ? <EmptyState title="Aucun encaissement saisi">{canWrite ? 'Ajoutez chaque encaissement lié aux campagnes : le ROAS se calcule à partir de ces montants.' : 'Le client n\'a encore saisi aucun encaissement.'}</EmptyState>
        : (
          <div class="section">
            <div class="small muted" style="margin-bottom:8px">{data.entries.length} encaissement{data.entries.length > 1 ? 's' : ''} · total {formatEuros(total, { decimals: true })}</div>
            <DataTable
              caption="Encaissements"
              rows={data.entries}
              initialSort={{ key: 'date', dir: 'desc' }}
              columns={[
                { key: 'date', label: 'Date', value: (r) => r.date, render: (r) => formatDate(r.date) },
                { key: 'amount', label: 'Montant', value: (r) => r.amountCents, render: (r) => formatEuros(r.amountCents, { decimals: true }) },
                { key: 'label', label: 'Libellé', value: (r) => r.label ?? '', render: (r) => r.label ?? '—' },
                { key: 'by', label: 'Saisi par', value: (r) => r.createdBy, render: (r) => <span class="mono small muted">{r.createdBy === 'agence' ? 'Agence' : 'Client'}</span> },
                ...(canWrite ? [{ key: 'del', label: '', value: () => 0, render: (r: CashEntry) => <button class="ghost-btn small" onClick={() => remove(r)}>Supprimer</button> }] : []),
              ]}
            />
          </div>
        ))}
    </>
  );
}
