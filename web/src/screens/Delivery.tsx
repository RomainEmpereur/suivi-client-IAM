import { useState } from 'preact/hooks';
import { formatDate } from '@obsidian/domain';
import { ApiError, api, useApi } from '../api.ts';
import { AgencyNote, ErrorBox, Loading, PageHead, Pill } from '../components/ui.tsx';

interface Step {
  key: string; label: string; recurring: boolean; needsMechanism: boolean; deliverable: string | null;
  status: 'a_faire' | 'en_cours' | 'a_valider' | 'valide'; resultUrl: string | null; notes: string | null;
  validatedAt: string | null; available: boolean; lockedReason: string | null;
}
interface DeliveryData { gate: { ok: boolean; missing: string[] }; mechanism: string | null; driveFolderUrl: string | null; steps: Step[] }

const STATUS_LABEL: Record<Step['status'], [string, string]> = {
  a_faire: ['À faire', 'neutral'], en_cours: ['En cours', 'surveiller'], a_valider: ['À valider', 'surveiller'], valide: ['Validé', 'ok'],
};

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/**
 * Delivery (agence uniquement) : l'espace enchaîne les étapes du master prompt et prépare le brief
 * à coller dans le projet Claude de delivery. La rédaction se fait dans Claude ; ici, on suit et on valide.
 */
export function DeliveryScreen({ clientId }: { clientId: string }) {
  const { data, error, loading, reload } = useApi<DeliveryData>(`/clients/${clientId}/delivery`);
  const [promptMsg, setPromptMsg] = useState<string | null>(null);

  async function copyMasterPrompt() {
    try {
      const r = await api<{ text: string }>('/delivery/master-prompt');
      setPromptMsg(await copy(r.text) ? 'Master prompt copié : collez-le dans les instructions du projet Claude.' : 'Copie impossible depuis ce navigateur.');
    } catch (e) { setPromptMsg((e as Error).message); }
  }

  return (
    <>
      <PageHead a="Delivery" b="du client"
        sub="Les étapes 0 à 8 du master prompt, dans l'ordre. Pour chaque étape : copiez le brief, collez-le dans le projet Claude de delivery, puis renseignez ici le lien du document et validez."
        right={<button class="ghost-btn" onClick={copyMasterPrompt}>Copier le master prompt</button>} />
      {promptMsg && <div class="banner accent" role="status"><span>{promptMsg}</span></div>}
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading />}
      {data && (
        <>
          {!data.gate.ok ? (
            <div class="banner warn" role="status">
              <span><strong>Delivery pas encore lançable.</strong> Il faut le formulaire d'onboarding envoyé et les infos de base. Manque : {data.gate.missing.join(' · ')}.
                {' '}<a href={`/c/${clientId}/onboarding`}>Voir l'onboarding →</a></span>
            </div>
          ) : (
            <div class="banner accent" role="status">
              <span><strong>Conditions de lancement remplies.</strong>{' '}
                {data.driveFolderUrl
                  ? <>Ressources : <a href={data.driveFolderUrl} target="_blank" rel="noopener noreferrer">dossier Drive du client</a>.</>
                  : <>Pas de dossier de ressources : on avance sans, le brief le précise.</>}
                {data.mechanism && <> Mécanisme choisi : <strong>{data.mechanism}</strong>.</>}</span>
            </div>
          )}
          <div style="display:flex;flex-direction:column;gap:12px">
            {data.steps.map((s) => <StepCard clientId={clientId} step={s} mechanism={data.mechanism} onChange={reload} />)}
          </div>
          <AgencyNote>écran réservé à l'agence. Une pièce client validée crée une fiche livrable non publiée ; le client ne la voit qu'après « Publier au client ».</AgencyNote>
        </>
      )}
    </>
  );
}

function StepCard({ clientId, step, mechanism, onChange }: { clientId: string; step: Step; mechanism: string | null; onChange: () => void }) {
  const [url, setUrl] = useState(step.resultUrl ?? '');
  const [notes, setNotes] = useState(step.notes ?? '');
  const [mech, setMech] = useState(mechanism ?? '');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, kind] = STATUS_LABEL[step.status];
  const locked = !step.available && step.status === 'a_faire';

  async function save(extra: Record<string, unknown> = {}) {
    setBusy(true); setMsg(null);
    try {
      const body: Record<string, unknown> = { resultUrl: url.trim() || null, notes: notes.trim() || null, ...extra };
      if (step.key === 's1c') body.mechanism = mech.trim() || null;
      await api(`/clients/${clientId}/delivery/${step.key}`, { method: 'PATCH', body: JSON.stringify(body) });
      setMsg({ kind: 'ok', text: 'Enregistré.' });
      onChange();
    } catch (e) { setMsg({ kind: 'err', text: (e as ApiError).message }); }
    finally { setBusy(false); }
  }

  async function copyBrief() {
    setMsg(null);
    try {
      const r = await api<{ text: string }>(`/clients/${clientId}/delivery/${step.key}/brief`);
      const ok = await copy(r.text);
      setMsg(ok ? { kind: 'ok', text: 'Brief copié : collez-le dans une conversation du projet Claude.' } : { kind: 'err', text: 'Copie impossible depuis ce navigateur.' });
      if (ok && step.status === 'a_faire') await save({ status: 'en_cours' });
    } catch (e) { setMsg({ kind: 'err', text: (e as ApiError).message }); }
  }

  async function publish() {
    setMsg(null);
    try {
      await api(`/clients/${clientId}/delivery/${step.key}/publish`, { method: 'POST' });
      setMsg({ kind: 'ok', text: 'Publié : le client voit la pièce « à relire ».' });
    } catch (e) { setMsg({ kind: 'err', text: (e as ApiError).message }); }
  }

  return (
    <section class="card" style={`display:flex;flex-direction:column;gap:10px;${locked ? 'opacity:.6' : ''}`} aria-label={step.label}>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <strong>{step.label}</strong>
        <span style="display:flex;gap:6px;align-items:center">
          {step.deliverable && <span class="small muted">Pièce client : {step.deliverable}</span>}
          {!step.recurring && <Pill kind={kind}>{label}{step.validatedAt ? ` · ${formatDate(step.validatedAt)}` : ''}</Pill>}
          {step.recurring && <Pill kind="neutral">Chaque semaine</Pill>}
        </span>
      </div>
      {locked ? (
        <div class="small muted">{step.lockedReason}</div>
      ) : (
        <>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" onClick={copyBrief} disabled={busy || !step.available}>Copier le brief</button>
            {!step.available && <span class="small" style="color:var(--warn)">{step.lockedReason}</span>}
          </div>
          {step.key === 's1c' && (
            <label class="small" style="display:flex;flex-direction:column;gap:4px">
              Nom du mécanisme choisi par le client (verrouille la suite)
              <input type="text" value={mech} maxLength={120} onInput={(e) => setMech((e.target as HTMLInputElement).value)} placeholder="Un des trois noms proposés sur la page client" />
            </label>
          )}
          {!step.recurring && (
            <label class="small" style="display:flex;flex-direction:column;gap:4px">
              Lien du document produit
              <input type="url" value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} placeholder="https://docs.google.com/…" />
            </label>
          )}
          <label class="small" style="display:flex;flex-direction:column;gap:4px">
            Notes internes {step.recurring ? '(constats de la semaine)' : ''}
            <textarea rows={2} value={notes} onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)} />
          </label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <button class="ghost-btn" disabled={busy} onClick={() => save()}>Enregistrer</button>
            {!step.recurring && step.status !== 'a_valider' && step.status !== 'valide' && (
              <button class="ghost-btn" disabled={busy} onClick={() => save({ status: 'a_valider' })}>Soumettre à validation</button>
            )}
            {!step.recurring && step.status !== 'valide' && (
              <button class="btn" disabled={busy || !url.trim()} onClick={() => save({ status: 'valide' })}>Valider l'étape</button>
            )}
            {step.status === 'valide' && (
              <button class="ghost-btn" disabled={busy} onClick={() => save({ status: 'a_valider' })}>Rouvrir</button>
            )}
            {step.status === 'valide' && step.deliverable && (
              <button class="ghost-btn" onClick={publish}>Publier au client</button>
            )}
            {step.resultUrl && <a class="small" href={step.resultUrl} target="_blank" rel="noopener noreferrer">Ouvrir le document →</a>}
          </div>
        </>
      )}
      {msg && <div class="small" role="status" style={`color:var(--${msg.kind === 'ok' ? 'accent' : 'alert'})`}>{msg.text}</div>}
    </section>
  );
}
