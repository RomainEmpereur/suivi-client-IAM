import { useState } from 'preact/hooks';
import { DELIVERABLE_STATUS_LABEL, DELIVERABLE_TYPE_LABEL, formatDateTime } from '@obsidian/domain';
import { api, useApi } from '../api.ts';
import { useSession } from '../session.ts';

interface Comment { id: string; body: string; createdAt: string; authorRole: 'client' | 'agence'; author: string; mine: boolean }

/** Fil de commentaires d'un livrable (décision 0020) : le client commente, l'agence répond en vue agence. */
export function CommentsThread({ clientId, deliverableId }: { clientId: string; deliverableId: string }) {
  const { data, error, reload } = useApi<{ comments: Comment[] }>(`/clients/${clientId}/deliverables/${deliverableId}/comments`);
  const { me, view } = useSession();
  const canWrite = me.user.role === 'client' || view === 'agence';
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send(e: Event) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setErr(null);
    try { await api(`/clients/${clientId}/deliverables/${deliverableId}/comments`, { method: 'POST', body: JSON.stringify({ body: text }) }); setText(''); reload(); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  async function remove(k: Comment) {
    if (!confirm('Supprimer ce commentaire ?')) return;
    try { await api(`/clients/${clientId}/deliverables/${deliverableId}/comments/${k.id}`, { method: 'DELETE' }); reload(); } catch (x) { setErr((x as Error).message); }
  }

  return (
    <section class="section">
      <h2 class="section-title">Commentaires</h2>
      <div class="card" style="display:flex;flex-direction:column;gap:12px">
        {error && <div class="banner alert" role="alert">{error.message}</div>}
        {err && <div class="banner alert" role="alert">{err}</div>}
        {data && data.comments.length === 0 && <p class="small muted" style="margin:0">{me.user.role === 'client' ? 'Une question, une correction, un détail à revoir ? Écrivez-le ici : l\'équipe Obsidian Partners le voit dans votre espace.' : 'Aucun commentaire du client pour le moment.'}</p>}
        {data?.comments.map((k) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '10px 12px', borderRadius: '8px', background: k.authorRole === 'agence' ? 'var(--primary-soft)' : 'var(--surface-2)' }}>
            <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
              <strong class="small">{k.author}</strong>
              <span class="mono small muted">{formatDateTime(k.createdAt)}</span>
              {(k.mine || view === 'agence') && canWrite && <button class="ghost-btn small" style="margin-left:auto;padding:2px 8px" onClick={() => remove(k)}>Supprimer</button>}
            </div>
            <p class="small" style="margin:0;white-space:pre-wrap">{k.body}</p>
          </div>
        ))}
        {canWrite && (
          <form onSubmit={send} style="display:flex;flex-direction:column;gap:8px">
            <textarea rows={3} maxLength={4000} required value={text} placeholder={me.user.role === 'client' ? 'Votre commentaire sur ce livrable…' : 'Réponse au client…'}
              onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
            <button class="btn" type="submit" disabled={busy || !text.trim()} style="align-self:flex-start">{busy ? 'Envoi…' : 'Envoyer'}</button>
          </form>
        )}
      </div>
    </section>
  );
}

export interface EditableDeliverable {
  id: string; type: string; title: string; status: string; externalUrl?: string | null; clientSummary?: string | null; published: boolean; hasContent?: boolean;
}

/** Ajout ou modification d'un livrable par l'agence (vue agence). */
export function DeliverableEditor({ clientId, deliverable, onDone }: { clientId: string; deliverable?: EditableDeliverable; onDone: () => void }) {
  const d = deliverable;
  const [f, setF] = useState({
    type: d?.type ?? 'offre', title: d?.title ?? '', clientSummary: d?.clientSummary ?? '', externalUrl: d?.externalUrl ?? '',
    status: d?.status ?? 'valide', visible: d ? d.published : true,
  });
  const [content, setContent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: Event) => {
    const t = e.target as HTMLInputElement;
    setF({ ...f, [k]: t.type === 'checkbox' ? t.checked : t.value });
  };

  async function loadContent() {
    if (!d) { setContent(''); return; }
    const r = await api<{ contentMd: string | null }>(`/clients/${clientId}/deliverables/${d.id}`);
    setContent(r.contentMd ?? '');
  }
  async function save(e: Event) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const body: Record<string, unknown> = { ...f, status: f.visible && f.status === 'brouillon' ? 'valide' : f.status };
    if (content !== null) body.contentMd = content;
    try {
      await api(d ? `/clients/${clientId}/deliverables/${d.id}` : `/clients/${clientId}/deliverables`, { method: d ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      onDone();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!d || !confirm(`Supprimer le livrable « ${d.title} » ? Ses commentaires sont supprimés aussi.`)) return;
    try { await api(`/clients/${clientId}/deliverables/${d.id}`, { method: 'DELETE' }); onDone(); } catch (x) { setErr((x as Error).message); }
  }

  return (
    <form onSubmit={save} style="display:flex;flex-direction:column;gap:10px;border-top:1px dashed var(--border);padding-top:10px;margin-top:4px">
      {err && <div class="banner alert" role="alert">{err}</div>}
      <div class="form-grid">
        <label class="field">Type<select value={f.type} onChange={set('type')}>{Object.entries(DELIVERABLE_TYPE_LABEL).map(([k, l]) => <option value={k}>{l}</option>)}</select></label>
        <label class="field">Statut<select value={f.status} onChange={set('status')}>{Object.entries(DELIVERABLE_STATUS_LABEL).map(([k, l]) => <option value={k}>{l}</option>)}</select></label>
      </div>
      <label class="field">Titre<input required maxLength={160} value={f.title} onInput={set('title')} /></label>
      <label class="field">Résumé pour le client<input maxLength={400} value={f.clientSummary} onInput={set('clientSummary')} placeholder="Une phrase : ce que contient le livrable" /></label>
      <label class="field">Lien (Drive, document…)<input type="url" value={f.externalUrl} onInput={set('externalUrl')} placeholder="https://drive.google.com/…" /></label>
      {content === null
        ? <button type="button" class="ghost-btn small" style="align-self:flex-start" onClick={loadContent}>{d?.hasContent ? 'Modifier le texte du livrable' : 'Ajouter un texte (markdown)'}</button>
        : <label class="field">Texte du livrable (markdown)<textarea rows={10} value={content} onInput={(e) => setContent((e.target as HTMLTextAreaElement).value)} /></label>}
      <label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" checked={f.visible} onChange={set('visible')} /> Visible par le client</label>
      {d?.published && <span class="hint small muted">Un livrable publié dont le lien ou le texte change passe en version suivante, « Mis à jour ».</span>}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" type="submit" disabled={busy}>{busy ? 'Enregistrement…' : d ? 'Enregistrer' : 'Ajouter le livrable'}</button>
        <button type="button" class="ghost-btn" onClick={onDone}>Annuler</button>
        {d && <button type="button" class="ghost-btn" style="margin-left:auto;color:var(--alert)" onClick={remove}>Supprimer</button>}
      </div>
    </form>
  );
}
