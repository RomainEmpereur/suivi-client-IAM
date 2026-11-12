import { useState } from 'preact/hooks';
import { formatDate, formatDateTime } from '@obsidian/domain';
import { ApiError, api, useApi } from '../api.ts';
import { AgencyNote, ErrorBox, Loading, PageHead, Pill } from '../components/ui.tsx';
import { renderMarkdown } from '../markdown.ts';

interface Step {
  key: string; label: string; recurring: boolean; needsMechanism: boolean; deliverable: string | null;
  status: 'a_faire' | 'en_cours' | 'a_valider' | 'valide'; resultUrl: string | null; notes: string | null; validatedAt: string | null;
  contentMd: string | null; contentVersion: number; contentSource: 'claude' | 'agence' | null; generatedAt: string | null;
  queued: boolean; queuedAt: string | null; instruction: string | null; stale: boolean; lastError: string | null;
  available: boolean; lockedReason: string | null; validationBlocker: string | null;
}
interface DeliveryData {
  gate: { ok: boolean; missing: string[] }; mechanism: string | null; driveFolderUrl: string | null;
  generationConfigured: boolean; steps: Step[];
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function statusPill(s: Step) {
  if (s.queued) return <Pill kind="info">En rédaction</Pill>;
  if (s.stale) return <Pill kind="corriger">À revoir</Pill>;
  if (s.recurring) return <Pill kind="neutral">Chaque semaine</Pill>;
  if (s.status === 'valide') return <Pill kind="ok">Validé{s.validatedAt ? ` · ${formatDate(s.validatedAt)}` : ''}</Pill>;
  if (s.status === 'a_valider') return <Pill kind="surveiller">À relire</Pill>;
  return <Pill kind="neutral">À faire</Pill>;
}

/**
 * Delivery (agence) : après l'onboarding, « Lancer le delivery » met les étapes 0 à 7 en file ; Claude les rédige
 * (tâche planifiée Claude Code) et les dépose ici. On relit, on modifie, on reprend avec une consigne, on valide :
 * une pièce client validée est publiée aussitôt dans l'espace du client.
 */
export function DeliveryScreen({ clientId }: { clientId: string }) {
  const { data, error, loading, reload } = useApi<DeliveryData>(`/clients/${clientId}/delivery`);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function post(path: string, ok: (r: { queued: number }) => string) {
    setMsg(null);
    try { const r = await api<{ queued: number }>(path, { method: 'POST' }); setMsg({ kind: 'ok', text: ok(r) }); reload(); }
    catch (e) { setMsg({ kind: 'err', text: (e as ApiError).message }); }
  }
  async function copyMasterPrompt() {
    try {
      const r = await api<{ text: string }>('/delivery/master-prompt');
      setMsg(await copy(r.text) ? { kind: 'ok', text: 'Master prompt copié.' } : { kind: 'err', text: 'Copie impossible depuis ce navigateur.' });
    } catch (e) { setMsg({ kind: 'err', text: (e as Error).message }); }
  }

  const chain = data?.steps.filter((s) => !s.recurring) ?? [];
  const toLaunch = chain.filter((s) => !s.contentMd && !s.resultUrl && !s.queued).length;
  const queued = data?.steps.filter((s) => s.queued).length ?? 0;
  const stale = data?.steps.filter((s) => s.stale && !s.queued).length ?? 0;
  const done = chain.filter((s) => s.status === 'valide').length;

  return (
    <>
      <PageHead a="Delivery" b="du client"
        sub="Après l'onboarding, lancez le delivery : Claude rédige toute la chaîne du master prompt (recherche, offre, VSL, landing, ads, séquences, formulaire, campagne). Vous relisez chaque pièce, la modifiez ou la faites reprendre, puis la validez : le client la voit aussitôt dans son espace."
        right={<button class="ghost-btn" onClick={copyMasterPrompt}>Copier le master prompt</button>} />
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading />}
      {msg && <div class={`banner ${msg.kind === 'ok' ? 'accent' : 'alert'}`} role="status"><span>{msg.text}</span></div>}
      {data && (
        <>
          {!data.gate.ok ? (
            <div class="banner warn" role="status">
              <span><strong>Delivery pas encore lançable.</strong> Il faut le formulaire d'onboarding envoyé et les infos de base. Manque : {data.gate.missing.join(' · ')}.
                {' '}<a href={`/c/${clientId}/onboarding`}>Voir l'onboarding →</a></span>
            </div>
          ) : (
            <div class="card section" style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between">
              <div class="small" style="display:flex;flex-direction:column;gap:4px">
                <span><strong>{done}/{chain.length}</strong> pièces validées{queued ? <> · <strong>{queued}</strong> en rédaction</> : null}{stale ? <> · <strong style="color:var(--alert)">{stale}</strong> à revoir</> : null}</span>
                <span class="muted">
                  {data.mechanism ? <>Mécanisme retenu : <strong>{data.mechanism}</strong> · </> : null}
                  {data.driveFolderUrl
                    ? <a href={data.driveFolderUrl} target="_blank" rel="noopener noreferrer">Ressources : dossier Drive ↗</a>
                    : 'Pas de dossier de ressources : Claude avance sans.'}
                </span>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                {stale > 0 && <button class="ghost-btn" onClick={() => post(`/clients/${clientId}/delivery/regenerate-stale`, (r) => `${r.queued} pièce(s) remises en rédaction.`)}>Refaire les pièces à revoir</button>}
                {toLaunch > 0 && <button class="btn" onClick={() => post(`/clients/${clientId}/delivery/launch`, (r) => `${r.queued} étape(s) en file de rédaction. Claude les rédige au prochain passage.`)}>Lancer le delivery</button>}
              </div>
            </div>
          )}
          {data.gate.ok && !data.generationConfigured && (
            <div class="banner warn" role="status"><span>La rédaction automatique n'est pas encore branchée sur cet environnement : les étapes en file attendront. Vous pouvez toujours copier le brief d'une étape et la rédiger dans le projet Claude.</span></div>
          )}
          <div style="display:flex;flex-direction:column;gap:12px">
            {data.steps.map((s) => <StepCard key={s.key} clientId={clientId} step={s} mechanism={data.mechanism} onChange={reload} />)}
          </div>
          <AgencyNote>écran réservé à l'agence. Claude ne valide et ne publie jamais rien : seule votre validation publie une pièce client (1C, puis 2 à 7) dans l'espace du client. Les étapes 0, 1A et 1B restent internes.</AgencyNote>
        </>
      )}
    </>
  );
}

function StepCard({ clientId, step, mechanism, onChange }: { clientId: string; step: Step; mechanism: string | null; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(step.contentMd ?? '');
  const [mech, setMech] = useState(mechanism ?? '');
  const [instruction, setInstruction] = useState('');
  const [askRedo, setAskRedo] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = !step.available;
  const hasText = Boolean(step.contentMd);

  async function patch(body: Record<string, unknown>, ok: string) {
    setBusy(true); setMsg(null);
    try {
      await api(`/clients/${clientId}/delivery/${step.key}`, { method: 'PATCH', body: JSON.stringify(body) });
      setMsg({ kind: 'ok', text: ok }); setEditing(false); setAskRedo(false); setInstruction('');
      onChange();
    } catch (e) { setMsg({ kind: 'err', text: (e as ApiError).message }); }
    finally { setBusy(false); }
  }
  async function copyBrief() {
    setMsg(null);
    try {
      const r = await api<{ text: string }>(`/clients/${clientId}/delivery/${step.key}/brief`);
      setMsg(await copy(r.text) ? { kind: 'ok', text: 'Brief copié (rédaction manuelle dans le projet Claude).' } : { kind: 'err', text: 'Copie impossible depuis ce navigateur.' });
    } catch (e) { setMsg({ kind: 'err', text: (e as ApiError).message }); }
  }

  return (
    <section class="card" style={`display:flex;flex-direction:column;gap:10px;${locked ? 'opacity:.6' : ''}`} aria-label={step.label}>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="display:flex;flex-direction:column;gap:2px">
          <strong>{step.label}</strong>
          <span class="small muted">
            {step.deliverable ? `Pièce client : ${step.deliverable}` : step.recurring ? 'Document interne, chaque semaine' : 'Document interne'}
            {step.contentVersion > 0 && <> · v{step.contentVersion} {step.contentSource === 'agence' ? 'modifiée par vous' : 'rédigée par Claude'}{step.generatedAt ? ` · ${formatDateTime(step.generatedAt)}` : ''}</>}
          </span>
        </div>
        {statusPill(step)}
      </div>

      {locked && <div class="small muted">{step.lockedReason}</div>}
      {!locked && (
        <>
          {step.queued && (
            <div class="small" style="color:var(--accent)">
              En file de rédaction depuis le {formatDateTime(step.queuedAt)}{step.instruction ? <> · consigne : « {step.instruction} »</> : null}. Claude la rédige au prochain passage.
            </div>
          )}
          {step.lastError && !step.queued && <div class="small" style="color:var(--alert)">Dernière rédaction en échec : {step.lastError}</div>}
          {step.stale && !step.queued && (
            <div class="banner warn" style="margin:0"><span>Une étape en amont a changé (offre ou mécanisme) : cette pièce n'est peut-être plus alignée.</span>
              <span style="display:flex;gap:6px">
                <button class="ghost-btn" disabled={busy} onClick={() => patch({ regenerate: true }, 'Remise en rédaction.')}>Refaire</button>
                <button class="ghost-btn" disabled={busy} onClick={() => patch({ stale: false }, 'Gardée telle quelle.')}>Garder tel quel</button>
              </span>
            </div>
          )}

          {step.key === 's1c' && (
            <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
              <label class="small" style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:220px">
                Nom du mécanisme retenu (Claude propose, vous pouvez le changer)
                <input type="text" value={mech} maxLength={120} onInput={(e) => setMech((e.target as HTMLInputElement).value)} placeholder="Fixé par Claude à la rédaction de la page client" />
              </label>
              {mech.trim() !== (mechanism ?? '') && (
                <button class="ghost-btn" disabled={busy} onClick={() => patch({ mechanism: mech.trim() || null }, 'Mécanisme mis à jour : les pièces qui le citent passent à revoir.')}>Enregistrer le nom</button>
              )}
            </div>
          )}

          {hasText && !editing && (
            <>
              <button class="ghost-btn" style="align-self:flex-start" onClick={() => setOpen(!open)}>{open ? 'Replier' : 'Lire la pièce'}</button>
              {open && <div class="md-content card" style="max-height:640px;overflow:auto" dangerouslySetInnerHTML={{ __html: renderMarkdown(step.contentMd!) }} />}
            </>
          )}
          {editing && (
            <>
              <textarea rows={22} value={draft} onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)} aria-label={`Texte de ${step.label}`} style="font-family:var(--mono, monospace);font-size:13px" />
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button class="btn" disabled={busy || !draft.trim()} onClick={() => patch({ contentMd: draft }, 'Modification enregistrée (nouvelle version).')}>Enregistrer</button>
                <button class="ghost-btn" onClick={() => { setEditing(false); setDraft(step.contentMd ?? ''); }}>Annuler</button>
              </div>
            </>
          )}
          {askRedo && (
            <div style="display:flex;flex-direction:column;gap:6px">
              <textarea rows={3} value={instruction} placeholder="Consigne pour Claude (ex. : hooks plus courts, ton plus direct, ajouter le cas client chiffré)"
                onInput={(e) => setInstruction((e.target as HTMLTextAreaElement).value)} aria-label="Consigne de reprise" />
              <div style="display:flex;gap:8px">
                <button class="btn" disabled={busy} onClick={() => patch({ regenerate: true, instruction }, 'Reprise demandée : Claude la rédige au prochain passage.')}>{hasText ? 'Faire reprendre' : 'Faire rédiger'}</button>
                <button class="ghost-btn" onClick={() => setAskRedo(false)}>Annuler</button>
              </div>
            </div>
          )}

          {!editing && !askRedo && (
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              {!step.recurring && step.status !== 'valide' && hasText && !step.queued && (
                <button class="btn" disabled={busy || Boolean(step.validationBlocker)} title={step.validationBlocker ?? undefined}
                  onClick={() => patch({ status: 'valide' }, step.deliverable ? 'Validée et publiée dans l’espace du client.' : 'Validée.')}>
                  {step.deliverable ? 'Valider et publier au client' : 'Valider'}
                </button>
              )}
              {hasText && <button class="ghost-btn" disabled={busy} onClick={() => { setDraft(step.contentMd ?? ''); setEditing(true); setOpen(false); }}>Modifier</button>}
              {!step.queued && (step.recurring || hasText || step.lastError) && (
                <button class="ghost-btn" disabled={busy} onClick={() => setAskRedo(true)}>{step.recurring ? 'Préparer le point de la semaine' : 'Faire reprendre par Claude'}</button>
              )}
              {step.status === 'valide' && !step.recurring && (
                <button class="ghost-btn" disabled={busy} onClick={() => patch({ status: 'a_valider' }, 'Rouverte. Le client garde la version publiée jusqu’à la prochaine validation.')}>Rouvrir</button>
              )}
              <button class="ghost-btn" onClick={copyBrief}>Copier le brief</button>
              {step.status !== 'valide' && hasText && step.validationBlocker && <span class="small" style="color:var(--warn)">{step.validationBlocker}</span>}
            </div>
          )}
        </>
      )}
      {msg && <div class="small" role="status" style={`color:var(--${msg.kind === 'ok' ? 'accent' : 'alert'})`}>{msg.text}</div>}
    </section>
  );
}
