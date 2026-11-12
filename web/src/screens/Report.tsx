import { useState } from 'preact/hooks';
import { DASH, addDaysYmd, formatDate, formatDateTime, formatDelta, formatEuros, formatInt, formatPercent, formatRatio, todayParis } from '@obsidian/domain';
import { ApiError, api, openFile, useApi } from '../api.ts';
import { useSession } from '../session.ts';
import { AgencyNote, DualBarChart, EmptyState, ErrorBox, Loading, PageHead, Pill, Segmented } from '../components/ui.tsx';

interface Row { key: string; label: string; money: boolean; current: number | null; previous: number | null; delta: number | null; reason: string | null }
interface Report {
  id: string; periodType: 'semaine' | 'mois'; from: string; to: string; comment: string | null; createdAt: string;
  published?: boolean; publishedAt: string | null;
  snapshot: {
    client: { name: string; currency: string };
    period: { type: string; from: string; to: string; fullTo: string; partial: boolean; previousFrom: string; previousTo: string };
    rows: Row[]; lastSync: string | null; generatedAt: string;
    // Contenu enrichi (rapports générés depuis le 12 nov. 2026) : absent des rapports plus anciens.
    ratioRows?: RatioRow[];
    series?: { date: string; spend_cents: number | null; leads: number | null; appointments_booked: number | null }[];
    crmMeasured?: boolean;
    campaigns?: EntityRow[]; topAds?: EntityRow[];
  };
}

interface RatioRow { key: string; label: string; format: 'euros' | 'percent' | 'ratio'; higherIsBetter: boolean; current: number | null; previous: number | null; delta: number | null; reason: string | null }
interface EntityRow { id: string; name: string; spend_cents: number; impressions: number; link_clicks: number; leads: number; appointments_booked: number | null; cost_per_booked_cents: number | null; cost_per_lead_cents: number | null; ctr: number | null }

const HIGHER_BAD = new Set<string>();
const fmtRatio = (r: RatioRow, v: number | null) => v == null ? DASH
  : r.format === 'euros' ? formatEuros(v, { decimals: true }) : r.format === 'percent' ? formatPercent(v, r.key === 'ctr' ? 2 : 1) : formatRatio(v);
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
            {me.user.role === 'agence' && !agency && <div class="small" style="color:var(--agency);margin-top:8px">Aperçu agence : le client ne voit que les rapports publiés. Revenez en vue agence (← Agence) pour en générer un, puis « Publier au client ».</div>}
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

      {s.ratioRows && (
        <>
          <h3 style="margin:18px 0 6px">Ratios clés</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th scope="col">Ratio</th><th scope="col">Période</th><th scope="col">Période précédente</th><th scope="col">Évolution</th></tr></thead>
              <tbody>
                {s.ratioRows.map((row) => (
                  <tr>
                    <td>{row.label}</td>
                    <td class="mono">{fmtRatio(row, row.current)}{row.current == null && row.reason && <div class="small muted">{row.reason}</div>}</td>
                    <td class="mono">{fmtRatio(row, row.previous)}</td>
                    <td class={`mono ${row.delta == null ? '' : (row.delta >= 0) === row.higherIsBetter ? 'delta good' : 'delta bad'}`}>{row.delta == null ? DASH : formatDelta(row.delta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {s.series && s.series.length > 1 && (
        <div class="report-chart">
          <h3 style="margin:18px 0 6px">Par jour</h3>
          {s.crmMeasured
            ? <DualBarChart data={s.series.map((d) => ({ date: d.date, a: d.spend_cents, b: d.appointments_booked }))} a={{ label: 'Dépense', format: (v) => formatEuros(v) }} b={{ label: 'Rendez-vous pris', format: formatInt }} />
            : <DualBarChart data={s.series.map((d) => ({ date: d.date, a: d.spend_cents, b: d.leads }))} a={{ label: 'Dépense', format: (v) => formatEuros(v) }} b={{ label: 'Leads', format: formatInt }} />}
        </div>
      )}

      {s.campaigns && s.campaigns.length > 0 && <EntityTable title="Campagnes" rows={s.campaigns} crm={Boolean(s.crmMeasured)} />}
      {s.topAds && s.topAds.length > 0 && <EntityTable title="Publicités (les plus dépensières)" rows={s.topAds} crm={Boolean(s.crmMeasured)} />}

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

function EntityTable({ title, rows, crm }: { title: string; rows: EntityRow[]; crm: boolean }) {
  return (
    <>
      <h3 style="margin:18px 0 6px">{title}</h3>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th scope="col">Nom</th><th scope="col">Dépense</th><th scope="col">Clics</th><th scope="col">CTR</th><th scope="col">Leads</th><th scope="col">Coût / lead</th>
            {crm && <><th scope="col">Rendez-vous</th><th scope="col">Coût / RDV</th></>}
          </tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr class={crm && e.spend_cents > 0 && e.appointments_booked === 0 ? 'red' : ''}>
                <td style="max-width:280px;overflow-wrap:anywhere">{e.name}</td>
                <td class="mono">{formatEuros(e.spend_cents)}</td>
                <td class="mono">{formatInt(e.link_clicks)}</td>
                <td class="mono">{e.ctr == null ? DASH : formatPercent(e.ctr, 2)}</td>
                <td class="mono">{formatInt(e.leads)}</td>
                <td class="mono">{formatEuros(e.cost_per_lead_cents, { decimals: true })}</td>
                {crm && <><td class="mono">{e.appointments_booked == null ? DASH : formatInt(e.appointments_booked)}</td>
                  <td class="mono">{e.appointments_booked === 0 && e.spend_cents > 0 ? `${formatEuros(e.spend_cents)} sans RDV` : formatEuros(e.cost_per_booked_cents, { decimals: true })}</td></>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─────────────────────────── Feedback (§11) ───────────────────────────

interface Attachment { index: number; url?: string; name?: string; type?: string; size?: number }
interface Feedback {
  id: string; category: string; severity: string; body: string; attachments: Attachment[]; status: string;
  reply: string | null; repliedAt: string | null; createdAt: string;
  context?: { period: { from: string; to: string }; totals: Record<string, number> | null; derived: Record<string, number | null> | null; connections: { type: string; state: string; error_message: string | null }[]; recommendations: { date: string; title: string; severity: string; state: string }[] };
}
const CAT: Record<string, string> = { bug: 'Bug', resultat: 'Résultat décevant', demande: 'Demande', question: 'Question' };
const CAT_HINT: Record<string, string> = {
  bug: 'Quelque chose ne marche pas : page, formulaire, calendrier, chiffre faux…',
  resultat: 'Les résultats ne sont pas au niveau attendu : leads, rendez-vous, qualité…',
  demande: 'Une modification ou un ajout : publicité, page, séquence, accès…',
  question: 'Vous voulez comprendre un chiffre, une étape, un choix.',
};
const SEV: Record<string, string> = { faible: 'Faible', normale: 'Normale', haute: 'Urgente' };
const SEV_HINT: Record<string, string> = { faible: 'Quand vous aurez le temps', normale: 'Dans les jours qui viennent', haute: 'Bloquant : les campagnes ou les ventes en pâtissent' };
/** Libellés : l'agence suit le traitement ; le client voit où en est sa demande (pas de discussion, décision 0015). */
const STAT_AGENCY: Record<string, [string, string]> = { nouveau: ['Nouveau', 'surveiller'], vu: ['Vu', 'neutral'], en_cours: ['En cours', 'info'], resolu: ['Traité', 'ok'] };
const STAT_CLIENT: Record<string, [string, string]> = { nouveau: ['Reçu', 'surveiller'], vu: ['Pris en compte', 'neutral'], en_cours: ['En cours de traitement', 'info'], resolu: ['Traité', 'ok'] };
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,application/pdf,video/mp4,video/quicktime';
const sizeLabel = (n?: number) => n == null ? '' : n > 1_048_576 ? `${(n / 1_048_576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`;

export function FeedbackScreen({ clientId }: { clientId: string }) {
  const { me, view } = useSession();
  const isClient = me.user.role === 'client';
  const agency = me.user.role === 'agence' && view === 'agence';
  const { data, error, loading, reload } = useApi<{ feedback: Feedback[] }>(`/clients/${clientId}/feedback`);
  return (
    <>
      <PageHead a="Vos" b="retours" sub="Un bug, un résultat qui vous déçoit, une demande, une question : décrivez-le ici, avec vos captures ou documents. Obsidian Partners traite votre demande et vous suivez son avancement ci-dessous." />
      {(isClient || me.user.role === 'agence' && view === 'client') && <FeedbackForm clientId={clientId} onDone={reload} preview={!isClient} />}
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading />}
      {data && data.feedback.length === 0 && <EmptyState title="Aucun retour pour le moment">{isClient ? 'Vos demandes et leur avancement apparaîtront ici.' : 'Le client n’a encore envoyé aucun retour.'}</EmptyState>}
      {data && data.feedback.length > 0 && <h3 style="margin:18px 0 8px">{isClient ? 'Vos demandes' : 'Retours du client'}</h3>}
      <div class="grid" style="gap:10px">
        {data?.feedback.map((f) => <FeedbackCard clientId={clientId} f={f} agency={agency} onChange={reload} />)}
      </div>
    </>
  );
}

function FeedbackForm({ clientId, onDone, preview }: { clientId: string; onDone: () => void; preview?: boolean }) {
  const [category, setCategory] = useState('demande');
  const [severity, setSeverity] = useState('normale');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files, ...Array.from(list)];
    const bad = next.find((f) => !ACCEPT.split(',').includes(f.type));
    if (bad) { setMsg({ ok: false, text: `« ${bad.name} » : format non accepté (image, PDF ou vidéo MP4 / MOV).` }); return; }
    const big = next.find((f) => f.size > 25 * 1024 * 1024);
    if (big) { setMsg({ ok: false, text: `« ${big.name} » dépasse 25 Mo. Pour une vidéo plus longue, collez son lien dans la description.` }); return; }
    if (next.length > 5) { setMsg({ ok: false, text: '5 pièces jointes au plus.' }); return; }
    setMsg(null); setFiles(next);
  }
  async function send(e: Event) {
    e.preventDefault(); setMsg(null); setBusy(true);
    try {
      const r = await api<{ id: string }>(`/clients/${clientId}/feedback`, { method: 'POST', body: JSON.stringify({ category, severity, body }) });
      const failed: string[] = [];
      for (const [i, f] of files.entries()) {
        setMsg({ ok: true, text: `Envoi des pièces jointes (${i + 1}/${files.length})…` });
        try { await api(`/clients/${clientId}/feedback/${r.id}/files`, { method: 'PUT', body: f, headers: { 'Content-Type': f.type, 'X-File-Name': encodeURIComponent(f.name).slice(0, 300) } }); }
        catch (x) { failed.push(`${f.name} (${(x as ApiError).message})`); }
      }
      setBody(''); setFiles([]);
      setMsg(failed.length ? { ok: false, text: `Demande envoyée, mais ces pièces jointes n'ont pas pu être ajoutées : ${failed.join(' · ')}` } : { ok: true, text: 'Demande envoyée. Vous suivez son avancement ci-dessous.' });
      onDone();
    } catch (x) { setMsg({ ok: false, text: (x as ApiError).message }); } finally { setBusy(false); }
  }
  return (
    <form class="card section" style="display:flex;flex-direction:column;gap:12px" onSubmit={(e) => { if (preview) { e.preventDefault(); return; } send(e); }}>
      {preview && <div class="small" style="color:var(--agency)">Aperçu : c'est le formulaire que voit le client. En vue client (lecture seule), l'agence ne peut pas l'envoyer.</div>}
      <fieldset disabled={preview} style="border:0;padding:0;margin:0;display:flex;flex-direction:column;gap:12px;min-width:0">
      <div>
        <div class="label" style="margin-bottom:6px">Type de demande</div>
        <Segmented label="Type de demande" value={category} onChange={setCategory} options={Object.entries(CAT).map(([value, label]) => ({ value, label }))} />
        <div class="small muted" style="margin-top:4px">{CAT_HINT[category]}</div>
      </div>
      <div>
        <div class="label" style="margin-bottom:6px">Urgence</div>
        <Segmented label="Urgence" value={severity} onChange={setSeverity} options={Object.entries(SEV).map(([value, label]) => ({ value, label }))} />
        <div class="small muted" style="margin-top:4px">{SEV_HINT[severity]}</div>
      </div>
      <label class="field">Description
        <textarea rows={5} required minLength={5} maxLength={5000} value={body} placeholder="Ce que vous constatez ou souhaitez, où, et depuis quand. Un lien vers une page ou une vidéo peut être collé ici." onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} />
      </label>
      <div>
        <div class="label" style="margin-bottom:6px">Pièces jointes (facultatif)</div>
        <label class="ghost-btn" style="cursor:pointer;display:inline-block">Ajouter des fichiers
          <input type="file" multiple accept={ACCEPT} style="display:none" disabled={busy} onChange={(e) => { addFiles((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ''; }} />
        </label>
        <span class="small muted" style="margin-left:8px">Captures, PDF ou vidéos courtes · 5 fichiers, 25 Mo chacun</span>
        {files.length > 0 && (
          <ul class="small" style="margin:8px 0 0;padding-left:18px">
            {files.map((f, i) => <li>{f.name} · {sizeLabel(f.size)} <button type="button" class="ghost-btn small" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Retirer</button></li>)}
          </ul>
        )}
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="btn" type="submit" disabled={busy || body.trim().length < 5}>{busy ? 'Envoi…' : 'Envoyer la demande'}</button>
        {msg && <span class="small" style={{ color: msg.ok ? 'var(--accent)' : 'var(--alert)' }}>{msg.text}</span>}
      </div>
      </fieldset>
    </form>
  );
}

function Attachments({ clientId, f }: { clientId: string; f: Feedback }) {
  const [err, setErr] = useState<string | null>(null);
  if (!f.attachments.length) return null;
  return (
    <div class="small" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:4px 0">
      <span class="muted">Pièces jointes :</span>
      {f.attachments.map((a, i) => a.url
        ? <a href={a.url} target="_blank" rel="noopener noreferrer">Lien {i + 1} ↗</a>
        : <button class="ghost-btn small" onClick={() => openFile(`/clients/${clientId}/feedback/${f.id}/files/${a.index}`).catch((x) => setErr((x as Error).message))}>{a.name} · {sizeLabel(a.size)}</button>)}
      {err && <span style="color:var(--alert)">{err}</span>}
    </div>
  );
}

function FeedbackCard({ clientId, f, agency, onChange }: { clientId: string; f: Feedback; agency: boolean; onChange: () => void }) {
  const [reply, setReply] = useState(f.reply ?? '');
  const [open, setOpen] = useState(false);
  const [label, kind] = (agency ? STAT_AGENCY : STAT_CLIENT)[f.status] ?? [f.status, 'neutral'];
  async function patch(body: Record<string, unknown>) {
    await api(`/clients/${clientId}/feedback/${f.id}`, { method: 'PATCH', body: JSON.stringify(body) });
    onChange();
  }
  const t = f.context?.totals, d = f.context?.derived;
  return (
    <article class="card edge" style={{ '--edge': f.severity === 'haute' ? 'var(--alert)' : f.severity === 'normale' ? 'var(--warn)' : 'var(--border)' }}>
      <div class="kpi-row">
        <span class="label">{CAT[f.category]} · {SEV[f.severity].toLowerCase()} · {formatDateTime(f.createdAt)}</span>
        <Pill kind={kind}>{label}</Pill>
      </div>
      <p style="white-space:pre-wrap;margin:8px 0">{f.body}</p>
      <Attachments clientId={clientId} f={f} />
      {f.reply && !agency && (
        <div class="card" style="margin-top:8px;background:var(--surface-2)"><span class="label">Note d'Obsidian Partners · {formatDateTime(f.repliedAt)}</span><p style="white-space:pre-wrap;margin:6px 0 0">{f.reply}</p></div>
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
          <textarea rows={2} value={reply} placeholder="Note au client, facultative (ex. « corrigé le 14 nov. ») : visible dans son espace, il ne peut pas y répondre" onInput={(e) => setReply((e.target as HTMLTextAreaElement).value)} aria-label="Note au client" />
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            {reply !== (f.reply ?? '') && <button class="btn" onClick={() => patch({ reply })}>Enregistrer la note</button>}
            {f.status === 'nouveau' && <button class="ghost-btn" onClick={() => patch({ status: 'vu' })}>Marquer vu</button>}
            {f.status !== 'en_cours' && f.status !== 'resolu' && <button class="ghost-btn" onClick={() => patch({ status: 'en_cours' })}>En cours</button>}
            {f.status !== 'resolu' ? <button class="ghost-btn" onClick={() => patch({ status: 'resolu' })}>Traité</button> : <button class="ghost-btn" onClick={() => patch({ status: 'en_cours' })}>Rouvrir</button>}
          </div>
        </div>
      )}
    </article>
  );
}
