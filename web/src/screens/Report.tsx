import { useState } from 'preact/hooks';
import { DASH, addDaysYmd, formatDate, formatDateTime, formatDelta, formatEuros, formatInt, todayParis } from '@obsidian/domain';
import { ApiError, api, useApi } from '../api.ts';
import { useSession } from '../session.ts';
import { AgencyNote, EmptyState, ErrorBox, Loading, PageHead, Pill, Segmented } from '../components/ui.tsx';

interface Row { key: string; label: string; money: boolean; current: number | null; previous: number | null; delta: number | null; reason: string | null }
interface Report {
  id: string; periodType: 'semaine' | 'mois'; from: string; to: string; comment: string | null; createdAt: string;
  published?: boolean; publishedAt: string | null;
  snapshot: {
    client: { name: string; currency: string };
    period: { type: string; from: string; to: string; fullTo: string; partial: boolean; previousFrom: string; previousTo: string };
    rows: Row[]; lastSync: string | null; generatedAt: string;
  };
}

const HIGHER_BAD = new Set<string>();
const val = (r: Row, v: number | null) => (v == null ? DASH : r.money ? formatEuros(v) : formatInt(v));

/** Rapport de période (§11) : tableau comparatif figé, analyse de l'agence, impression / PDF. */
export function ReportScreen({ clientId }: { clientId: string }) {
  const { me, view } = useSession();
  const agency = me.user.role === 'agence' && view === 'agence';
  const { data, error, loading, reload } = useApi<{ reports: Report[] }>(`/clients/${clientId}/reports`);
  const [selected, setSelected] = useState<string | null>(null);
  const list = data?.reports ?? [];
  const current = list.find((r) => r.id === selected) ?? list[0];

  return (
    <>
      <div class="no-print">
        <PageHead a="Rapport" b="de période" sub="La semaine ou le mois comparé à la période précédente, avec l'analyse et les prochaines actions. Imprimable en PDF." />
        {agency && <NewReport clientId={clientId} onDone={(id) => { setSelected(id); reload(); }} />}
        {error && <ErrorBox error={error} />}
        {loading && !data && <Loading />}
        {data && list.length === 0 && (
          <EmptyState title={agency ? 'Aucun rapport pour le moment' : 'Aucun rapport publié'}>
            {agency ? 'Choisissez une semaine ou un mois et générez le rapport.' : 'Vos rapports apparaissent ici dès qu’Obsidian Partners les publie.'}
          </EmptyState>
        )}
        {list.length > 1 && (
          <label class="small muted" style="display:block;margin-bottom:10px">Rapports{' '}
            <select class="client-select" style="width:auto;display:inline-block" value={current?.id} onChange={(e) => setSelected((e.target as HTMLSelectElement).value)}>
              {list.map((r) => <option value={r.id}>{r.periodType === 'mois' ? 'Mois' : 'Semaine'} du {formatDate(r.from)} au {formatDate(r.to)}{agency ? (r.published ? ' · publié' : ' · interne') : ''}</option>)}
            </select>
          </label>
        )}
      </div>
      {current && <ReportView clientId={clientId} r={current} agency={agency} onChange={reload} />}
    </>
  );
}

function NewReport({ clientId, onDone }: { clientId: string; onDone: (id: string) => void }) {
  const lastWeek = addDaysYmd(todayParis(), -7);
  const lastMonth = (() => { const d = new Date(`${todayParis().slice(0, 7)}-01T12:00:00Z`); d.setUTCDate(0); return d.toISOString().slice(0, 10); })();
  const [type, setType] = useState<'semaine' | 'mois'>('semaine');
  const [day, setDay] = useState(lastWeek);
  const [msg, setMsg] = useState<string | null>(null);
  async function go(e: Event) {
    e.preventDefault(); setMsg(null);
    try { const r = await api<{ id: string }>(`/clients/${clientId}/reports`, { method: 'POST', body: JSON.stringify({ periodType: type, day }) }); onDone(r.id); }
    catch (x) { setMsg((x as ApiError).message); }
  }
  return (
    <form class="card section date-range" style="border-color:var(--agency);display:flex;gap:8px;align-items:center;flex-wrap:wrap" onSubmit={go}>
      <span class="label" style="color:var(--agency)">Vue agence · nouveau rapport</span>
      <Segmented label="Type" value={type} onChange={(t) => { setType(t); setDay(t === 'mois' ? lastMonth : lastWeek); }} options={[{ value: 'semaine', label: 'Hebdomadaire' }, { value: 'mois', label: 'Mensuel' }]} />
      <input type="date" value={day} max={addDaysYmd(todayParis(), -1)} onInput={(e) => setDay((e.target as HTMLInputElement).value)} aria-label={type === 'mois' ? 'Un jour du mois' : 'Un jour de la semaine'} />
      <span class="small muted">{type === 'mois' ? 'un jour du mois voulu' : 'un jour de la semaine voulue (lundi → dimanche)'}</span>
      <button class="btn" type="submit">Générer le rapport</button>
      {msg && <span class="small" style="color:var(--alert)">{msg}</span>}
    </form>
  );
}

function ReportView({ clientId, r, agency, onChange }: { clientId: string; r: Report; agency: boolean; onChange: () => void }) {
  const [comment, setComment] = useState(r.comment ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const s = r.snapshot;
  async function patch(body: Record<string, unknown>, ok: string) {
    setMsg(null);
    try { await api(`/clients/${clientId}/reports/${r.id}`, { method: 'PATCH', body: JSON.stringify(body) }); setMsg({ ok: true, text: ok }); onChange(); }
    catch (x) { setMsg({ ok: false, text: (x as ApiError).message }); }
  }
  async function remove() {
    if (!confirm('Supprimer ce rapport interne ?')) return;
    try { await api(`/clients/${clientId}/reports/${r.id}`, { method: 'DELETE' }); onChange(); } catch (x) { setMsg({ ok: false, text: (x as ApiError).message }); }
  }
  return (
    <article class="card report" key={r.id}>
      <header class="report-head">
        <div>
          <div class="label">Rapport {r.periodType === 'mois' ? 'mensuel' : 'hebdomadaire'}</div>
          <h2 style="margin:4px 0">{s.client.name}</h2>
          <div class="small muted">
            Du {formatDate(s.period.from, { year: true })} au {formatDate(s.period.to, { year: true })}
            {s.period.partial && <> (période en cours, arrêtée à cette date)</>} · comparé au {formatDate(s.period.previousFrom)} → {formatDate(s.period.previousTo, { year: true })}
          </div>
        </div>
        <div class="no-print" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          {agency && (r.published ? <Pill kind="ok">Publié le {formatDate(r.publishedAt)}</Pill> : <Pill kind="neutral">Interne</Pill>)}
          <button class="btn" onClick={() => window.print()}>Imprimer / PDF</button>
        </div>
      </header>

      <div class="table-wrap" style="margin-top:14px">
        <table>
          <thead><tr><th scope="col">Indicateur</th><th scope="col">Période</th><th scope="col">Période précédente</th><th scope="col">Évolution</th></tr></thead>
          <tbody>
            {s.rows.map((row) => (
              <tr>
                <td>{row.label}</td>
                <td class="mono">{val(row, row.current)}{row.current == null && row.reason && <div class="small muted">{row.reason}</div>}</td>
                <td class="mono">{val(row, row.previous)}</td>
                <td class={`mono ${row.delta == null ? '' : (row.delta >= 0) !== HIGHER_BAD.has(row.key) ? 'delta good' : 'delta bad'}`}>{row.delta == null ? DASH : formatDelta(row.delta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.client.currency !== 'EUR' && <p class="small muted">Montants en euros (compte publicitaire en {s.client.currency}, converti au taux BCE du jour).</p>}

      <h3 style="margin:18px 0 6px">Analyse et prochaines actions</h3>
      {agency ? (
        <div class="no-print" style="display:flex;flex-direction:column;gap:8px">
          <textarea rows={8} value={comment} onInput={(e) => setComment((e.target as HTMLTextAreaElement).value)} aria-label="Analyse et prochaines actions" />
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            {comment !== (r.comment ?? '') && <button class="ghost-btn" onClick={() => patch({ comment }, 'Analyse enregistrée.')}>Enregistrer l'analyse</button>}
            {!r.published
              ? <button class="btn" onClick={() => { if (confirm('Publier ce rapport ? Le client le verra dans son espace (aucun email n’est envoyé).')) patch({ comment, publish: true }, 'Publié.'); }}>Publier au client…</button>
              : <button class="ghost-btn" onClick={() => patch({ unpublish: true }, 'Retiré de l’espace client.')}>Retirer de l'espace client</button>}
            {!r.published && <button class="ghost-btn" onClick={remove}>Supprimer</button>}
            {msg && <span class="small" style={{ color: msg.ok ? 'var(--accent)' : 'var(--alert)' }}>{msg.text}</span>}
          </div>
        </div>
      ) : null}
      <div class={agency ? 'print-only' : ''} style="white-space:pre-wrap">{(agency ? comment : r.comment) || <span class="muted">Pas d'analyse rédigée.</span>}</div>

      <footer class="report-foot small muted">
        Obsidian Partners · chiffres figés le {formatDateTime(s.generatedAt)}{s.lastSync ? ` (dernière synchronisation : ${formatDateTime(s.lastSync)})` : ''} · une absence de mesure s'affiche « — », jamais 0.
      </footer>
      {agency && <AgencyNote>le rapport est figé : il garde les chiffres du jour de sa génération. Pour le refaire, supprimez la version interne et régénérez.</AgencyNote>}
    </article>
  );
}

// ─────────────────────────── Feedback (§11) ───────────────────────────

interface Feedback {
  id: string; category: string; severity: string; body: string; attachments: { url: string }[]; status: string;
  reply: string | null; repliedAt: string | null; createdAt: string;
  context?: { period: { from: string; to: string }; totals: Record<string, number> | null; derived: Record<string, number | null> | null; connections: { type: string; state: string; error_message: string | null }[]; recommendations: { date: string; title: string; severity: string; state: string }[] };
}
const CAT: Record<string, string> = { bug: 'Bug', resultat: 'Résultat décevant', demande: 'Demande', question: 'Question' };
const SEV: Record<string, string> = { faible: 'Faible', normale: 'Normale', haute: 'Haute' };
const STAT: Record<string, [string, string]> = { nouveau: ['Nouveau', 'surveiller'], vu: ['Vu', 'neutral'], en_cours: ['En cours', 'info'], resolu: ['Résolu', 'ok'] };

export function FeedbackScreen({ clientId }: { clientId: string }) {
  const { me, view } = useSession();
  const isClient = me.user.role === 'client';
  const agency = me.user.role === 'agence' && view === 'agence';
  const { data, error, loading, reload } = useApi<{ feedback: Feedback[] }>(`/clients/${clientId}/feedback`);
  return (
    <>
      <PageHead a="Vos" b="retours" sub="Un bug, un résultat qui vous déçoit, une demande, une question : écrivez-nous ici, nous répondons dans cet espace." />
      {isClient && <FeedbackForm clientId={clientId} onDone={reload} />}
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading />}
      {data && data.feedback.length === 0 && <EmptyState title="Aucun retour pour le moment">{isClient ? 'Vos retours et nos réponses apparaîtront ici.' : 'Le client n’a encore envoyé aucun retour.'}</EmptyState>}
      <div class="grid" style="gap:10px">
        {data?.feedback.map((f) => <FeedbackCard clientId={clientId} f={f} agency={agency} onChange={reload} />)}
      </div>
    </>
  );
}

function FeedbackForm({ clientId, onDone }: { clientId: string; onDone: () => void }) {
  const [category, setCategory] = useState('question');
  const [severity, setSeverity] = useState('normale');
  const [body, setBody] = useState('');
  const [links, setLinks] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function send(e: Event) {
    e.preventDefault(); setMsg(null);
    try {
      await api(`/clients/${clientId}/feedback`, { method: 'POST', body: JSON.stringify({ category, severity, body, links: links.split(/\s+/).filter(Boolean) }) });
      setBody(''); setLinks(''); setMsg({ ok: true, text: 'Retour envoyé. Nous vous répondons ici.' }); onDone();
    } catch (x) { setMsg({ ok: false, text: (x as ApiError).message }); }
  }
  return (
    <form class="card section" style="display:flex;flex-direction:column;gap:10px" onSubmit={send}>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <Segmented label="Catégorie" value={category} onChange={setCategory} options={Object.entries(CAT).map(([value, label]) => ({ value, label }))} />
        <Segmented label="Gravité" value={severity} onChange={setSeverity} options={Object.entries(SEV).map(([value, label]) => ({ value, label }))} />
      </div>
      <textarea rows={4} required minLength={5} maxLength={5000} value={body} placeholder="Décrivez ce que vous constatez, et depuis quand." onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} aria-label="Description" />
      <input type="text" value={links} placeholder="Pièces jointes : liens https (capture, vidéo, document), séparés par un espace" onInput={(e) => setLinks((e.target as HTMLInputElement).value)} aria-label="Liens vers des pièces jointes" />
      <div style="display:flex;gap:10px;align-items:center">
        <button class="btn" type="submit" disabled={body.trim().length < 5}>Envoyer</button>
        {msg && <span class="small" style={{ color: msg.ok ? 'var(--accent)' : 'var(--alert)' }}>{msg.text}</span>}
      </div>
    </form>
  );
}

function FeedbackCard({ clientId, f, agency, onChange }: { clientId: string; f: Feedback; agency: boolean; onChange: () => void }) {
  const [reply, setReply] = useState(f.reply ?? '');
  const [open, setOpen] = useState(false);
  const [label, kind] = STAT[f.status] ?? [f.status, 'neutral'];
  async function patch(body: Record<string, unknown>) {
    await api(`/clients/${clientId}/feedback/${f.id}`, { method: 'PATCH', body: JSON.stringify(body) });
    onChange();
  }
  const t = f.context?.totals, d = f.context?.derived;
  return (
    <article class="card edge" style={{ '--edge': f.severity === 'haute' ? 'var(--alert)' : f.severity === 'normale' ? 'var(--warn)' : 'var(--border)' }}>
      <div class="kpi-row">
        <span class="label">{CAT[f.category]} · gravité {SEV[f.severity].toLowerCase()} · {formatDateTime(f.createdAt)}</span>
        <Pill kind={kind}>{label}</Pill>
      </div>
      <p style="white-space:pre-wrap;margin:8px 0">{f.body}</p>
      {f.attachments.length > 0 && <div class="small">{f.attachments.map((a, i) => <a href={a.url} target="_blank" rel="noopener noreferrer" style="margin-right:10px">Pièce jointe {i + 1} ↗</a>)}</div>}
      {f.reply && !agency && (
        <div class="card" style="margin-top:8px;background:var(--surface-2)"><span class="label">Réponse d'Obsidian Partners · {formatDateTime(f.repliedAt)}</span><p style="white-space:pre-wrap;margin:6px 0 0">{f.reply}</p></div>
      )}
      {agency && (
        <div style="margin-top:8px;display:flex;flex-direction:column;gap:8px;color:var(--agency)" class="small">
          <button class="ghost-btn" style="align-self:flex-start" onClick={() => setOpen(!open)}>{open ? 'Masquer' : 'Voir'} le contexte joint</button>
          {open && f.context && (
            <div class="card" style="color:var(--text)">
              <div class="label">Chiffres du {formatDate(f.context.period.from)} au {formatDate(f.context.period.to)}</div>
              <p class="small" style="margin:6px 0">
                {t ? <>Dépense {formatEuros(t.spend_cents)} · leads {formatInt(t.leads)} · rendez-vous {formatInt(t.appointments_booked)} · coût par RDV {formatEuros(d?.cost_per_booked_cents ?? null, { decimals: true })} · CTR {d?.ctr != null ? `${(d.ctr * 100).toFixed(2).replace('.', ',')} %` : DASH}</> : 'Aucun chiffre synchronisé sur 7 jours.'}
              </p>
              <p class="small" style="margin:6px 0">Connexions : {f.context.connections.map((c) => `${c.type} ${c.state}${c.error_message ? ` (${c.error_message})` : ''}`).join(' · ') || DASH}</p>
              <p class="small" style="margin:6px 0">Dernières recommandations : {f.context.recommendations.map((r) => `${formatDate(r.date)} ${r.title} (${r.state})`).join(' · ') || DASH}</p>
            </div>
          )}
          <textarea rows={3} value={reply} placeholder="Réponse au client (visible dans son espace)" onInput={(e) => setReply((e.target as HTMLTextAreaElement).value)} aria-label="Réponse" />
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            {reply !== (f.reply ?? '') && <button class="btn" onClick={() => patch({ reply })}>Envoyer la réponse</button>}
            {f.status === 'nouveau' && <button class="ghost-btn" onClick={() => patch({ status: 'vu' })}>Marquer vu</button>}
            {f.status !== 'en_cours' && f.status !== 'resolu' && <button class="ghost-btn" onClick={() => patch({ status: 'en_cours' })}>En cours</button>}
            {f.status !== 'resolu' ? <button class="ghost-btn" onClick={() => patch({ status: 'resolu' })}>Résolu</button> : <button class="ghost-btn" onClick={() => patch({ status: 'en_cours' })}>Rouvrir</button>}
          </div>
        </div>
      )}
    </article>
  );
}
