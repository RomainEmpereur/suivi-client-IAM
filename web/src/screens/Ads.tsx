import { formatDate, formatDateTime, formatEuros, formatInt } from '@obsidian/domain';
import { useApi } from '../api.ts';
import { AgencyNote, EmptyState, ErrorBox, Loading, PageHead } from '../components/ui.tsx';
import { useSession } from '../session.ts';

interface Ad {
  id: string; name: string | null; campaign: string | null; createdTime: string | null; format: string | null; title: string | null; body: string | null;
  image: string | null; previewUrl: string | null; spendCents: number | null; leads: number | null; costPerLeadCents: number | null;
}
interface Data { libraryUrl: string | null; synced: boolean; syncedAt: string | null; period: { from: string; to: string }; ads: Ad[] }

const FORMAT: Record<string, string> = { VIDEO: 'Vidéo', PHOTO: 'Image', SHARE: 'Image ou carrousel', STATUS: 'Texte' };

/** Vos publicités (décision 0026) : les publicités actives, leur aperçu et leurs chiffres des 30 derniers jours. */
export function AdsScreen({ clientId }: { clientId: string }) {
  const { view } = useSession();
  const { data, error, loading } = useApi<Data>(`/clients/${clientId}/publicites`, [view]);
  if (error) return <ErrorBox error={error} />;
  if (loading || !data) return <Loading />;
  const library = data.libraryUrl && (
    <a class="btn" href={data.libraryUrl} target="_blank" rel="noopener noreferrer">Voir dans la bibliothèque publicitaire Meta ↗</a>
  );
  return (
    <>
      <PageHead a="Vos publicités" b="en ligne"
        sub={`Les publicités qui tournent en ce moment, avec leurs chiffres des 30 derniers jours (${formatDate(data.period.from)} → ${formatDate(data.period.to)}). « Voir l'aperçu » ouvre la publicité telle qu'elle apparaît dans le fil.`}
        right={library || undefined} />

      {data.ads.length === 0 ? (
        <EmptyState title="Aucune publicité active en ce moment">
          {data.synced
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
                <div class="mono small muted">{FORMAT[a.format ?? ''] ?? 'Publicité'}{a.createdTime ? ` · créée le ${formatDate(a.createdTime, { year: true })}` : ''}</div>
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
      {data.syncedAt && <p class="mono small muted" style="margin-top:14px">Liste lue dans Meta le {formatDateTime(data.syncedAt)}.</p>}
      {view === 'agence' && !data.libraryUrl && <AgencyNote>renseignez l'ID de la page Facebook dans la fiche client pour afficher le lien vers la bibliothèque publicitaire (il se remplit seul à la synchro Meta quand une publicité est active).</AgencyNote>}
      {view === 'agence' && !data.synced && <AgencyNote>pas de jeton Meta pour ce client : seules les publicités de la bibliothèque publicitaire sont visibles (lien ci-dessus).</AgencyNote>}
    </>
  );
}
