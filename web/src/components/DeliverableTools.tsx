import { useState } from 'preact/hooks';
import { DELIVERABLE_STATUS_LABEL, DELIVERABLE_TYPE_LABEL, formatDateTime } from '@obsidian/domain';
import { api, useApi } from '../api.ts';
import { useSession } from '../session.ts';

interface Comment { id: string; body: string; createdAt: string; authorRole: 'client' | 'agence'; author: string; mine: boolean; pending?: boolean }

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
    try { await api(`/clients/${clientId}/deliverables/${deliverableId}/comments`, { method: 'POST', body: JSON.stringify({ body: text }) }); setText(''); reload(); window.dispatchEvent(new Event('demandes-maj')); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  async function markHandled() {
    setErr(null);
    try { await api(`/agence/demandes/livrables/${deliverableId}/traiter`, { method: 'POST' }); reload(); window.dispatchEvent(new Event('demandes-maj')); } catch (x) { setErr((x as Error).message); }
  }
  const pending = (data?.comments ?? []).filter((k) => k.pending).length;
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
        {data && data.comments.length === 0 && <p class="small muted" style="margin:0">{me.user.role === 'client' || view === 'client' ? 'Une question, une correction, un détail à revoir ? Écrivez-le ici : l\'équipe Obsidian Partners le voit dans votre espace.' : 'Aucun commentaire du client pour le moment.'}</p>}
        {view === 'agence' && pending > 0 && (
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <span class="urgent-badge"><span class="urgent-dot" aria-hidden="true" />{pending} commentaire{pending > 1 ? 's' : ''} du client à traiter</span>
            <span class="small muted">Répondre ci-dessous traite la demande.</span>
            <button class="ghost-btn small" onClick={markHandled}>Marquer comme traité sans répondre</button>
          </div>
        )}
        {data?.comments.map((k) => (
          <div class={k.pending ? 'comment-pending' : undefined} style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '10px 12px', borderRadius: '8px', background: k.authorRole === 'agence' ? 'var(--primary-soft)' : 'var(--surface-2)' }}>
            <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
              <strong class="small">{k.author}</strong>
              <span class="mono small muted">{formatDateTime(k.createdAt)}</span>
              {k.pending && <span class="pill corriger">À traiter</span>}
              {(k.mine || view === 'agence') && canWrite && <button class="ghost-btn small" style="margin-left:auto;padding:2px 8px" onClick={() => remove(k)}>Supprimer</button>}
            </div>
            <p class="small" style="margin:0;white-space:pre-wrap">{k.body}</p>
          </div>
        ))}
        {!canWrite && me.user.role === 'agence' && (
          <div style="display:flex;flex-direction:column;gap:8px;opacity:.6">
            <textarea rows={3} disabled placeholder="Votre commentaire sur ce livrable…" />
            <button class="btn" disabled style="align-self:flex-start">Envoyer</button>
            <span class="small" style="color:var(--agency)">Aperçu : ici, le client écrit et envoie ses commentaires. En vue client, l'agence est en lecture seule ; repassez en vue agence pour lui répondre.</span>
          </div>
        )}
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

export interface ReworkState {
  available: boolean; reason?: string; step?: string; label?: string; queued?: boolean; instruction?: string | null;
  proposed?: boolean; generatedAt?: string | null; lastError?: string | null;
}

/**
 * Reprise par Claude à partir des commentaires du client (décision 0023) : la consigne part dans la file du delivery,
 * Claude modifie uniquement ce qui est demandé, l'agence relit et valide la nouvelle version dans Delivery, ce qui la publie.
 */
export function ReworkPanel({ clientId, deliverableId, rework, onDone }: { clientId: string; deliverableId: string; rework: ReworkState; onDone: () => void }) {
  const { data } = useApi<{ comments: Comment[] }>(rework.available && !rework.queued ? `/clients/${clientId}/deliverables/${deliverableId}/comments` : null, [rework.queued]);
  const clientComments = (data?.comments ?? []).filter((k) => k.authorRole === 'client');
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const selected = picked ?? new Set(clientComments.filter((k) => k.pending).map((k) => k.id));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toggle = (id: string) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setPicked(n); };

  async function launch() {
    setBusy(true); setErr(null);
    try {
      await api(`/clients/${clientId}/deliverables/${deliverableId}/rework`, { method: 'POST', body: JSON.stringify({ commentIds: [...selected], note }) });
      setNote(''); setPicked(null); onDone(); window.dispatchEvent(new Event('demandes-maj'));
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }

  return (
    <section class="section">
      <h2 class="section-title">Reprise par Claude</h2>
      <div class="card" style="display:flex;flex-direction:column;gap:10px">
        {err && <div class="banner alert" role="alert">{err}</div>}
        {!rework.available && <p class="small muted" style="margin:0">{rework.reason}</p>}
        {rework.available && rework.queued && (
          <div class="banner warn" role="status" style="flex-direction:column;align-items:flex-start;gap:6px">
            <strong>Reprise en cours ({rework.label})</strong>
            <span class="small">Claude rédige la nouvelle version au prochain passage du robot (chaque heure, de 7 h à 21 h, heure de Paris). Elle arrivera « à valider » dans Delivery ; rien n'est publié avant votre validation.</span>
            {rework.instruction && <details class="small"><summary>Consigne envoyée</summary><pre style="white-space:pre-wrap;margin:6px 0 0">{rework.instruction}</pre></details>}
          </div>
        )}
        {rework.available && !rework.queued && rework.proposed && (
          <div class="banner accent" role="status" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <span><strong>Nouvelle version proposée par Claude</strong>{rework.generatedAt ? ` le ${formatDateTime(rework.generatedAt)}` : ''}. Relisez-la et validez-la dans Delivery : la validation la publie pour le client (version suivante, « Mis à jour »).</span>
            <a class="btn" href={`/c/${clientId}/delivery#${rework.step}`}>Relire et valider →</a>
          </div>
        )}
        {rework.available && !rework.queued && rework.lastError && <div class="banner alert" role="alert">Dernière reprise en échec : {rework.lastError}</div>}
        {rework.available && !rework.queued && (
          <>
            <p class="small muted" style="margin:0">Claude reprend ce livrable ({rework.label}) en ne modifiant que ce que demandent les commentaires choisis. La nouvelle version vous est proposée dans Delivery ; vous la publiez en la validant.</p>
            {clientComments.length === 0
              ? <p class="small muted" style="margin:0">Aucun commentaire du client sur ce livrable : écrivez la consigne vous-même.</p>
              : (
                <div style="display:flex;flex-direction:column;gap:6px">
                  <span class="label">Commentaires du client à prendre en compte</span>
                  {clientComments.map((k) => (
                    <label class="small" style="display:flex;gap:8px;align-items:flex-start">
                      <input type="checkbox" checked={selected.has(k.id)} onChange={() => toggle(k.id)} style="margin-top:3px" />
                      <span><span class="mono muted">{formatDateTime(k.createdAt)}</span>{k.pending ? <span class="pill corriger" style="margin-left:6px">À traiter</span> : null}<br />{k.body}</span>
                    </label>
                  ))}
                </div>
              )}
            <label class="field">Précision pour Claude (facultatif)
              <textarea rows={3} maxLength={2000} value={note} placeholder="Ex. garder la promesse actuelle, ne changer que la garantie du paragraphe 3" onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
            </label>
            <button class="btn" style="align-self:flex-start" disabled={busy || (selected.size === 0 && !note.trim())} onClick={launch}>
              {busy ? 'Envoi…' : `Faire reprendre par Claude${selected.size ? ` (${selected.size} commentaire${selected.size > 1 ? 's' : ''})` : ''}`}
            </button>
            <span class="hint small muted">Les commentaires choisis passent « traités ». Pensez à répondre au client une fois la nouvelle version publiée.</span>
          </>
        )}
      </div>
    </section>
  );
}
