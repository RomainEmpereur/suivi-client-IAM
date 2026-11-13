import { useState } from 'preact/hooks';
import {
  OPTIMISATION_STATUS_LABEL, OPTIMISATION_VERDICT_LABEL, OPTIMISATION_WINDOW_DAYS, formatDate, formatEuros, formatInt, formatPercent, todayParis,
} from '@obsidian/domain';
import { ApiError, api, useApi } from '../api.ts';
import { AgencyNote, EmptyState, ErrorBox, Loading, PageHead, Pill } from '../components/ui.tsx';
import { renderMarkdown } from '../markdown.ts';
import { useSession } from '../session.ts';

interface Piece {
  step: string; label: string; purpose: string; status: 'a_rediger' | 'en_file' | 'a_relire' | 'validee'; contentMd: string | null; contentVersion: number;
  contentSource: string | null; queued: boolean; lastError: string | null; instruction: string | null; generatedAt: string | null; validatedAt: string | null;
}
interface Metric { key: string; label: string; unit: 'euros' | 'int' | 'percent'; before: number | null; after: number | null; delta: number | null; better: boolean | null }
interface Opt {
  id: string; title: string; constat: string; hypothese: string; consigne: string | null; source: string; status: string;
  launchedOn: string | null; verdict: string | null; verdictNote: string | null; verdictAt: string | null; createdAt: string;
  vertical: { id: string; name: string } | null; visibleClient: boolean; pieces: Piece[];
  measure: null | {
    before: { from: string; to: string; syncedDays: number }; after: { from: string; to: string; syncedDays: number } | null;
    elapsedDays: number; complete: boolean; completeOn: string; metrics: Metric[];
  };
}
interface Data {
  items: Opt[]; steps: { key: string; label: string; purpose: string }[]; verticals: { id: string; name: string }[];
  available: Record<string, string[]> | null; generationConfigured: boolean;
}

const STATUS_KIND: Record<string, string> = { en_preparation: 'neutral', prete: 'info', en_ligne: 'surveiller', terminee: 'ok', abandonnee: 'neutral' };
const PIECE_STATUS: Record<Piece['status'], [string, string]> = {
  a_rediger: ['neutral', 'À rédiger'], en_file: ['info', 'En rédaction'], a_relire: ['surveiller', 'À relire'], validee: ['ok', 'Validée'],
};

/**
 * Optimisations (décision 0025) : quand les résultats ne suivent pas, on reprend une ou plusieurs pièces (nouvelle vague d'ads,
 * formulaire, landing, séquences, structure), avec un constat et une hypothèse. Mesure 14 jours avant / après, puis verdict.
 * Agence : création, relecture, mise en ligne, verdict. Client : lecture, dès que les pièces sont validées.
 */
export function OptimisationsScreen({ clientId, search }: { clientId: string; search: string }) {
  const { view } = useSession();
  const { data, error, loading, reload } = useApi<Data>(`/clients/${clientId}/optimisations`, [view]);
  const agency = view === 'agence' && data?.available !== null && data?.available !== undefined;
  const params = new URLSearchParams(search);
  const [creating, setCreating] = useState(params.get('nouvelle') === '1');

  if (error) return <ErrorBox error={error} />;
  if (loading || !data) return <Loading />;
  const items = agency ? data.items : data.items.filter((o) => o.visibleClient);
  const active = items.filter((o) => o.status !== 'terminee' && o.status !== 'abandonnee');
  const closed = items.filter((o) => o.status === 'terminee' || o.status === 'abandonnee');

  return (
    <>
      <PageHead a="Optimisations" b="des campagnes"
        sub={agency
          ? "Quand les résultats ne suivent pas : un constat, une hypothèse, et Claude réécrit seulement les pièces visées. Vous relisez et validez (le client voit alors l'optimisation), indiquez la date de mise en ligne, puis l'espace compare 14 jours avant et 14 jours après pour décider : on garde ou on revient."
          : 'Les changements apportés à vos campagnes pour améliorer les résultats : ce que nous avons constaté, ce que nous testons, et ce que la mesure en dit, 14 jours avant contre 14 jours après.'}
        right={agency && !creating ? <button class="btn" onClick={() => setCreating(true)}>+ Nouvelle optimisation</button> : undefined} />

      {agency && creating && <CreateForm clientId={clientId} data={data} params={params} onDone={() => { setCreating(false); history.replaceState(null, '', `/c/${clientId}/optimisations`); reload(); }} />}

      {items.length === 0 && !creating && (
        <EmptyState title={agency ? 'Aucune optimisation pour ce client' : 'Aucune optimisation pour le moment'}>
          {agency ? "Créez-en une depuis ce bouton, ou depuis une recommandation d'analyse (« Créer une optimisation »)." : 'Elles apparaîtront ici dès qu’un changement sera prêt à être mis en ligne.'}
        </EmptyState>
      )}
      <div class="grid section" style="gap:14px">
        {active.map((o) => <OptCard key={o.id} clientId={clientId} o={o} agency={agency} onChange={reload} />)}
      </div>
      {closed.length > 0 && (
        <>
          <h2 class="section-title" style="margin-top:28px"><span>Terminées</span></h2>
          <div class="grid" style="gap:14px">{closed.map((o) => <OptCard key={o.id} clientId={clientId} o={o} agency={agency} onChange={reload} />)}</div>
        </>
      )}
      {agency && !data.generationConfigured && <AgencyNote>la rédaction automatique n'est pas branchée sur cet environnement : les pièces en file attendront.</AgencyNote>}
    </>
  );
}

function CreateForm({ clientId, data, params, onDone }: { clientId: string; data: Data; params: URLSearchParams; onDone: () => void }) {
  const [f, setF] = useState({ title: params.get('titre') ?? '', constat: params.get('constat') ?? '', hypothese: '', consigne: '', verticalId: '' });
  const [steps, setSteps] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const available = data.available?.[f.verticalId] ?? [];
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).value });
  async function submit(e: Event) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      await api(`/clients/${clientId}/optimisations`, { method: 'POST', body: JSON.stringify({
        ...f, verticalId: f.verticalId || undefined, steps, source: params.get('source') === 'analyse' ? 'analyse' : 'manuelle', sourceRef: params.get('ref') ?? undefined,
      }) });
      onDone();
    } catch (x) { setErr((x as ApiError).message); } finally { setBusy(false); }
  }
  return (
    <form class="card section" style="display:flex;flex-direction:column;gap:12px" onSubmit={submit}>
      <h2 class="section-title" style="margin:0"><span>Nouvelle optimisation</span></h2>
      <label class="field">Titre<input required maxLength={160} value={f.title} onInput={set('title')} placeholder="Ex. Nouvelle vague d'ads sur le coût du statu quo" /></label>
      <label class="field">Constat<textarea required rows={3} maxLength={3000} value={f.constat} onInput={set('constat')} placeholder="Ce que montrent les chiffres et les retours (avec les chiffres de l'espace)" /></label>
      <label class="field">Hypothèse à tester<textarea required rows={2} maxLength={2000} value={f.hypothese} onInput={set('hypothese')} placeholder="Si on change X, alors l'indicateur Y doit bouger, parce que…" /></label>
      <label class="field">Consigne pour Claude (facultatif)<textarea rows={2} maxLength={2000} value={f.consigne} onInput={set('consigne')} /></label>
      {data.verticals.length > 0 && (
        <label class="field">Chaîne visée
          <select value={f.verticalId} onChange={(e) => { setF({ ...f, verticalId: (e.target as HTMLSelectElement).value }); setSteps([]); }}>
            <option value="">Verticale principale</option>
            {data.verticals.map((v) => <option value={v.id}>Verticale · {v.name}</option>)}
          </select>
        </label>
      )}
      <fieldset class="field" style="border:0;padding:0;margin:0">
        <legend style="margin-bottom:6px">Pièces à reprendre</legend>
        {data.steps.map((s) => {
          const ok = available.includes(s.key);
          return (
            <label class="small" style={{ display: 'flex', gap: '8px', alignItems: 'center', opacity: ok ? 1 : 0.5 }}>
              <input type="checkbox" disabled={!ok} checked={steps.includes(s.key)}
                onChange={(e) => setSteps((e.target as HTMLInputElement).checked ? [...steps, s.key] : steps.filter((k) => k !== s.key))} />
              <span><strong>{s.purpose}</strong> <span class="muted">· {s.label}{ok ? '' : ' · pas encore rédigée dans le delivery'}</span></span>
            </label>
          );
        })}
      </fieldset>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn" disabled={busy || steps.length === 0}>Créer et faire rédiger par Claude</button>
        <button type="button" class="ghost-btn" onClick={onDone}>Annuler</button>
        {err && <span class="small" style="color:var(--alert)">{err}</span>}
      </div>
    </form>
  );
}

function fmt(m: Metric, v: number | null) {
  return m.unit === 'euros' ? formatEuros(v) : m.unit === 'percent' ? formatPercent(v) : formatInt(v);
}

function OptCard({ clientId, o, agency, onChange }: { clientId: string; o: Opt; agency: boolean; onChange: () => void }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [launchOn, setLaunchOn] = useState(o.launchedOn ?? todayParis());
  const [note, setNote] = useState('');
  async function patch(body: Record<string, unknown>, ok: string) {
    setMsg(null);
    try { await api(`/clients/${clientId}/optimisations/${o.id}`, { method: 'PATCH', body: JSON.stringify(body) }); setMsg({ ok: true, text: ok }); onChange(); }
    catch (x) { setMsg({ ok: false, text: (x as ApiError).message }); }
  }
  const m = o.measure;
  return (
    <article class="card" style="display:flex;flex-direction:column;gap:12px;min-width:0">
      <div class="kpi-row" style="flex-wrap:wrap;gap:8px">
        <Pill kind={STATUS_KIND[o.status] ?? 'neutral'}>{OPTIMISATION_STATUS_LABEL[o.status] ?? o.status}</Pill>
        {o.verdict && <Pill kind={o.verdict === 'garder' ? 'ok' : 'corriger'}>{OPTIMISATION_VERDICT_LABEL[o.verdict]}</Pill>}
        {o.vertical && <span class="mono small muted">Verticale · {o.vertical.name}</span>}
        <span class="mono small muted" style="margin-left:auto">
          {o.launchedOn ? `En ligne depuis le ${formatDate(o.launchedOn, { year: true })}` : `Créée le ${formatDate(o.createdAt, { year: true })}`}
          {agency && !o.visibleClient && o.status !== 'abandonnee' ? ' · pas encore visible du client' : ''}
        </span>
      </div>
      <h3 style="margin:0">{o.title}</h3>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:12px">
        <div><div class="label">Constat</div><p style="margin:4px 0 0;white-space:pre-line">{o.constat}</p></div>
        <div><div class="label">Hypothèse testée</div><p style="margin:4px 0 0;white-space:pre-line">{o.hypothese}</p></div>
      </div>
      {agency && o.consigne && <p class="small" style="margin:0;color:var(--agency)"><strong>Consigne pour Claude :</strong> {o.consigne}</p>}

      <div>
        <div class="label" style="margin-bottom:6px">Pièces reprises</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          {o.pieces.map((p) => <PieceRow key={p.step} clientId={clientId} o={o} p={p} agency={agency} onChange={onChange} />)}
        </div>
      </div>

      {agency && (o.status === 'prete' || o.status === 'en_ligne') && (
        <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap">
          <label class="field">Date de mise en ligne<input type="date" value={launchOn} onInput={(e) => setLaunchOn((e.target as HTMLInputElement).value)} /></label>
          <button class={o.status === 'prete' ? 'btn' : 'ghost-btn'} onClick={() => patch({ launchedOn: launchOn }, 'Date de mise en ligne enregistrée : la mesure démarre.')}>
            {o.status === 'prete' ? 'Indiquer la mise en ligne' : 'Corriger la date'}
          </button>
        </div>
      )}

      {m && (
        <div>
          <div class="label" style="margin-bottom:6px">
            Mesure · {OPTIMISATION_WINDOW_DAYS} jours avant contre {m.complete ? `${OPTIMISATION_WINDOW_DAYS} jours après` : `${m.elapsedDays} jour${m.elapsedDays > 1 ? 's' : ''} après sur ${OPTIMISATION_WINDOW_DAYS}`}
          </div>
          <p class="small muted" style="margin:0 0 6px">Avant : {formatDate(m.before.from)} → {formatDate(m.before.to)}{m.after ? ` · Après : ${formatDate(m.after.from)} → ${formatDate(m.after.to)}` : ' · Après : la mesure démarre demain'}</p>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Indicateur</th><th>Avant</th><th>Après</th><th>Variation</th></tr></thead>
              <tbody>
                {m.metrics.map((x) => (
                  <tr>
                    <td>{x.label}</td><td>{fmt(x, x.before)}</td><td>{m.after ? fmt(x, x.after) : '—'}</td>
                    <td style={{ color: x.better === null ? undefined : x.better ? 'var(--ok, var(--accent))' : 'var(--alert)' }}>
                      {x.delta === null ? '—' : `${x.delta > 0 ? '+' : ''}${formatPercent(x.delta)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p class="small muted" style="margin:6px 0 0">
            Chiffres de tout le compte (toutes campagnes), synchronisés par l'espace : {m.before.syncedDays} jour(s) mesuré(s) avant, {m.after?.syncedDays ?? 0} après.
            {!m.complete && ` Mesure complète le ${formatDate(m.completeOn, { year: true })}.`} Les volumes dépendent de la durée mesurée : seuls les coûts et le taux se comparent.
          </p>
        </div>
      )}

      {o.verdict && (
        <p style="margin:0"><strong>Décision{o.verdictAt ? ` du ${formatDate(o.verdictAt, { year: true })}` : ''} :</strong> {OPTIMISATION_VERDICT_LABEL[o.verdict]}.{o.verdictNote ? ` ${o.verdictNote}` : ''}</p>
      )}

      {agency && o.status === 'en_ligne' && (
        <div style="display:flex;flex-direction:column;gap:8px">
          <label class="field">Commentaire de décision (visible du client)<textarea rows={2} maxLength={2000} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} /></label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" onClick={() => { if (confirm("On garde ? Les pièces deviennent la version de référence du delivery et les livrables du client sont mis à jour.")) patch({ verdict: 'garder', verdictNote: note }, 'Gardée.'); }}>On garde</button>
            <button class="ghost-btn" onClick={() => { if (confirm('On revient à la version précédente ? Le delivery reste inchangé ; pensez à remettre en ligne l’ancienne version.')) patch({ verdict: 'revenir', verdictNote: note }, 'Retour à la version précédente noté.'); }}>On revient</button>
            {!m?.complete && <span class="small muted" style="align-self:center">La mesure n'est pas encore complète.</span>}
          </div>
        </div>
      )}

      {agency && o.status !== 'terminee' && o.status !== 'abandonnee' && (
        <div><button class="ghost-btn small" onClick={() => { if (confirm('Abandonner cette optimisation ?')) patch({ abandon: true }, 'Abandonnée.'); }}>Abandonner</button></div>
      )}
      {msg && <span class="small" style={{ color: msg.ok ? 'var(--accent)' : 'var(--alert)' }}>{msg.text}</span>}
    </article>
  );
}

function PieceRow({ clientId, o, p, agency, onChange }: { clientId: string; o: Opt; p: Piece; agency: boolean; onChange: () => void }) {
  const [mode, setMode] = useState<'' | 'edit' | 'rework'>('');
  const [content, setContent] = useState(p.contentMd ?? '');
  const [instruction, setInstruction] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const editable = agency && (o.status === 'en_preparation' || o.status === 'prete');
  async function patch(body: Record<string, unknown>) {
    setErr(null);
    try { await api(`/clients/${clientId}/optimisations/${o.id}/pieces/${p.step}`, { method: 'PATCH', body: JSON.stringify(body) }); setMode(''); onChange(); }
    catch (x) { setErr((x as ApiError).message); }
  }
  const [kind, label] = PIECE_STATUS[p.status];
  return (
    <details class="card" style="padding:10px 14px">
      <summary style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;cursor:pointer">
        <strong>{p.purpose}</strong><span class="muted small">· {p.label}</span>
        {agency && <span style="margin-left:auto"><Pill kind={kind}>{label}{p.contentVersion > 0 ? ` · v${p.contentVersion}` : ''}</Pill></span>}
      </summary>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
        {agency && p.lastError && <p class="small" style="color:var(--alert);margin:0">Échec de la rédaction : {p.lastError}</p>}
        {mode === 'edit'
          ? <textarea rows={16} value={content} onInput={(e) => setContent((e.target as HTMLTextAreaElement).value)} />
          : p.contentMd
            ? <div class="md-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(p.contentMd) }} />
            : <p class="small muted" style="margin:0">{p.queued ? 'Claude rédige cette pièce au prochain passage.' : 'Pas encore de texte.'}</p>}
        {mode === 'rework' && (
          <label class="field">Consigne de reprise<textarea rows={3} maxLength={2000} value={instruction} onInput={(e) => setInstruction((e.target as HTMLTextAreaElement).value)} /></label>
        )}
        {editable && (
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            {mode === '' && p.status === 'a_relire' && <button class="btn" onClick={() => patch({ status: 'validee' })}>Valider</button>}
            {mode === '' && p.status === 'validee' && <button class="ghost-btn" onClick={() => patch({ status: 'a_relire' })}>Retirer la validation</button>}
            {mode === '' && !p.queued && <button class="ghost-btn" onClick={() => { setContent(p.contentMd ?? ''); setMode('edit'); }}>Modifier</button>}
            {mode === '' && !p.queued && <button class="ghost-btn" onClick={() => setMode('rework')}>{p.contentMd ? 'Faire reprendre par Claude' : 'Faire rédiger par Claude'}</button>}
            {mode === 'edit' && <><button class="btn" onClick={() => patch({ contentMd: content })}>Enregistrer</button><button class="ghost-btn" onClick={() => setMode('')}>Annuler</button></>}
            {mode === 'rework' && <><button class="btn" onClick={() => patch({ regenerate: true, instruction })}>Envoyer à Claude</button><button class="ghost-btn" onClick={() => setMode('')}>Annuler</button></>}
            {err && <span class="small" style="color:var(--alert)">{err}</span>}
          </div>
        )}
      </div>
    </details>
  );
}
