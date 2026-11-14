import { useEffect, useState } from 'preact/hooks';
import { api, useApi } from '../api.ts';
import { navigate } from '../router.ts';
import { ErrorBox, Loading, PageHead, SectionTitle } from '../components/ui.tsx';

interface Editable {
  id: string; name: string; slug: string; status: string; offer: string | null; startDate: string | null;
  campaignsLaunchedAt: string | null; driveFolderUrl: string | null; masterTrackerUrl: string | null; facebookPageId: string | null; adAccountCurrency: string; adAccountTimezone: string;
  autoPublishRecos: boolean; isDemo: boolean; verticalsEnabled: boolean;
  thresholds: Record<string, number>; defaultThresholds: Record<string, number | null>;
}

const STATUS_LABEL: Record<string, string> = {
  prospect: 'Prospect', onboarding: 'Onboarding', build: 'Production (build)', actif: 'Actif (campagnes)', pause: 'En pause', termine: 'Terminé',
};

/** Seuils éditables, affichés dans l'unité de lecture (€, %), stockés en centimes ou en ratio. */
const THRESHOLDS: { key: string; label: string; unit: '€' | '%' | 'x'; hint: string }[] = [
  { key: 'cpm_max_cents', label: 'CPM maximum', unit: '€', hint: 'Coût pour 1 000 impressions' },
  { key: 'cpc_max_cents', label: 'CPC maximum', unit: '€', hint: 'Coût par clic sur le lien' },
  { key: 'ctr_min', label: 'CTR minimum', unit: '%', hint: 'Clics sur le lien / impressions' },
  { key: 'thruplay_min', label: 'Taux de ThruPlay minimum', unit: '%', hint: 'Vidéos vues 15 s / lectures' },
  { key: 'cancel_rate_max', label: "Taux d'annulation maximum", unit: '%', hint: 'Rendez-vous annulés / prévus' },
  { key: 'roas_cash_min', label: 'ROAS encaissé minimum', unit: 'x', hint: 'Encaissé / dépense' },
  { key: 'cost_per_booked_max_cents', label: 'Coût par rendez-vous maximum', unit: '€', hint: 'Vide : calculé depuis les chiffres unitaires de l\'onboarding' },
];

const toDisplay = (unit: string, v: number | null | undefined) =>
  v == null ? '' : unit === '€' ? String(v / 100).replace('.', ',') : unit === '%' ? String(Math.round(v * 10000) / 100).replace('.', ',') : String(v).replace('.', ',');
const fromDisplay = (unit: string, s: string): number | null => {
  const t = s.trim().replace(/\s/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return unit === '€' ? Math.round(n * 100) : unit === '%' ? n / 100 : n;
};

/** Fiche client (vue agence, décision 0014) : création et modification, seuils propres, publication automatique. */
export function ClientEditScreen({ clientId }: { clientId: string | null }) {
  const isNew = !clientId;
  const { data, error } = useApi<{ client: Editable }>(isNew ? null : `/agence/clients/${clientId}`);
  const [f, setF] = useState<Record<string, string | boolean>>({});
  const [th, setTh] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const defaults = data?.client.defaultThresholds;

  useEffect(() => {
    const c = data?.client;
    if (isNew) { setF({ name: '', status: 'onboarding', offer: '', startDate: '', campaignsLaunchedAt: '', driveFolderUrl: '', masterTrackerUrl: '', facebookPageId: '', adAccountCurrency: 'EUR', adAccountTimezone: 'Europe/Paris', autoPublishRecos: true, verticalsEnabled: false }); setTh({}); return; }
    if (!c) return;
    setF({
      name: c.name, status: c.status, offer: c.offer ?? '', startDate: c.startDate ?? '', campaignsLaunchedAt: c.campaignsLaunchedAt ?? '',
      driveFolderUrl: c.driveFolderUrl ?? '', masterTrackerUrl: c.masterTrackerUrl ?? '', facebookPageId: c.facebookPageId ?? '', adAccountCurrency: c.adAccountCurrency, adAccountTimezone: c.adAccountTimezone, autoPublishRecos: c.autoPublishRecos, verticalsEnabled: c.verticalsEnabled,
    });
    setTh(Object.fromEntries(THRESHOLDS.map((t) => [t.key, toDisplay(t.unit, c.thresholds[t.key])])));
  }, [data, isNew]);

  const set = (k: string) => (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).type === 'checkbox' ? (e.target as HTMLInputElement).checked : (e.target as HTMLInputElement).value });

  async function save(e: Event) {
    e.preventDefault();
    setErr(null); setSaved(null);
    const thresholds: Record<string, number | null> = {};
    for (const t of THRESHOLDS) {
      const v = fromDisplay(t.unit, th[t.key] ?? '');
      if (Number.isNaN(v)) { setErr(`${t.label} : valeur invalide.`); return; }
      thresholds[t.key] = v;
    }
    setBusy(true);
    try {
      const body = { ...f, thresholds };
      const r = isNew
        ? await api<{ client: Editable }>('/agence/clients', { method: 'POST', body: JSON.stringify(body) })
        : await api<{ client: Editable }>(`/agence/clients/${clientId}`, { method: 'PATCH', body: JSON.stringify(body) });
      if (isNew) { location.href = `/agence/clients/${r.client.id}`; return; } // recharge la liste des clients du menu
      setSaved('Modifications enregistrées.');
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }

  if (error) return <ErrorBox error={error} />;
  if (!isNew && !data) return <Loading />;
  return (
    <>
      <PageHead a={isNew ? 'Nouveau' : 'Fiche'} b="client" sub={isNew ? 'Créez le client ; ses connexions (Meta, GHL) se renseignent ensuite dans Connexions.' : `Identifiant ${data!.client.id}. Toute modification est journalisée avec la valeur avant et après.`}
        right={!isNew && <a class="ghost-btn" href={`/c/${clientId}/tableau-de-bord`} onClick={(e) => { e.preventDefault(); navigate(`/c/${clientId}/tableau-de-bord`); }}>Ouvrir l'espace</a>} />
      {err && <div class="banner alert" role="alert">{err}</div>}
      {saved && <div class="banner" role="status">{saved}</div>}
      {!isNew && <ProspectOrigin clientId={clientId!} />}
      {!isNew && <Parcours clientId={clientId!} key={saved ?? ''} />}
      <form onSubmit={save}>
        <div class="card section">
          <SectionTitle a="Le" b="client" />
          <div class="form-grid">
            <label class="field">Nom<input required maxLength={120} value={String(f.name ?? '')} onInput={set('name')} /></label>
            <label class="field">Statut
              <select value={String(f.status ?? 'onboarding')} onChange={set('status')}>
                {Object.entries(STATUS_LABEL).map(([k, l]) => <option value={k}>{l}</option>)}
              </select>
            </label>
            <label class="field">Offre<input maxLength={200} placeholder="Ex. Standard 1 500 € + 1 500 €" value={String(f.offer ?? '')} onInput={set('offer')} /></label>
            <label class="field">Date de démarrage<input type="date" value={String(f.startDate ?? '')} onInput={set('startDate')} /></label>
            <label class="field">Lancement des campagnes<input type="date" value={String(f.campaignsLaunchedAt ?? '')} onInput={set('campaignsLaunchedAt')} />
              <span class="hint">Masque le bandeau d'avancement côté client.</span></label>
            <label class="field">Dossier Drive<input type="url" placeholder="https://drive.google.com/…" value={String(f.driveFolderUrl ?? '')} onInput={set('driveFolderUrl')} /></label>
            <label class="field">Master tracker<input type="url" placeholder="https://docs.google.com/spreadsheets/…" value={String(f.masterTrackerUrl ?? '')} onInput={set('masterTrackerUrl')} /></label>
            <label class="field">ID de la page Facebook<input inputMode="numeric" placeholder="Rempli à la synchro Meta, sinon à saisir" value={String(f.facebookPageId ?? '')} onInput={set('facebookPageId')} /><span class="small muted">Sert au lien « bibliothèque publicitaire » de l'écran Vos publicités.</span></label>
            <label class="field">Devise du compte publicitaire<input maxLength={3} value={String(f.adAccountCurrency ?? 'EUR')} onInput={(e) => setF({ ...f, adAccountCurrency: (e.target as HTMLInputElement).value.toUpperCase() })} /></label>
            <label class="field">Fuseau du compte publicitaire<input value={String(f.adAccountTimezone ?? 'Europe/Paris')} onInput={set('adAccountTimezone')} /></label>
          </div>
          <label class="small" style="display:flex;gap:8px;align-items:center;margin-top:14px">
            <input type="checkbox" checked={Boolean(f.autoPublishRecos)} onChange={set('autoPublishRecos')} />
            <span><strong>Publier automatiquement les analyses</strong> : la synthèse et les recommandations deviennent visibles du client dès qu'elles sont rédigées, sans relecture.</span>
          </label>
          <label class="small" style="display:flex;gap:8px;align-items:center;margin-top:10px">
            <input type="checkbox" checked={Boolean(f.verticalsEnabled)} onChange={set('verticalsEnabled')} />
            <span><strong>Verticales</strong> : ce client a plusieurs avatars ; le Delivery propose des onglets pour construire une chaîne complète par verticale.</span>
          </label>
        </div>

        <div class="card section">
          <SectionTitle a="Seuils" b="du client" />
          <p class="small muted" style="margin:0 0 12px">Laissez vide pour appliquer le seuil par défaut (B2B, lancement). Ils servent aux verdicts du Pilotage et aux alertes quotidiennes.</p>
          <div class="form-grid">
            {THRESHOLDS.map((t) => (
              <label class="field">{t.label} ({t.unit === 'x' ? 'ratio' : t.unit})
                <input inputMode="decimal" value={th[t.key] ?? ''} placeholder={defaults && defaults[t.key] != null ? `Défaut : ${toDisplay(t.unit, defaults[t.key])}` : isNew ? 'Défaut' : 'Calculé'}
                  onInput={(e) => setTh({ ...th, [t.key]: (e.target as HTMLInputElement).value })} />
                <span class="hint">{t.hint}</span>
              </label>
            ))}
          </div>
        </div>
        <div style="display:flex;gap:10px;margin-top:12px">
          <button class="btn" type="submit" disabled={busy}>{busy ? 'Enregistrement…' : isNew ? 'Créer le client' : 'Enregistrer'}</button>
        </div>
      </form>
    </>
  );
}

interface ParcoursItem { key: string; label: string; done: boolean; detail: string; href: string | null; optional?: boolean }

/** Parcours nouveau client (décision 0020) : ce qui est fait, ce qui reste, et où le faire. */
function Parcours({ clientId }: { clientId: string }) {
  const { data, error } = useApi<{ items: ParcoursItem[]; done: number; total: number; next: string | null }>(`/agence/clients/${clientId}/parcours`);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const pct = Math.round((data.done / data.total) * 100);
  return (
    <div class="card section parcours">
      <SectionTitle a="Parcours" b="du client" right={<span class="mono small" style="color:var(--text-2)">{data.done}/{data.total} étapes</span>} />
      <div class="progress" aria-hidden="true" style="height:8px;margin-bottom:14px"><div style={{ width: `${pct}%` }} /></div>
      <ol style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px">
        {data.items.map((it, i) => {
          const next = it.key === data.next;
          return (
            <li class={`parcours-item ${it.done ? 'done' : ''} ${next ? 'next' : ''}`}>
              <span class="parcours-mark" aria-hidden="true">{it.done ? '✓' : String(i + 1).padStart(2, '0')}</span>
              <span style="display:flex;flex-direction:column;gap:2px;min-width:0">
                <span>{it.label}{it.optional ? <span class="small muted"> · facultatif</span> : null}{next ? <span class="pill surveiller" style="margin-left:8px">Prochaine étape</span> : null}</span>
                <span class="small muted" style="overflow-wrap:anywhere">{it.done ? 'Fait' : 'À faire'} · {it.detail}</span>
              </span>
              {it.href && !it.done && (
                <a class="ghost-btn small" style="margin-left:auto;white-space:nowrap" href={it.href} onClick={(e) => { e.preventDefault(); navigate(it.href!); }}>Y aller →</a>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Fiche prospect d'origine (section 29), en lecture : rien n'est copié dans l'onboarding. */
function ProspectOrigin({ clientId }: { clientId: string }) {
  const { data } = useApi<{ items: { id: string; name: string }[] }>(`/agence/prospects?clientId=${encodeURIComponent(clientId)}`, [clientId]);
  if (!data?.items.length) return null;
  return <p class="small section">Prospect d'origine : {data.items.map((p) => <a href={`/agence/prospects/${p.id}`} style="margin-right:8px">{p.name}</a>)}</p>;
}
