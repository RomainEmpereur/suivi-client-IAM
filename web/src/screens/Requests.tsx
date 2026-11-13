import { DELIVERABLE_TYPE_LABEL, formatDate, formatDateTime } from '@obsidian/domain';
import { api, useApi } from '../api.ts';
import { navigate } from '../router.ts';
import { EmptyState, ErrorBox, Loading, PageHead, SectionTitle } from '../components/ui.tsx';

interface Data {
  comments: { deliverableId: string; clientId: string; clientName: string; deliverableTitle: string; type: string; pending: number; lastAt: string; lastBody: string; author: string | null }[];
  feedback: { id: string; clientId: string; clientName: string; category: string; severity: string; status: string; excerpt: string; createdAt: string }[];
  handled: { deliverableId: string; clientId: string; clientName: string; deliverableTitle: string; handledAt: string; count: number }[];
}
const CAT: Record<string, string> = { bug: 'Bug', resultat: 'Résultats', demande: 'Demande', question: 'Question' };
const STAT: Record<string, string> = { nouveau: 'Nouveau', vu: 'Vu', en_cours: 'En cours', resolu: 'Résolu' };
const waiting = (iso: string) => {
  const h = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000);
  return h < 1 ? "il y a moins d'une heure" : h < 24 ? `il y a ${h} h` : `il y a ${Math.floor(h / 24)} j`;
};

/** Demandes clients (décision 0022) : ce qui attend une réponse de l'agence, le plus ancien d'abord. */
export function RequestsScreen() {
  const { data, error, loading, reload } = useApi<Data>('/agence/demandes');
  const go = (href: string) => (e: Event) => { e.preventDefault(); navigate(href); };
  async function handled(id: string) {
    await api(`/agence/demandes/livrables/${id}/traiter`, { method: 'POST' });
    reload();
    window.dispatchEvent(new Event('demandes-maj'));
  }
  return (
    <>
      <PageHead a="Demandes" b="clients" sub="Les commentaires des clients sur leurs livrables et leurs retours encore ouverts, le plus ancien d'abord. Répondre sur le livrable traite la demande." />
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading />}
      {data && (
        <>
          <div class="section">
            <SectionTitle a="Commentaires" b="sur les livrables" right={<span class="mono small" style="color:var(--text-2)">{data.comments.length} à traiter</span>} />
            {data.comments.length === 0
              ? <EmptyState title="Aucun commentaire en attente">Les commentaires des clients sur leurs livrables apparaissent ici jusqu'à votre réponse.</EmptyState>
              : (
                <div style="display:flex;flex-direction:column;gap:10px">
                  {data.comments.map((r) => (
                    <div class="card has-request" style="border-color:var(--alert);display:flex;flex-direction:column;gap:6px">
                      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                        <span class="urgent-dot" aria-hidden="true" />
                        <strong>{r.clientName}</strong>
                        <span class="small muted">{DELIVERABLE_TYPE_LABEL[r.type] ?? r.type} · {r.deliverableTitle}</span>
                        <span class="mono small" style="margin-left:auto;color:var(--alert)">{r.pending} commentaire{r.pending > 1 ? 's' : ''} · {waiting(r.lastAt)}</span>
                      </div>
                      <p style="margin:0;white-space:pre-wrap">« {r.lastBody} »</p>
                      <span class="small muted">{r.author ?? 'Client'} · {formatDateTime(r.lastAt)}</span>
                      <div style="display:flex;gap:8px;flex-wrap:wrap">
                        <a class="btn" href={`/c/${r.clientId}/livrables/${r.deliverableId}#commentaires`} onClick={go(`/c/${r.clientId}/livrables/${r.deliverableId}`)}>Répondre</a>
                        <button class="ghost-btn" onClick={() => handled(r.deliverableId)}>Marquer comme traité</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </div>

          <div class="section">
            <SectionTitle a="Retours" b="ouverts" right={<span class="mono small" style="color:var(--text-2)">{data.feedback.length}</span>} />
            {data.feedback.length === 0
              ? <EmptyState title="Aucun retour ouvert">Les retours déposés dans l'écran Feedback des clients apparaissent ici.</EmptyState>
              : (
                <div class="card" style="display:flex;flex-direction:column;gap:4px">
                  {data.feedback.map((f) => (
                    <a href={`/c/${f.clientId}/feedback`} onClick={go(`/c/${f.clientId}/feedback`)}
                      style={{ display: 'block', borderLeft: `3px solid ${f.severity === 'haute' ? 'var(--alert)' : f.severity === 'normale' ? 'var(--warn)' : 'var(--border)'}`, padding: '6px 10px', color: 'var(--text)' }}>
                      <div class="small"><strong>{f.clientName}</strong> · {CAT[f.category] ?? f.category}{f.severity === 'haute' ? ' · urgent' : ''} · <span class="mono small muted">{STAT[f.status] ?? f.status} · {waiting(f.createdAt)}</span></div>
                      <div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{f.excerpt}</div>
                    </a>
                  ))}
                </div>
              )}
          </div>

          {data.handled.length > 0 && (
            <div class="section">
              <SectionTitle a="Traitées" b="ces 14 jours" />
              <div class="card" style="display:flex;flex-direction:column;gap:6px">
                {data.handled.map((h) => (
                  <a class="small" href={`/c/${h.clientId}/livrables/${h.deliverableId}`} onClick={go(`/c/${h.clientId}/livrables/${h.deliverableId}`)} style="color:var(--text)">
                    ✓ <strong>{h.clientName}</strong> · {h.deliverableTitle} <span class="muted">· {h.count} commentaire{h.count > 1 ? 's' : ''} · traité le {formatDate(h.handledAt)}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
