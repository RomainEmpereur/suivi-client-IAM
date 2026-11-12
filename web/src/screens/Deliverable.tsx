import { DELIVERABLE_STATUS_LABEL, DELIVERABLE_TYPE_LABEL, formatDate } from '@obsidian/domain';
import { useApi } from '../api.ts';
import { EmptyState, ErrorBox, Loading, PageHead, Pill } from '../components/ui.tsx';
import { renderMarkdown } from '../markdown.ts';
import { HtmlViewerButtons } from '../components/HtmlViewer.tsx';
import { CommentsThread } from '../components/DeliverableTools.tsx';

interface Data {
  deliverable: { id: string; type: string; title: string; status: string; version?: number; publishedAt?: string | null; externalUrl?: string | null; published: boolean };
  contentMd: string | null;
}

/** Lecture d'un livrable rédigé, mis en page (client et agence). */
export function DeliverableScreen({ clientId, deliverableId }: { clientId: string; deliverableId: string }) {
  const { data, error, loading } = useApi<Data>(`/clients/${clientId}/deliverables/${deliverableId}`);
  const d = data?.deliverable;
  return (
    <>
      <p class="small" style="margin:0 0 8px"><a href={`/c/${clientId}/infrastructure`}>← Infrastructure</a></p>
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading />}
      {d && (
        <>
          <PageHead a={DELIVERABLE_TYPE_LABEL[d.type] ?? 'Livrable'} b={d.title}
            sub={<span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <Pill kind={d.status === 'valide' || d.status === 'mis_a_jour' ? 'tenu' : d.status === 'a_relire' ? 'surveiller' : 'neutral'}>{DELIVERABLE_STATUS_LABEL[d.status as keyof typeof DELIVERABLE_STATUS_LABEL] ?? d.status}</Pill>
              {d.version && d.version > 1 ? <span class="mono small muted">Version {d.version}</span> : null}
              {d.publishedAt && <span class="mono small muted">Publié le {formatDate(d.publishedAt, { year: true })}</span>}
            </span>}
            right={d.externalUrl && data!.contentMd ? <a class="btn" href={d.externalUrl} target="_blank" rel="noopener noreferrer">Ouvrir le document ↗</a> : undefined} />
          {data!.contentMd && <div class="section" style="display:flex;gap:8px;flex-wrap:wrap"><HtmlViewerButtons md={data!.contentMd} title={d.title} /></div>}
          {data!.contentMd
            ? <article class="card md-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(data!.contentMd) }} />
            : d.externalUrl
            ? <div class="card" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span>Ce livrable se consulte dans son document.</span>
                <a class="btn" href={d.externalUrl} target="_blank" rel="noopener noreferrer">{/^https:\/\/(drive|docs)\.google\.com\//.test(d.externalUrl) ? 'Ouvrir dans Drive ↗' : 'Ouvrir le document ↗'}</a></div>
            : <EmptyState title="Contenu disponible à la publication">Ce livrable est en préparation.</EmptyState>}
          {(d.published || data!.contentMd || d.externalUrl) && <div id="commentaires"><CommentsThread clientId={clientId} deliverableId={d.id} /></div>}
        </>
      )}
    </>
  );
}
