import { useState } from 'preact/hooks';
import { formatDate, formatDateTime } from '@obsidian/domain';
import { ApiError, api, openFile, useApi } from '../api.ts';
import { useSession } from '../session.ts';
import { AgencyNote, EmptyState, ErrorBox, Loading, PageHead, Pill } from '../components/ui.tsx';
import { renderMarkdown } from '../markdown.ts';

interface GuideCard { id: string; title: string; kind: string; url: string | null; hasBody?: boolean; hasFile?: boolean; pinned: boolean; readAt: string | null; published?: boolean }
const KIND: Record<string, string> = { pdf: 'PDF', video: 'Vidéo', page: 'Guide' };

/** Grille des guides (§11) : communs à tous les clients, ou épinglés pour ce client. */
export function GuidesScreen({ clientId }: { clientId: string }) {
  const { data, error, loading } = useApi<{ guides: GuideCard[] }>(`/clients/${clientId}/guides`);
  const { me, view } = useSession();
  return (
    <>
      <PageHead a="Les" b="guides" sub="Les procédures pas à pas. « Mettre à jour ses rendez-vous » est la plus importante : sans elle, le compteur ne peut pas avancer."
        right={me.user.role === 'agence' && view === 'agence' ? <a class="ghost-btn" href="/agence/guides">Rédiger et publier les guides →</a> : undefined} />
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading />}
      {data && data.guides.length === 0 && <EmptyState title="Aucun guide pour le moment">Les guides apparaissent ici dès qu’ils sont publiés.</EmptyState>}
      {data && (
        <div class="grid grid-3 stack">
          {data.guides.map((g) => (
            <article id={g.id} class="card edge deliverable" style={{ '--edge': g.published === false ? 'var(--agency)' : 'var(--border)' }}>
              <div class="kpi-row"><span class="label">{KIND[g.kind] ?? g.kind}{g.pinned ? ' · pour vous' : ''}</span>{g.readAt && <Pill kind="neutral">Lu</Pill>}</div>
              <h3>{g.title}</h3>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                {g.hasBody && <a class="btn" href={`/c/${clientId}/guides/${g.id}`}>Lire le guide</a>}
                {g.hasFile && <button class={g.hasBody ? 'ghost-btn' : 'btn'} onClick={() => openFile(`/clients/${clientId}/guides/${g.id}/file`).catch((e) => alert(e.message))}>PDF</button>}
                {!g.hasBody && !g.hasFile && g.url && <a class="btn" href={g.url} target="_blank" rel="noopener noreferrer">Ouvrir ↗</a>}
              </div>
              {g.published === false && <AgencyNote>ce guide est en brouillon, il n'est pas visible par le client.</AgencyNote>}
            </article>
          ))}
        </div>
      )}
    </>
  );
}

/** Lecture d'un guide rédigé. */
export function GuideScreen({ clientId, guideId }: { clientId: string; guideId: string }) {
  const { data, error, loading } = useApi<{ guide: { id: string; title: string; url: string | null; bodyMd: string | null; hasFile?: boolean; updatedAt: string; published?: boolean } }>(`/clients/${clientId}/guides/${guideId}`);
  const g = data?.guide;
  return (
    <>
      <p class="small" style="margin:0 0 8px"><a href={`/c/${clientId}/guides`}>← Tous les guides</a></p>
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading />}
      {g && (
        <>
          <PageHead a="Guide" b={g.title} sub={<span class="mono small muted">Mis à jour le {formatDate(g.updatedAt, { year: true })}</span>}
            right={<div style="display:flex;gap:8px">{g.hasFile && <button class="btn" onClick={() => openFile(`/clients/${clientId}/guides/${g.id}/file`).catch((e) => alert(e.message))}>Version PDF (avec captures)</button>}{g.url && <a class="ghost-btn" href={g.url} target="_blank" rel="noopener noreferrer">Version vidéo / PDF ↗</a>}<button class="btn no-print" onClick={() => window.print()}>Imprimer</button></div>} />
          {g.published === false && <div class="banner warn"><span>Brouillon : le client ne voit pas encore ce guide.</span></div>}
          {g.bodyMd ? <article class="card md-content guide" dangerouslySetInnerHTML={{ __html: renderMarkdown(g.bodyMd) }} /> : <EmptyState title="Guide sans contenu rédigé" />}
        </>
      )}
    </>
  );
}

interface AgencyGuide { id: string; hasFile?: boolean; clientId: string | null; title: string; kind: string; url: string | null; bodyMd: string | null; sortOrder: number; published: boolean; updatedAt: string }

/** Rédaction des guides (agence) : titre, contenu (markdown + captures en lien https), épinglage, ordre, publication. */
export function AgencyGuidesScreen() {
  const { me } = useSession();
  const { data, error, loading, reload } = useApi<{ guides: AgencyGuide[] }>('/agence/guides');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const clientName = (id: string | null) => (id ? me.clients.find((c) => c.id === id)?.name ?? id : 'Tous les clients');
  const current = data?.guides.find((g) => g.id === editing);
  return (
    <>
      <PageHead a="Guides" b="rédaction" sub="Rédigez les guides, épinglez-les pour un client ou partagez-les à tous, puis publiez. Un brouillon n’est jamais visible côté client."
        right={<button class="btn" onClick={() => setEditing('new')}>Nouveau guide</button>} />
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading />}
      {editing && <GuideEditor key={editing} g={editing === 'new' ? null : current ?? null} onClose={() => setEditing(null)} onSaved={() => { reload(); }} />}
      <div class="grid" style="gap:8px">
        {data?.guides.map((g) => (
          <div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
            <div>
              <strong>{g.title}</strong>
              <div class="small muted">{clientName(g.clientId)} · ordre {g.sortOrder} · modifié le {formatDateTime(g.updatedAt)}{g.hasFile ? ' · PDF joint' : ''}{g.bodyMd ? '' : g.url ? ' · lien externe' : g.hasFile ? '' : ' · vide'}</div>
            </div>
            <span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <PdfControls g={g} onChange={reload} compact />
              {g.published ? <Pill kind="ok">Publié</Pill> : <Pill kind="neutral">Brouillon</Pill>}
              <button class="ghost-btn" onClick={() => setEditing(g.id)}>Modifier</button>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function GuideEditor({ g, onClose, onSaved }: { g: AgencyGuide | null; onClose: () => void; onSaved: () => void }) {
  const { me } = useSession();
  const [title, setTitle] = useState(g?.title ?? '');
  const [body, setBody] = useState(g?.bodyMd ?? '');
  const [url, setUrl] = useState(g?.url ?? '');
  const [clientId, setClientId] = useState(g?.clientId ?? '');
  const [sortOrder, setSortOrder] = useState(g?.sortOrder ?? 100);
  const [preview, setPreview] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function save(extra: Record<string, unknown> = {}) {
    setMsg(null);
    const payload = { title, bodyMd: body, url, clientId: clientId || null, sortOrder: Number(sortOrder) || 0, kind: 'page', ...extra };
    try {
      if (g) await api(`/agence/guides/${g.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/agence/guides', { method: 'POST', body: JSON.stringify(payload) });
      setMsg({ ok: true, text: extra.published === true ? 'Publié.' : extra.published === false ? 'Repassé en brouillon.' : 'Enregistré.' });
      onSaved();
      if (!g) onClose();
    } catch (x) { setMsg({ ok: false, text: (x as ApiError).message }); }
  }
  async function remove() {
    if (!g || !confirm(`Supprimer définitivement « ${g.title} » ?`)) return;
    try { await api(`/agence/guides/${g.id}`, { method: 'DELETE' }); onSaved(); onClose(); } catch (x) { setMsg({ ok: false, text: (x as ApiError).message }); }
  }
  return (
    <div class="card section" style="border-color:var(--agency);display:flex;flex-direction:column;gap:10px">
      <span class="label" style="color:var(--agency)">{g ? 'Modifier le guide' : 'Nouveau guide'}</span>
      <input type="text" value={title} maxLength={120} placeholder="Titre" onInput={(e) => setTitle((e.target as HTMLInputElement).value)} aria-label="Titre" />
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center" class="small">
        <label>Pour{' '}
          <select class="client-select" style="width:auto;display:inline-block" value={clientId} onChange={(e) => setClientId((e.target as HTMLSelectElement).value)}>
            <option value="">Tous les clients</option>
            {me.clients.map((c) => <option value={c.id}>{c.name} (épinglé)</option>)}
          </select>
        </label>
        <label>Ordre <input type="number" value={sortOrder} style="width:70px" onInput={(e) => setSortOrder(Number((e.target as HTMLInputElement).value))} /></label>
        <input type="url" value={url} placeholder="Lien vidéo ou PDF (facultatif)" style="flex:1;min-width:220px" onInput={(e) => setUrl((e.target as HTMLInputElement).value)} aria-label="Lien" />
      </div>
      {g && <PdfControls g={g} onChange={onSaved} />}
      <div style="display:flex;gap:6px">
        <button class={preview ? 'ghost-btn' : 'btn'} onClick={() => setPreview(false)}>Rédiger</button>
        <button class={preview ? 'btn' : 'ghost-btn'} onClick={() => setPreview(true)}>Aperçu</button>
      </div>
      {preview
        ? <article class="card md-content guide" dangerouslySetInnerHTML={{ __html: renderMarkdown(body || '_Vide_') }} />
        : <textarea rows={22} value={body} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} aria-label="Contenu"
            style="font-family:var(--font-mono);font-size:13px" placeholder={'## Étape 1 — ...\n1. Ouvrez ...\n\n![Capture](https://...)'} />}
      <p class="small muted" style="margin:0">Mise en forme : « ## » pour un titre, « 1. » pour une étape, « - » pour une liste, **gras**, [lien](https://…), ![capture](https://…) pour une image hébergée (Drive public, Imgur…), et sur une ligne seule @[titre](lien) pour intégrer une vidéo Tella, Loom, YouTube ou Vimeo.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn" disabled={!title.trim()} onClick={() => save()}>Enregistrer</button>
        {g && (g.published
          ? <button class="ghost-btn" onClick={() => save({ published: false })}>Repasser en brouillon</button>
          : <button class="btn" onClick={() => { if (confirm(`Publier « ${title} » ? Il sera visible par ${clientId ? 'ce client' : 'tous les clients'}.`)) save({ published: true }); }}>Publier…</button>)}
        <button class="ghost-btn" onClick={onClose}>Fermer</button>
        {g && <button class="ghost-btn" onClick={remove}>Supprimer</button>}
        {msg && <span class="small" style={{ color: msg.ok ? 'var(--accent)' : 'var(--alert)' }}>{msg.text}</span>}
      </div>
    </div>
  );
}

function PdfControls({ g, onChange, compact }: { g: AgencyGuide; onChange: () => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.type !== 'application/pdf') { setMsg({ ok: false, text: 'Choisissez un fichier PDF.' }); return; }
    setBusy(true); setMsg({ ok: true, text: 'Envoi du PDF…' });
    try {
      await api(`/agence/guides/${g.id}/file`, { method: 'PUT', body: file, headers: { 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent(file.name).slice(0, 100) } });
      setMsg({ ok: true, text: 'PDF joint.' }); onChange();
    } catch (x) { setMsg({ ok: false, text: (x as ApiError).message }); } finally { setBusy(false); }
  }
  async function remove() {
    if (!confirm('Retirer le PDF de ce guide ?')) return;
    try { await api(`/agence/guides/${g.id}/file`, { method: 'DELETE' }); setMsg({ ok: true, text: 'PDF retiré.' }); onChange(); } catch (x) { setMsg({ ok: false, text: (x as ApiError).message }); }
  }
  return (
    <div class="small" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      {!compact && <span class="label">PDF</span>}
      {!compact && (g.hasFile ? <span>Un PDF est joint.</span> : <span class="muted">Aucun PDF joint.</span>)}
      <label class={g.hasFile ? 'ghost-btn' : 'btn'} style="cursor:pointer">{g.hasFile ? 'Remplacer le PDF' : 'Joindre un PDF'}
        <input type="file" accept="application/pdf" style="display:none" disabled={busy} onChange={(e) => upload((e.target as HTMLInputElement).files?.[0])} />
      </label>
      {g.hasFile && !compact && <button class="ghost-btn" onClick={remove}>Retirer le PDF</button>}
      {msg && <span style={{ color: msg.ok ? 'var(--accent)' : 'var(--alert)' }}>{msg.text}</span>}
    </div>
  );
}
