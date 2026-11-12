import { useState } from 'preact/hooks';
import { formatDate } from '@obsidian/domain';
import { api, openFile, useApi } from '../api.ts';
import { useSession } from '../session.ts';

interface Resource {
  id: string; type: string; description: string | null; createdAt: string; createdBy: string;
  fileName: string | null; contentType: string | null; size: number | null; url: string | null; isFile: boolean;
}

export const RESOURCE_TYPES: { value: string; label: string; hint: string }[] = [
  { value: 'logo', label: 'Logo', hint: 'PNG ou PDF, fond transparent si possible' },
  { value: 'charte', label: 'Charte graphique', hint: 'Couleurs, polices, règles' },
  { value: 'captures_produit', label: 'Captures du produit', hint: 'Tableau de bord, écrans clés' },
  { value: 'temoignage', label: 'Témoignage client', hint: 'Vidéo, capture d\'avis, cas chiffré' },
  { value: 'enregistrement', label: 'Enregistrement', hint: 'Démo, appel, vidéo du fondateur' },
  { value: 'acces_site', label: 'Accès au site', hint: 'Lien vers les accès partagés (jamais un mot de passe en clair)' },
  { value: 'autre', label: 'Autre', hint: '' },
];
const LABEL = Object.fromEntries(RESOURCE_TYPES.map((t) => [t.value, t.label]));
const MAX_MB = 50;
const fmtSize = (n: number | null) => (n == null ? '' : n > 1_048_576 ? `${(n / 1_048_576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

/** Ressources d'onboarding (décision 0020) : fichiers déposés dans l'espace ou liens. */
export function ResourcesPanel({ clientId }: { clientId: string }) {
  const { data, error, reload } = useApi<{ resources: Resource[] }>(`/clients/${clientId}/resources`);
  const { me, view } = useSession();
  const canWrite = me.user.role === 'client' || view === 'agence';
  const [type, setType] = useState('logo');
  const [description, setDescription] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setErr(null);
    for (const file of Array.from(files)) {
      if (file.size > MAX_MB * 1_048_576) { setErr(`${file.name} : ${MAX_MB} Mo au plus. Déposez-le dans le dossier Drive et collez le lien.`); continue; }
      setBusy(`Envoi de ${file.name}…`);
      try {
        const q = new URLSearchParams({ type, ...(description ? { description } : {}) });
        await api(`/clients/${clientId}/resources/file?${q}`, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) } });
      } catch (x) { setErr(`${file.name} : ${(x as Error).message}`); }
    }
    setBusy(null); setDescription(''); reload();
  }
  async function addLink(e: Event) {
    e.preventDefault();
    setErr(null); setBusy('Ajout du lien…');
    try {
      await api(`/clients/${clientId}/resources/link`, { method: 'POST', body: JSON.stringify({ type, url: link, description: description || null }) });
      setLink(''); setDescription(''); reload();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(null); }
  }
  async function remove(r: Resource) {
    if (!confirm(`Supprimer « ${r.fileName ?? r.url} » ?`)) return;
    try { await api(`/clients/${clientId}/resources/${r.id}`, { method: 'DELETE' }); reload(); } catch (x) { setErr((x as Error).message); }
  }
  const open = (r: Resource) => (r.isFile ? openFile(r.url!.replace(/^\/api/, '')).catch((x) => setErr((x as Error).message)) : window.open(r.url!, '_blank', 'noopener'));
  const hint = RESOURCE_TYPES.find((t) => t.value === type)?.hint;

  return (
    <section id="ressources" class="section card">
      <h2 class="section-title">Vos ressources</h2>
      <p class="small muted" style="margin:0 0 12px">Logo, captures du produit, témoignages, vidéos : déposez-les ici (images, PDF, vidéos, {MAX_MB} Mo par fichier) ou collez un lien Drive, Dropbox ou Loom. Elles servent à écrire et illustrer votre landing, votre VSL et vos publicités.</p>
      {error && <div class="banner alert" role="alert">{error.message}</div>}
      {err && <div class="banner alert" role="alert">{err}</div>}
      {canWrite && (
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px">
          <div class="form-grid">
            <label class="field">Type<select value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value)}>{RESOURCE_TYPES.map((t) => <option value={t.value}>{t.label}</option>)}</select>
              {hint && <span class="hint">{hint}</span>}</label>
            <label class="field">Précision (facultatif)<input maxLength={300} value={description} placeholder="Ex. logo version claire" onInput={(e) => setDescription((e.target as HTMLInputElement).value)} /></label>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
            <label class="btn" style="cursor:pointer">Déposer des fichiers
              <input type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,video/mp4,video/quicktime,audio/mpeg" style="display:none"
                onChange={(e) => { const t = e.target as HTMLInputElement; upload(t.files); t.value = ''; }} disabled={Boolean(busy)} />
            </label>
            <form onSubmit={addLink} style="display:flex;gap:8px;flex:1;min-width:240px">
              <input class="input" type="url" required placeholder="ou collez un lien https://…" value={link} onInput={(e) => setLink((e.target as HTMLInputElement).value)}
                style="flex:1;background:var(--surface-2);border:1px solid var(--border);border-radius:7px;padding:7px 10px" />
              <button class="ghost-btn" type="submit" disabled={Boolean(busy)}>Ajouter le lien</button>
            </form>
          </div>
          {busy && <span class="small muted" role="status">{busy}</span>}
        </div>
      )}
      {data && data.resources.length === 0 && <p class="small muted" style="margin:0">Aucune ressource pour le moment.</p>}
      {data && data.resources.length > 0 && (
        <ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px">
          {data.resources.map((r) => (
            <li style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 10px;border:1px solid var(--border);border-radius:8px">
              <span class="label" style="min-width:150px">{LABEL[r.type] ?? r.type}</span>
              <button class="ghost-btn" style="border:none;padding:0;color:var(--accent);text-align:left" onClick={() => open(r)}>{r.fileName ?? r.url} ↗</button>
              {r.description && <span class="small muted">{r.description}</span>}
              <span class="mono small muted" style="margin-left:auto">{fmtSize(r.size)}{r.size ? ' · ' : ''}{formatDate(r.createdAt)}{r.createdBy === 'agence' ? ' · agence' : ''}</span>
              {canWrite && (view === 'agence' || r.createdBy === 'client') && <button class="ghost-btn small" onClick={() => remove(r)}>Supprimer</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
