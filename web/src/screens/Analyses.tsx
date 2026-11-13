import { useState } from 'preact/hooks';
import { addDaysYmd, formatDate, formatDateTime, todayParis } from '@obsidian/domain';
import { ApiError, api, useApi } from '../api.ts';
import { useSession } from '../session.ts';
import { AgencyNote, EmptyState, ErrorBox, Loading, Pill, SEVERITY_EDGE, SEVERITY_LABEL, SectionTitle } from '../components/ui.tsx';
import { renderMarkdown } from '../markdown.ts';

interface Reco {
  id: string; severity: string; title: string; body: string; state: string; stateChangedAt?: string | null;
  clientTitle?: string | null; clientBody?: string | null; internalNote?: string | null; published?: boolean;
}
interface Analysis {
  id: string; from: string; to: string; status?: string; requestedAt?: string; completedAt: string | null; error?: string | null;
  summary: string | null; clientSummary?: string | null; published?: boolean; publishedAt: string | null; recommendations: Reco[];
}

const STATE_LABEL: Record<string, string> = { ouverte: 'Ouverte', traitee: 'Traitée', ignoree: 'Ignorée' };

/**
 * Bloc 01 du Pilotage : analyse ponctuelle (décision 0011). L'agence lance l'analyse sur une période ;
 * Claude rédige synthèse et recommandations (au prochain passage de la session dédiée) ; l'agence relit et publie.
 */
export function AnalysesBlock({ clientId }: { clientId: string }) {
  const { me, view } = useSession();
  const agency = me.user.role === 'agence' && view === 'agence';
  const { data, error, loading, reload } = useApi<{ analyses: Analysis[] }>(`/clients/${clientId}/analyses`);
  const [selected, setSelected] = useState<string | null>(null);
  const list = data?.analyses ?? [];
  const pending = list.find((a) => a.status === 'en_attente' || a.status === 'en_cours');
  const done = list.filter((a) => (agency ? a.status === 'terminee' : true));
  const current = done.find((a) => a.id === selected) ?? done[0];

  return (
    <>
      <SectionTitle num="01" a="Analyse" b="et recommandations"
        right={current && <span class="mono small muted">{formatDate(current.from)} → {formatDate(current.to)}</span>} />
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading />}
      {agency && <LaunchForm clientId={clientId} pending={pending} onDone={reload} />}
      {agency && list.filter((a) => a.status === 'echec').slice(0, 1).map((a) => (
        <div class="banner alert" role="status"><span>Dernière analyse en échec ({formatDate(a.from)} → {formatDate(a.to)}) : {a.error}</span></div>
      ))}
      {data && !current && (
        <EmptyState title={agency ? 'Aucune analyse pour le moment' : 'Aucune analyse publiée'}>
          {agency ? 'Choisissez une période et lancez « Analyser mes campagnes ».' : 'L’analyse de vos campagnes apparaît ici une fois relue par Obsidian Partners.'}
        </EmptyState>
      )}
      {done.length > 1 && (
        <div class="small" style="margin-bottom:10px">
          <label class="muted">Analyses précédentes{' '}
            <select class="client-select" style="width:auto;display:inline-block" value={current?.id} onChange={(e) => setSelected((e.target as HTMLSelectElement).value)}>
              {done.map((a) => <option value={a.id}>{formatDate(a.from)} → {formatDate(a.to)}{agency ? (a.published ? ' · publiée' : ' · interne') : ''}</option>)}
            </select>
          </label>
        </div>
      )}
      {current && (agency ? <AgencyAnalysis clientId={clientId} a={current} onChange={reload} /> : <ClientAnalysis a={current} />)}
    </>
  );
}

function LaunchForm({ clientId, pending, onDone }: { clientId: string; pending?: Analysis; onDone: () => void }) {
  const yesterday = addDaysYmd(todayParis(), -1);
  const [from, setFrom] = useState(addDaysYmd(yesterday, -13));
  const [to, setTo] = useState(yesterday);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const preset = (days: number) => { setFrom(addDaysYmd(yesterday, -(days - 1))); setTo(yesterday); };
  async function launch(e: Event) {
    e.preventDefault(); setMsg(null);
    try {
      await api(`/clients/${clientId}/analyses`, { method: 'POST', body: JSON.stringify({ from, to }) });
      setMsg({ ok: true, text: 'Analyse demandée.' }); onDone();
    } catch (x) { setMsg({ ok: false, text: (x as ApiError).message }); }
  }
  async function cancel() {
    if (!pending) return;
    await api(`/clients/${clientId}/analyses/${pending.id}`, { method: 'PATCH', body: JSON.stringify({ cancel: true }) }).catch(() => {});
    onDone();
  }
  if (pending) {
    return (
      <div class="banner accent" role="status">
        <span><strong>Analyse {pending.status === 'en_cours' ? 'en cours de rédaction' : 'demandée'}</strong> sur {formatDate(pending.from)} → {formatDate(pending.to)}
          {' '}({formatDateTime(pending.requestedAt ?? null)}). Claude la rédige au prochain passage, au plus tard dans l'heure entre 7 h et 21 h.</span>
        <button class="ghost-btn" onClick={cancel}>Annuler</button>
      </div>
    );
  }
  return (
    <form class="card section date-range" style="border-color:var(--agency);display:flex;gap:8px;align-items:center;flex-wrap:wrap" onSubmit={launch}>
      <span class="label" style="color:var(--agency)">Vue agence</span>
      <button type="button" class="ghost-btn" onClick={() => preset(7)}>7 j</button>
      <button type="button" class="ghost-btn" onClick={() => preset(14)}>14 j</button>
      <button type="button" class="ghost-btn" onClick={() => preset(30)}>30 j</button>
      <input type="date" value={from} max={to} onInput={(e) => setFrom((e.target as HTMLInputElement).value)} aria-label="Début" />
      <span class="muted">→</span>
      <input type="date" value={to} min={from} max={yesterday} onInput={(e) => setTo((e.target as HTMLInputElement).value)} aria-label="Fin" />
      <button class="btn" type="submit" disabled={!from || !to || from > to}>Analyser mes campagnes</button>
      {msg && <span class="small" style={{ color: msg.ok ? 'var(--accent)' : 'var(--alert)' }}>{msg.text}</span>}
    </form>
  );
}

function ClientAnalysis({ a }: { a: Analysis }) {
  return (
    <>
      {a.summary && <article class="card md-content section" dangerouslySetInnerHTML={{ __html: renderMarkdown(a.summary) }} />}
      <div class="grid" style="gap:10px">
        {a.recommendations.map((r) => <RecoCard r={r} />)}
      </div>
      {a.publishedAt && <p class="mono small muted">Analyse publiée le {formatDate(a.publishedAt, { year: true })}.</p>}
    </>
  );
}

function RecoCard({ r, children }: { r: Reco; children?: preact.ComponentChildren }) {
  return (
    <article class="card edge reco" style={{ '--edge': SEVERITY_EDGE[r.severity] }}>
      <div class="kpi-row">
        <Pill kind={r.severity}>{SEVERITY_LABEL[r.severity]}</Pill>
        <span class="mono small muted">{STATE_LABEL[r.state] ?? r.state}{r.stateChangedAt && r.state !== 'ouverte' ? ` · ${formatDate(r.stateChangedAt)}` : ''}</span>
      </div>
      <h3>{r.title}</h3>
      <p>{r.body}</p>
      {children}
    </article>
  );
}

function AgencyAnalysis({ clientId, a, onChange }: { clientId: string; a: Analysis; onChange: () => void }) {
  const [clientSummary, setClientSummary] = useState(a.clientSummary ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function patch(body: Record<string, unknown>, ok: string) {
    setMsg(null);
    try { await api(`/clients/${clientId}/analyses/${a.id}`, { method: 'PATCH', body: JSON.stringify(body) }); setMsg({ ok: true, text: ok }); onChange(); }
    catch (x) { setMsg({ ok: false, text: (x as ApiError).message }); }
  }
  const kept = a.recommendations.filter((r) => r.state !== 'ignoree').length;
  return (
    <>
      <div class="card section" style="display:flex;flex-direction:column;gap:8px">
        <div class="kpi-row">
          <span class="label">Synthèse interne · rédigée par Claude le {formatDateTime(a.completedAt)}</span>
          {a.published ? <Pill kind="ok">Publiée le {formatDate(a.publishedAt)}</Pill> : <Pill kind="neutral">Interne</Pill>}
        </div>
        {a.summary && <div class="md-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(a.summary) }} />}
        <label class="small" style="display:flex;flex-direction:column;gap:4px">
          Synthèse pour le client
          <textarea rows={5} value={clientSummary} onInput={(e) => setClientSummary((e.target as HTMLTextAreaElement).value)} />
        </label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          {clientSummary !== (a.clientSummary ?? '') && <button class="ghost-btn" onClick={() => patch({ clientSummary }, 'Synthèse client enregistrée.')}>Enregistrer la synthèse client</button>}
          {!a.published
            ? <button class="btn" onClick={() => { if (confirm(`Publier l'analyse au client ? Il verra la synthèse client et ${kept} recommandation(s), en version client.`)) patch({ clientSummary, publish: true }, 'Publiée : le client la voit dans son Pilotage.'); }}>Publier au client…</button>
            : <button class="ghost-btn" onClick={() => patch({ unpublish: true }, 'Retirée de l’espace client.')}>Retirer de l'espace client</button>}
          {msg && <span class="small" style={{ color: msg.ok ? 'var(--accent)' : 'var(--alert)' }}>{msg.text}</span>}
        </div>
      </div>
      <div class="grid" style="gap:10px">
        {a.recommendations.map((r) => <AgencyReco clientId={clientId} r={r} onChange={onChange} />)}
      </div>
      <AgencyNote>les chiffres cités viennent uniquement de l'instantané de l'espace sur la période et des publicités lues dans Meta (lecture seule). Une recommandation ignorée n'est jamais publiée.</AgencyNote>
    </>
  );
}

function AgencyReco({ clientId, r, onChange }: { clientId: string; r: Reco; onChange: () => void }) {
  const [edit, setEdit] = useState(false);
  const [title, setTitle] = useState(r.clientTitle ?? '');
  const [body, setBody] = useState(r.clientBody ?? '');
  async function patch(b: Record<string, unknown>) {
    await api(`/clients/${clientId}/recommendations/${r.id}`, { method: 'PATCH', body: JSON.stringify(b) });
    setEdit(false); onChange();
  }
  return (
    <RecoCard r={r}>
      <div class="small" style="color:var(--agency);display:flex;flex-direction:column;gap:6px">
        {!edit ? (
          <div><strong>Version client :</strong> {r.clientTitle || <em>reprend le titre interne</em>} — {r.clientBody || <em>reprend le texte interne</em>}</div>
        ) : (
          <>
            <input type="text" value={title} maxLength={200} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} aria-label="Titre client" />
            <textarea rows={3} value={body} maxLength={2000} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} aria-label="Texte client" />
          </>
        )}
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          {!edit ? <button class="ghost-btn" onClick={() => setEdit(true)}>Réécrire pour le client</button>
            : <><button class="btn" onClick={() => patch({ clientTitle: title, clientBody: body })}>Enregistrer</button><button class="ghost-btn" onClick={() => setEdit(false)}>Annuler</button></>}
          {r.state !== 'traitee' && <button class="ghost-btn" onClick={() => patch({ state: 'traitee' })}>Marquer traitée</button>}
          {r.state !== 'ignoree' && <button class="ghost-btn" onClick={() => patch({ state: 'ignoree' })}>Ignorer</button>}
          {r.state !== 'ouverte' && <button class="ghost-btn" onClick={() => patch({ state: 'ouverte' })}>Rouvrir</button>}
          <a class="ghost-btn" href={`/c/${clientId}/optimisations?nouvelle=1&source=analyse&ref=${encodeURIComponent(r.id)}&titre=${encodeURIComponent(r.title)}&constat=${encodeURIComponent(r.body)}`}>Créer une optimisation</a>
          <span class="muted">{r.published ? 'Visible du client' : 'Non publiée'}</span>
        </div>
      </div>
    </RecoCard>
  );
}
