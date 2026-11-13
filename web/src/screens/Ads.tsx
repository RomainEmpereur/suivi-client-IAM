import { useState } from 'preact/hooks';
import { addDaysYmd, formatDate, formatDateTime, formatEuros, formatInt, todayParis } from '@obsidian/domain';
import { useApi } from '../api.ts';
import { AgencyNote, EmptyState, ErrorBox, Loading, PageHead, Pill, Segmented } from '../components/ui.tsx';
import { useSession } from '../session.ts';

interface Ad {
  id: string; name: string | null; campaign: string | null; createdTime: string | null; format: string | null; status: string | null; title: string | null; body: string | null;
  image: string | null; previewUrl: string | null; spendCents: number | null; leads: number | null; costPerLeadCents: number | null;
}
interface Data {
  libraryUrl: string | null; synced: boolean; syncedAt: string | null; period: { from: string; to: string }; mode: 'actives' | 'periode';
  truncated: number; fetchError: string | null; ads: Ad[];
}
type Mode = 'actives' | '30' | '90' | 'periode';
const STATUS: Record<string, [string, string]> = {
  ACTIVE: ['ok', 'Active'], PAUSED: ['neutral', 'En pause'], CAMPAIGN_PAUSED: ['neutral', 'En pause'], ADSET_PAUSED: ['neutral', 'En pause'],
  ARCHIVED: ['neutral', 'Archivée'], DELETED: ['corriger', 'Supprimée'],
};

const FORMAT: Record<string, string> = { VIDEO: 'Vidéo', PHOTO: 'Image', SHARE: 'Image ou carrousel', STATUS: 'Texte' };

/** Vos publicités (décision 0026) : les publicités actives, leur aperçu et leurs chiffres des 30 derniers jours. */
export function AdsScreen({ clientId }: { clientId: string }) {
  const { view } = useSession();
  const yesterday = addDaysYmd(todayParis(), -1);
  const [mode, setMode] = useState<Mode>('actives');
  const [custom, setCustom] = useState({ from: addDaysYmd(yesterday, -29), to: yesterday });
  const range = mode === '30' ? { from: addDaysYmd(yesterday, -29), to: yesterday } : mode === '90' ? { from: addDaysYmd(yesterday, -89), to: yesterday } : mode === 'periode' ? custom : null;
  const q = range ? `?from=${range.from}&to=${range.to}` : '';
  const { data, error, loading } = useApi<Data>(`/clients/${clientId}/publicites${q}`, [view, q]);
  const picker = (
    <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin-bottom:18px">
      <Segmented<Mode> label="Publicités affichées" value={mode} onChange={setMode}
        options={[{ value: 'actives', label: 'En ce moment' }, { value: '30', label: '30 derniers jours' }, { value: '90', label: '90 derniers jours' }, { value: 'periode', label: 'Période…' }]} />
      {mode === 'periode' && (
        <>
          <label class="field">Du<input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: (e.target as HTMLInputElement).value })} /></label>
          <label class="field">Au<input type="date" value={custom.to} min={custom.from} max={yesterday} onChange={(e) => setCustom({ ...custom, to: (e.target as HTMLInputElement).value })} /></label>
        </>
      )}
    </div>
  );
  if (error) return <>{picker}<ErrorBox error={error} /></>;
  if (loading || !data) return <>{picker}<Loading /></>;
  const past = data.mode === 'periode';
  const library = data.libraryUrl && (
    <a class="btn" href={data.libraryUrl} target="_blank" rel="noopener noreferrer">Voir dans la bibliothèque publicitaire Meta ↗</a>
  );
  return (
    <>
      <PageHead a="Vos publicités" b={past ? "sur la période" : "en ligne"}
        sub={past
          ? `Les publicités qui ont tourné du ${formatDate(data.period.from, { year: true })} au ${formatDate(data.period.to, { year: true })}, quel que soit leur statut aujourd'hui, avec leurs chiffres sur la période. Les meilleurs résultats d'abord.`
          : `Les publicités qui tournent en ce moment, avec leurs chiffres des 30 derniers jours (${formatDate(data.period.from)} → ${formatDate(data.period.to)}). « Voir l'aperçu » ouvre la publicité telle qu'elle apparaît dans le fil.`}
        right={library || undefined} />
      {picker}
      {data.fetchError && <p class="small" style="color:var(--warn)">{data.fetchError} Les chiffres restent justes ; réessayez dans quelques minutes.</p>}

      {data.ads.length === 0 ? (
        past ? (
          <EmptyState title="Aucune publicité sur cette période">
            Aucune dépense publicitaire enregistrée sur ces dates. Si les campagnes tournaient, l'historique synchronisé ne remonte peut-être pas jusque-là.
          </EmptyState>
        ) :
        <EmptyState title={data.synced && !data.syncedAt ? 'Liste pas encore lue' : 'Aucune publicité active en ce moment'}>
          {data.synced && !data.syncedAt
            ? 'Pas encore lu dans Meta : la liste arrive à la prochaine synchronisation (chaque matin).'
            : data.synced
            ? 'Les campagnes sont en pause ou en préparation. Les publicités apparaîtront ici le lendemain de leur lancement.'
            : data.libraryUrl ? 'Retrouvez les publicités actives de votre page dans la bibliothèque publicitaire Meta (bouton ci-dessus).' : 'Elles apparaîtront ici dès leur lancement.'}
        </EmptyState>
      ) : (
        <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(min(280px,100%),1fr));gap:14px">
          {data.ads.map((a) => (
            <article class="card" style="display:flex;flex-direction:column;gap:10px;min-width:0;padding:0;overflow:hidden">
              {a.image
                ? <img src={a.image} alt={`Visuel de la publicité ${a.name ?? ''}`} loading="lazy" referrerpolicy="no-referrer"
                    style="width:100%;aspect-ratio:1/1;object-fit:cover;background:var(--surface-2, #111)"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                : <div class="muted small" style="aspect-ratio:1/1;display:grid;place-items:center">Visuel indisponible</div>}
              <div style="padding:0 14px 14px;display:flex;flex-direction:column;gap:8px">
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                  {past && a.status && <Pill kind={(STATUS[a.status] ?? ['neutral'])[0]}>{(STATUS[a.status] ?? ['', 'Autre statut'])[1]}</Pill>}
                  <span class="mono small muted">{FORMAT[a.format ?? ''] ?? 'Publicité'}{a.createdTime ? ` · créée le ${formatDate(a.createdTime, { year: true })}` : ''}</span>
                </div>
                <strong style="overflow-wrap:anywhere">{a.title || a.name}</strong>
                {a.body && <p class="small" style="margin:0;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-line">{a.body}</p>}
                <div class="small" style="display:flex;gap:12px;flex-wrap:wrap">
                  <span>Dépense <strong>{formatEuros(a.spendCents)}</strong></span>
                  <span>Leads <strong>{formatInt(a.leads)}</strong></span>
                  <span>Coût par lead <strong>{formatEuros(a.costPerLeadCents)}</strong></span>
                </div>
                {a.previewUrl && <a class="ghost-btn" style="align-self:flex-start" href={a.previewUrl} target="_blank" rel="noopener noreferrer">Voir l'aperçu ↗</a>}
              </div>
            </article>
          ))}
        </div>
      )}
      {past && data.truncated > 0 && <p class="small muted" style="margin-top:14px">Les {data.ads.length} publicités qui ont le plus dépensé sont affichées ; {data.truncated} autre(s) plus petite(s) ne le sont pas. Réduisez la période pour les voir.</p>}
      {past && data.ads.some((a) => a.status === 'DELETED') && <p class="small muted">Publicité supprimée dans Meta : ses chiffres restent, mais Meta ne fournit plus son visuel.</p>}
      {!past && data.syncedAt && <p class="mono small muted" style="margin-top:14px">Liste lue dans Meta le {formatDateTime(data.syncedAt)}.</p>}
      {view === 'agence' && !data.libraryUrl && <AgencyNote>renseignez l'ID de la page Facebook dans la fiche client pour afficher le lien vers la bibliothèque publicitaire (il se remplit seul à la synchro Meta quand une publicité est active).</AgencyNote>}
      {view === 'agence' && !data.synced && <AgencyNote>pas de jeton Meta pour ce client : seules les publicités de la bibliothèque publicitaire sont visibles (lien ci-dessus).</AgencyNote>}
    </>
  );
}
