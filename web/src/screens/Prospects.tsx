import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
  PROSPECT_DOC_LABEL, PROSPECT_FIGURES, PROSPECT_FIGURE_LABEL, PROSPECT_STAGE_LABEL, PROSPECT_VERDICT_LABEL, formatDate, formatDateTime, formatEuros,
  maxCostPerAppointment, figureFromField, type ProspectDocType, type ProspectFigure, type TemplateBlock,
} from '@obsidian/domain';
import { ApiError, api, useApi } from '../api.ts';
import { navigate } from '../router.ts';
import { useSession } from '../session.ts';
import { AgencyNote, EmptyState, ErrorBox, KpiCard, Loading, PageHead, Pill } from '../components/ui.tsx';

/**
 * Module Prospects (section 29, décision 0027) : du R1 au R2, vue agence uniquement.
 * Les rédactions passent par la tâche Claude planifiée (au prochain passage, entre 7 h et 21 h) ; rien n'est envoyé au prospect.
 */

interface Item {
  id: string; name: string; software: string | null; stage: keyof typeof PROSPECT_STAGE_LABEL; verdict: string | null; mainObjection: string | null;
  r1At: string | null; r1Status: string | null; r2At: string | null; r2Status: string | null; daysIdle: number; flags: string[];
}
interface Upcoming { clientId: string | null; clientName: string | null; syncedAt: string | null; items: { id: string; name: string | null; scheduledAt: string; bookedAt: string; status: string; source: string | null; stage: string | null }[] }
interface ListData { items: Item[]; upcoming: Upcoming | null; kpis: { r1Held30: number; r1ToR2: number | null; r1HeldTotal: number; r2Total: number; signAfterR2: number | null; r2HeldTotal: number; signedTotal: number } }
interface Doc {
  id: string; type: ProspectDocType; version: number; status: 'en_file' | 'brouillon' | 'valide' | 'erreur'; content: any; instruction: string | null;
  generatedAt: string | null; validatedAt: string | null; editedByHand: boolean; lastError: string | null; verbatims: { quote: string; found: boolean }[]; verbatimsMissing: number;
}
interface Call { type: 'r1' | 'r2'; scheduledAt: string | null; status: string; templateVersion: number | null; notes: Record<string, any>; transcript: string | null; recordingUrl: string | null }
interface Full {
  prospect: {
    id: string; name: string; software: string | null; website: string | null; email: string | null; phone: string | null; source: string; stage: Item['stage'];
    verdict: string | null; forceContinue: boolean; mainObjection: string | null; marketResearch: string | null; caseStudyId: string | null; loomUrl: string | null;
    loomSentOn: string | null; offerText: string | null; offerPrice: string | null; outcomeReason: string | null; signedAmountCents: number | null; clientId: string | null;
  };
  client: { id: string; name: string } | null;
  figures: Record<ProspectFigure, { value: number | null; origin: string | null }>;
  cost: { value: number | null; missing: ProspectFigure[]; margin: number; ticket: number | null; life: number | null; closing: number | null };
  margin: number; qualification: { ok: boolean | null; label: string; detail: string }[];
  gaps: { key: ProspectFigure; saisi: number; transcription: number; origin: string }[];
  r1: Call | null; r2: Call | null; template: { version: number; blocks: TemplateBlock[] };
  docs: Record<ProspectDocType, { latest: Doc | null; validated: Doc | null; blocker: string | null; history: { version: number; status: string }[] }>;
  caseStudies: { id: string; client: string; figures: string | null }[]; flags: string[];
}

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)} %`);
const toLocalInput = (iso: string | null) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }).replace(' ', 'T').slice(0, 16) : '');
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
function fmtFigure(k: ProspectFigure, v: number | null) {
  if (v === null) return 'à confirmer en R2';
  const u = PROSPECT_FIGURE_LABEL[k].unit;
  return u === 'pct' ? `${Math.round(v * 1000) / 10} %` : u === 'eur' ? formatEuros(v * 100) : u === 'eur_jour' ? `${formatEuros(v * 100)}/jour` : u === 'mois' ? `${v} mois` : String(v);
}
const STAGE_KIND: Record<string, string> = { signe: 'ok', perdu: 'neutral', a_relancer: 'surveiller', r2_planifie: 'info', loom_envoye: 'info' };
const VERDICT_KIND: Record<string, string> = { qualifie: 'ok', a_creuser: 'surveiller', disqualifie: 'corriger' };

// ─── Liste ─────────────────────────────────────────────────────────────────────

export function ProspectsScreen() {
  const { data, error, reload } = useApi<ListData>('/agence/prospects', []);
  const [creating, setCreating] = useState(false);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const k = data.kpis;
  return (
    <>
      <PageHead a="Prospects" b="du R1 au R2"
        sub="Chaque prospect, de la prise du premier rendez-vous à l'issue du second. Trame pendant l'appel, analyse, plan et script du Loom, pitch du R2 : Claude rédige au prochain passage, vous relisez et validez. Rien n'est envoyé au prospect depuis l'espace."
        right={<div style="display:flex;gap:8px;flex-wrap:wrap"><a class="ghost-btn" href="/agence/prospects/reglages">Réglages</a>{!creating && <button class="btn" onClick={() => setCreating(true)}>+ Nouveau prospect</button>}</div>} />
      <div class="grid section" style="grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:12px">
        <KpiCard label="R1 tenus sur 30 jours" value={String(k.r1Held30)} />
        <KpiCard label="Passage du R1 au R2" value={pct(k.r1ToR2)} missingReason="Aucun R1 tenu" sub={`${k.r2Total} R2 sur ${k.r1HeldTotal} R1 tenus`} />
        <KpiCard label="Signature après R2" value={pct(k.signAfterR2)} missingReason="Aucun R2 tenu" sub={`${k.signedTotal} signés sur ${k.r2HeldTotal} R2 tenus`} />
      </div>
      {data.upcoming && <UpcomingAppointments up={data.upcoming} />}
      {creating && <NewProspect onDone={(id) => { setCreating(false); if (id) navigate(`/agence/prospects/${id}`); else reload(); }} />}
      {data.items.length === 0 && !creating ? (
        <EmptyState title="Aucun prospect">Créez la fiche au moment où le R1 est pris : trente secondes, puis la trame s'ouvre pendant l'appel.</EmptyState>
      ) : (
        <div class="table-wrap section">
          <table>
            <thead><tr><th>Prospect</th><th>Logiciel</th><th>Étape</th><th>R1</th><th>R2</th><th>Verdict</th><th>Objection principale</th><th>Sans action</th></tr></thead>
            <tbody>
              {data.items.map((p) => (
                <tr style={p.flags.length ? { background: 'color-mix(in srgb, var(--alert) 14%, transparent)' } : undefined} title={p.flags.join(' · ') || undefined}>
                  <td><a href={`/agence/prospects/${p.id}`}><strong>{p.name}</strong></a>{p.flags.length > 0 && <div class="small" style="color:var(--alert);white-space:normal">{p.flags.join(' · ')}</div>}</td>
                  <td>{p.software ?? '—'}</td>
                  <td><Pill kind={STAGE_KIND[p.stage] ?? 'neutral'}>{PROSPECT_STAGE_LABEL[p.stage]}</Pill></td>
                  <td>{p.r1At ? formatDateTime(p.r1At) : '—'}</td>
                  <td>{p.r2At ? formatDateTime(p.r2At) : '—'}</td>
                  <td>{p.verdict ? <Pill kind={VERDICT_KIND[p.verdict]}>{PROSPECT_VERDICT_LABEL[p.verdict]}</Pill> : '—'}</td>
                  <td style="white-space:normal;max-width:260px">{p.mainObjection ?? '—'}</td>
                  <td>{p.daysIdle} j</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Rendez-vous GoHighLevel à venir sans fiche (synchro quotidienne, lecture seule) : « Créer la fiche » reprend nom, date et source. */
function UpcomingAppointments({ up }: { up: Upcoming }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!up.clientId) return <p class="small muted section">Aucun GoHighLevel choisi pour les R1 : réglez-le dans <a href="/agence/prospects/reglages">Réglages</a>.</p>;
  async function create(id: string) {
    setBusy(id); setErr(null);
    try { const r = await api<{ id: string }>('/agence/prospects', { method: 'POST', body: JSON.stringify({ appointmentId: id }) }); navigate(`/agence/prospects/${r.id}`); }
    catch (x) { setErr((x as ApiError).message); setBusy(null); }
  }
  return (
    <section class="card section" style="display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
        <h3 style="margin:0">Rendez-vous à venir</h3>
        <span class="small muted">GoHighLevel · {up.clientName}{up.syncedAt ? ` · synchronisé le ${formatDateTime(up.syncedAt)}` : ''}</span>
      </div>
      {up.items.length === 0
        ? <p class="small muted" style="margin:0">Aucun rendez-vous à venir sans fiche. Les nouveaux rendez-vous apparaissent après la synchro du matin (ou une synchro lancée à la main).</p>
        : (
          <div class="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Contact</th><th>Source</th><th>Étape GHL</th><th>Pris le</th><th></th></tr></thead>
              <tbody>
                {up.items.map((a) => (
                  <tr>
                    <td><strong>{formatDateTime(a.scheduledAt)}</strong></td>
                    <td>{a.name ?? '—'}</td>
                    <td style="white-space:normal;max-width:260px">{a.source ?? '—'}</td>
                    <td style="white-space:normal;max-width:220px">{a.stage ?? '—'}</td>
                    <td>{formatDate(a.bookedAt)}</td>
                    <td><button class="ghost-btn small" disabled={busy !== null} onClick={() => create(a.id)}>{busy === a.id ? 'Création…' : 'Créer la fiche'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {err && <span class="small" style="color:var(--alert)">{err}</span>}
    </section>
  );
}

function NewProspect({ onDone }: { onDone: (id?: string) => void }) {
  const [f, setF] = useState({ name: '', software: '', website: '', email: '', phone: '', r1At: '', source: 'publicite' });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).value });
  async function submit(e: Event) {
    e.preventDefault(); setErr(null);
    try {
      const r = await api<{ id: string }>('/agence/prospects', { method: 'POST', body: JSON.stringify({ ...f, r1At: fromLocalInput(f.r1At) }) });
      onDone(r.id);
    } catch (x) { setErr((x as ApiError).message); }
  }
  return (
    <form class="card section" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:10px" onSubmit={submit}>
      <label class="field">Nom<input required maxLength={160} value={f.name} onInput={set('name')} /></label>
      <label class="field">Logiciel<input maxLength={160} value={f.software} onInput={set('software')} /></label>
      <label class="field">Site<input type="url" value={f.website} onInput={set('website')} placeholder="https://…" /></label>
      <label class="field">Email<input type="email" value={f.email} onInput={set('email')} /></label>
      <label class="field">Téléphone<input value={f.phone} onInput={set('phone')} /></label>
      <label class="field">Date et heure du R1<input type="datetime-local" value={f.r1At} onInput={set('r1At')} /></label>
      <label class="field">Source
        <select value={f.source} onChange={set('source')}><option value="publicite">Publicité</option><option value="recommandation">Recommandation</option><option value="autre">Autre</option></select>
      </label>
      <div style="display:flex;gap:8px;align-items:end">
        <button class="btn">Créer la fiche</button><button type="button" class="ghost-btn" onClick={() => onDone()}>Annuler</button>
        {err && <span class="small" style="color:var(--alert)">{err}</span>}
      </div>
    </form>
  );
}

// ─── Fiche ────────────────────────────────────────────────────────────────────

export function ProspectScreen({ id, search }: { id: string; search: string }) {
  const params = new URLSearchParams(search);
  const { data, error, reload } = useApi<Full>(`/agence/prospects/${id}`, [id]);
  const [tab, setTab] = useState(Number(params.get('etape') ?? '0') || 0);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const disq = data.prospect.verdict === 'disqualifie' && !data.prospect.forceContinue;
  const open = [true, true, Boolean(data.docs.analyse.validated) && !disq, Boolean(data.docs.plan.validated) && !disq];
  const current = tab || (open[3] ? 4 : open[2] ? 3 : data.r1?.status === 'tenu' ? 2 : 1);
  if (params.get('mode') === 'appel') return <CallMode data={data} step={current === 4 ? 4 : 1} reload={reload} />;
  const p = data.prospect;
  return (
    <>
      <PageHead a={p.name} b={p.software ?? 'prospect'}
        sub={<span>{PROSPECT_STAGE_LABEL[p.stage]}{p.verdict ? ` · ${PROSPECT_VERDICT_LABEL[p.verdict]}` : ''}{data.client ? <> · client : <a href={`/agence/clients/${data.client.id}`}>{data.client.name}</a></> : ''}</span>}
        right={<a class="ghost-btn" href="/agence/prospects">← Prospects</a>} />
      {data.flags.length > 0 && <p class="small section" style="color:var(--alert)"><strong>À faire :</strong> {data.flags.join(' · ')}</p>}
      <FiguresHeader data={data} reload={reload} />
      <div class="seg section" role="tablist" aria-label="Étapes">
        {['1 · R1 et trame', '2 · Analyse post-R1', '3 · Plan et Loom', '4 · R2'].map((l, i) => (
          <button type="button" role="tab" aria-selected={current === i + 1} aria-pressed={current === i + 1} disabled={!open[i]}
            title={!open[i] ? (disq ? 'Prospect disqualifié : forcez la suite pour continuer' : "Validez d'abord l'étape précédente") : undefined}
            onClick={() => setTab(i + 1)}>{l}</button>
        ))}
      </div>
      {current === 1 && <StepR1 data={data} reload={reload} />}
      {current === 2 && <StepAnalyse data={data} reload={reload} />}
      {current === 3 && <StepPlan data={data} reload={reload} />}
      {current === 4 && <StepR2 data={data} reload={reload} />}
      <AgencyNote>vue agence uniquement. Les chiffres viennent de la trame, de la transcription ou de vos corrections ; le coût maximum d'un rendez-vous est calculé par le code. Aucune réponse du R1 n'est copiée dans l'onboarding d'un client.</AgencyNote>
    </>
  );
}

function FiguresHeader({ data, reload }: { data: Full; reload: () => void }) {
  const [edit, setEdit] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const c = data.cost;
  async function save() {
    const body: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(vals)) {
      const n = v.trim() === '' ? null : Number(v.replace(',', '.'));
      body[k] = n === null ? null : k === 'taux_closing' ? n / 100 : n;
    }
    await api(`/agence/prospects/${data.prospect.id}/figures`, { method: 'PUT', body: JSON.stringify(body) });
    setEdit(false); setVals({}); reload();
  }
  return (
    <div class="card section" style="display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:baseline">
        <div><div class="label">Coût maximum d'un rendez-vous</div>
          <div class="kpi-value" style="font-size:28px">{c.value === null ? '—' : formatEuros(c.value * 100)}</div></div>
        <div class="small muted" style="flex:1;min-width:240px">
          {c.value === null
            ? `À confirmer en R2 : il manque ${c.missing.map((k) => PROSPECT_FIGURE_LABEL[k].label.toLowerCase()).join(', ')}.`
            : `= ${fmtFigure('ticket_mensuel', c.ticket)} × ${c.life} mois × marge ${Math.round(c.margin * 100)} % × closing ${Math.round(c.closing! * 1000) / 10} %`}
        </div>
        <button class="ghost-btn small" onClick={() => setEdit(!edit)}>{edit ? 'Annuler' : 'Corriger les chiffres'}</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(170px,100%),1fr));gap:8px">
        {PROSPECT_FIGURES.map((k) => {
          const f = data.figures[k];
          return (
            <div class="small">
              <div class="label">{PROSPECT_FIGURE_LABEL[k].label}</div>
              {edit
                ? <input inputMode="decimal" placeholder={k === 'taux_closing' ? '% (ex. 25)' : ''} value={vals[k] ?? (f.value === null ? '' : String(k === 'taux_closing' ? Math.round(f.value * 1000) / 10 : f.value))}
                    onInput={(e) => setVals({ ...vals, [k]: (e.target as HTMLInputElement).value })} />
                : <div><strong>{fmtFigure(k, f.value)}</strong>{f.origin && <span class="muted"> · {f.origin}</span>}</div>}
            </div>
          );
        })}
      </div>
      {edit && <div><button class="btn" onClick={save}>Enregistrer (origine : corrigé à la main)</button></div>}
      {data.gaps.length > 0 && (
        <p class="small" style="color:var(--warn);margin:0">
          Écart avec la transcription : {data.gaps.map((g) => `${PROSPECT_FIGURE_LABEL[g.key].label} ${fmtFigure(g.key, g.saisi)} saisi, ${fmtFigure(g.key, g.transcription)} dans la transcription`).join(' · ')}. La saisie prime.
        </p>
      )}
      <div class="pill-wrap" style="display:flex;gap:8px;flex-wrap:wrap">
        {data.qualification.map((q) => <Pill kind={q.ok === null ? 'neutral' : q.ok ? 'ok' : 'corriger'}>{q.label} : {q.detail}</Pill>)}
      </div>
    </div>
  );
}

/** Enregistrement à chaque frappe (avec un léger délai). */
function useAutosave(path: string, onSaved?: () => void) {
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<number | null>(null);
  const [state, setState] = useState<'' | 'saving' | 'saved' | 'error'>('');
  const flush = async () => {
    const notes = pending.current; pending.current = {};
    if (!Object.keys(notes).length) return;
    setState('saving');
    try { await api(path, { method: 'PATCH', body: JSON.stringify({ notes }) }); setState('saved'); onSaved?.(); } catch { setState('error'); }
  };
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); void flush(); }, []);
  return {
    state,
    set(key: string, value: unknown) {
      pending.current[key] = value;
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 600);
    },
  };
}

function Trame({ data, big = false, onFigures }: { data: Full; big?: boolean; onFigures?: () => void }) {
  const [notes, setNotes] = useState<Record<string, any>>(data.r1?.notes ?? {});
  const save = useAutosave(`/agence/prospects/${data.prospect.id}/calls/r1`, onFigures);
  const blocks = data.template.blocks;
  const live = maxCostPerAppointment(Object.fromEntries(blocks.flatMap((b) => b.fields).filter((f) => f.figure).map((f) => [f.figure!, figureFromField(f, notes[f.key]) ?? data.figures[f.figure!].value])), data.margin);
  const setV = (k: string, v: unknown) => { setNotes({ ...notes, [k]: v }); save.set(k, v); };
  return (
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="small muted">Trame v{data.template.version} · {save.state === 'saving' ? 'enregistrement…' : save.state === 'saved' ? 'enregistré' : save.state === 'error' ? 'échec de l\'enregistrement' : 'enregistrement automatique'}</div>
      {blocks.map((b) => (
        <section class="card" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:14px">
          <div>
            <div class="label">{b.time} · {b.goal}</div>
            <h3 style={{ margin: '4px 0 8px', fontSize: big ? '22px' : undefined }}>{b.title}</h3>
            <ul style={{ margin: 0, paddingLeft: '18px', fontSize: big ? '18px' : undefined, lineHeight: 1.5 }}>{b.questions.map((q) => <li>{q}</li>)}</ul>
            {b.live_calc && (
              <div class="card" style="margin-top:10px">
                <div class="label">Calcul en direct</div>
                <div class="kpi-value" style="font-size:26px">{live.value === null ? '—' : formatEuros(live.value * 100)}</div>
                <div class="small muted">{live.value === null ? `Il manque : ${live.missing.map((k) => PROSPECT_FIGURE_LABEL[k].label.toLowerCase()).join(', ')}` : `coût maximum d'un rendez-vous (marge ${Math.round(live.margin * 100)} %)`}</div>
              </div>
            )}
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
            {b.fields.map((f) => (
              <label class="field">{f.label}
                {f.type === 'choice'
                  ? <select value={notes[f.key] ?? ''} onChange={(e) => setV(f.key, (e.target as HTMLSelectElement).value)}><option value="">—</option>{f.options!.map((o) => <option value={o}>{o}</option>)}</select>
                  : f.type === 'number'
                  ? <input inputMode="decimal" value={notes[f.key] ?? ''} onInput={(e) => setV(f.key, (e.target as HTMLInputElement).value)} />
                  : f.type === 'datetime'
                  ? <input type="datetime-local" value={toLocalInput(notes[f.key] ?? null)} onInput={(e) => setV(f.key, fromLocalInput((e.target as HTMLInputElement).value))} />
                  : <textarea rows={2} value={notes[f.key] ?? ''} onInput={(e) => setV(f.key, (e.target as HTMLTextAreaElement).value)} />}
              </label>
            ))}
          </div>
        </section>
      ))}
      <label class="field">Notes libres<textarea rows={3} value={notes._libre ?? ''} onInput={(e) => setV('_libre', (e.target as HTMLTextAreaElement).value)} /></label>
    </div>
  );
}

function StepR1({ data, reload }: { data: Full; reload: () => void }) {
  const p = data.prospect;
  const [transcript, setTranscript] = useState(data.r1?.transcript ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const patchCall = async (body: Record<string, unknown>, ok?: string) => {
    setMsg(null);
    try { await api(`/agence/prospects/${p.id}/calls/r1`, { method: 'PATCH', body: JSON.stringify(body) }); if (ok) setMsg(ok); reload(); } catch (x) { setMsg((x as ApiError).message); }
  };
  return (
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
        <label class="field">Date et heure du R1<input type="datetime-local" value={toLocalInput(data.r1?.scheduledAt ?? null)} onChange={(e) => patchCall({ scheduledAt: fromLocalInput((e.target as HTMLInputElement).value) })} /></label>
        <label class="field">Statut
          <select value={data.r1?.status ?? 'prevu'} onChange={(e) => patchCall({ status: (e.target as HTMLSelectElement).value })}>
            <option value="prevu">Prévu</option><option value="tenu">Tenu</option><option value="absent">Absent</option><option value="annule">Annulé</option>
          </select>
        </label>
        <a class="btn" href={`/agence/prospects/${p.id}?mode=appel&etape=1`}>Mode en appel</a>
        <span class="small muted">{[p.email, p.phone, p.website].filter(Boolean).join(' · ')}</span>
      </div>
      <Trame data={data} onFigures={reload} />
      <div class="card" style="display:flex;flex-direction:column;gap:8px">
        <label class="field">Transcription du R1 (collée)<textarea rows={8} value={transcript} onInput={(e) => setTranscript((e.target as HTMLTextAreaElement).value)} placeholder="Collez ici la transcription complète (Fathom, Meet…)" /></label>
        <div class="small muted">{transcript.length.toLocaleString('fr-FR')} caractères</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          {transcript !== (data.r1?.transcript ?? '') && <button class="ghost-btn" onClick={() => patchCall({ transcript }, 'Transcription enregistrée.')}>Enregistrer la transcription</button>}
          <GenerateButton data={data} type="analyse" reload={reload} label="Analyser" />
          {msg && <span class="small">{msg}</span>}
        </div>
      </div>
    </div>
  );
}

function GenerateButton({ data, type, reload, label }: { data: Full; type: ProspectDocType; reload: () => void; label?: string }) {
  const d = data.docs[type];
  const [instr, setInstr] = useState('');
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const queued = d.latest?.status === 'en_file';
  async function go() {
    setErr(null);
    const confirmHand = d.latest?.editedByHand && d.latest.status === 'brouillon';
    if (confirmHand && !confirm('La dernière version a été modifiée à la main. La faire réécrire quand même ?')) return;
    try { await api(`/agence/prospects/${data.prospect.id}/documents/${type}/generate`, { method: 'POST', body: JSON.stringify({ instruction: instr, confirm: confirmHand }) }); setOpen(false); setInstr(''); reload(); }
    catch (x) { setErr((x as ApiError).message); }
  }
  if (queued) return <Pill kind="info">En rédaction : Claude la rédige au prochain passage (entre 7 h et 21 h)</Pill>;
  return (
    <span style="display:inline-flex;gap:6px;flex-wrap:wrap;align-items:center">
      {!open && <button class="btn" disabled={Boolean(d.blocker)} title={d.blocker ?? undefined} onClick={() => (d.latest ? setOpen(true) : go())}>{label ?? (d.latest ? 'Faire réécrire' : `Rédiger : ${PROSPECT_DOC_LABEL[type].toLowerCase()}`)}{d.latest && !label ? '' : ''}</button>}
      {open && <><input style="min-width:280px" placeholder="Consigne (facultatif)" value={instr} onInput={(e) => setInstr((e.target as HTMLInputElement).value)} /><button class="btn" onClick={go}>Envoyer à Claude</button><button class="ghost-btn" onClick={() => setOpen(false)}>Annuler</button></>}
      {d.blocker && <span class="small muted">{d.blocker}</span>}
      {err && <span class="small" style="color:var(--alert)">{err}</span>}
    </span>
  );
}

const KEY_LABEL: Record<string, string> = {
  fiche: 'Fiche prospect', logiciel: 'Logiciel', cibleActuelle: 'Cible actuelle', ticketMensuel: 'Ticket mensuel', dureeVieClient: 'Durée de vie client',
  tauxClosing: 'Taux de closing', capaciteDemos: 'Capacité de démos', clientsPayants: 'Clients payants', budgetPublicitaire: 'Budget publicitaire', decideurs: 'Décideurs',
  ecarts: 'Écarts trame / transcription', chiffres: 'Chiffres lus dans la transcription', forces: 'Les quatre forces', douleur: 'Douleur actuelle', attrait: 'Attrait de la solution',
  anxietes: 'Anxiétés', habitudes: 'Habitudes', texte: '', verbatim: 'Verbatim', verbatims: 'Verbatims', declencheur: 'Déclencheur', dejaEssaye: 'Déjà essayé', canal: 'Canal',
  prestataire: 'Prestataire', montant: 'Montant', raisonEchec: "Raison de l'échec (selon lui)", coutInaction: "Coût de l'inaction", objections: 'Objections',
  famille: 'Famille', objection: 'Objection', explicite: 'Explicite', verdict: 'Verdict', valeur: 'Verdict', raisons: 'Raisons', aConfirmerEnR2: 'À confirmer en R2',
  messageSortie: 'Message de sortie', verticale: 'Verticale recommandée', choix: 'Choix', suivante: 'Suivante', angles: 'Angles publicitaires', angle: 'Angle',
  accroche: 'Accroche', motsDuProspect: 'Dans ses mots', coutMaxRdvExplication: "Coût maximum d'un rendez-vous", actionsSansAgence: "Actions faisables sans l'agence",
  casClient: 'Cas client le plus proche', id: 'Cas', pourquoi: 'Pourquoi', dureeMinutes: 'Durée (min)', passages: 'Passages', titre: 'Titre', ecran: 'Écran à montrer',
  messageEmail: 'Email d\'accompagnement (à copier)', objet: 'Objet', corps: 'Corps', messageSms: 'SMS (à copier)', recap: 'Récap à relire', situation: 'Situation',
  plan: 'Le plan en trois points', reponse: 'Réponse', preuve: 'Preuve', questionCloture: 'Question de clôture', pointsACreuser: 'Trois points à creuser',
  ressourceAvantR2: 'Ressource à envoyer avant le R2',
};

function JsonView({ v, missing, depth = 0 }: { v: any; missing: Set<string>; depth?: number }): any {
  if (v === null || v === undefined || v === '') return <span class="muted">—</span>;
  if (typeof v === 'boolean') return <span>{v ? 'oui' : 'non'}</span>;
  if (typeof v === 'number' || typeof v === 'string') return <span style="white-space:pre-line">{String(v)}</span>;
  if (Array.isArray(v)) {
    if (!v.length) return <span class="muted">—</span>;
    return <ul style="margin:4px 0;padding-left:18px">{v.map((x) => <li><JsonView v={x} missing={missing} depth={depth + 1} /></li>)}</ul>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginLeft: depth ? '0' : undefined }}>
      {Object.entries(v).map(([k, x]) => {
        if (k === 'verbatim' || k === 'verbatims') {
          const list = (Array.isArray(x) ? x : [x]).filter((q) => typeof q === 'string' && q.trim());
          if (!list.length) return null;
          return list.map((q) => {
            const bad = missing.has(q.trim());
            return <blockquote style={{ margin: 0, padding: '2px 10px', borderLeft: `3px solid ${bad ? 'var(--alert)' : 'var(--accent)'}`, color: bad ? 'var(--alert)' : undefined, fontStyle: 'italic' }}>« {q} »{bad ? ' — introuvable dans la transcription' : ''}</blockquote>;
          });
        }
        const label = KEY_LABEL[k] ?? k;
        const nested = x && typeof x === 'object';
        return (
          <div>
            {label && <div class={depth === 0 ? 'label' : 'small'} style={depth === 0 ? 'margin-top:6px' : 'font-weight:600'}>{label}</div>}
            {nested ? <div style={{ paddingLeft: depth === 0 ? 0 : '10px' }}><JsonView v={x} missing={missing} depth={depth + 1} /></div> : <JsonView v={x} missing={missing} depth={depth + 1} />}
          </div>
        );
      })}
    </div>
  );
}

function DocPanel({ data, type, reload, children }: { data: Full; type: ProspectDocType; reload: () => void; children?: ComponentChildren }) {
  const d = data.docs[type];
  const doc = d.latest && d.latest.status === 'brouillon' ? d.latest : d.validated ?? (d.latest?.status === 'valide' ? d.latest : null);
  const [edit, setEdit] = useState(false);
  const [json, setJson] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const missing = new Set((doc?.verbatims ?? []).filter((x) => !x.found).map((x) => x.quote.trim()));
  async function patch(body: Record<string, unknown>) {
    setErr(null);
    try { await api(`/agence/prospects/${data.prospect.id}/documents/${type}`, { method: 'PATCH', body: JSON.stringify(body) }); setEdit(false); reload(); }
    catch (x) { setErr((x as ApiError).message); }
  }
  return (
    <section class="card" style="display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <h3 style="margin:0">{PROSPECT_DOC_LABEL[type]}</h3>
        {doc && <Pill kind={doc.status === 'valide' ? 'ok' : doc.status === 'erreur' ? 'corriger' : 'surveiller'}>{doc.status === 'valide' ? `Validé · v${doc.version}` : doc.status === 'erreur' ? 'Échec' : `Brouillon · v${doc.version}`}</Pill>}
        {doc?.editedByHand && <span class="small muted">modifié à la main</span>}
        <span style="margin-left:auto"><GenerateButton data={data} type={type} reload={reload} /></span>
      </div>
      {d.latest?.status === 'erreur' && <p class="small" style="color:var(--alert);margin:0">Échec de la rédaction : {d.latest.lastError}</p>}
      {doc && doc.verbatimsMissing > 0 && <p class="small" style="color:var(--alert);margin:0"><strong>{doc.verbatimsMissing} citation(s) introuvable(s) dans la transcription</strong> : corrigez-les ou retirez-les (Modifier) avant de valider.</p>}
      {!doc && !d.latest && <p class="small muted" style="margin:0">Pas encore rédigé.</p>}
      {doc && (edit
        ? <textarea rows={24} style="font-family:var(--font-mono);font-size:12px" value={json} onInput={(e) => setJson((e.target as HTMLTextAreaElement).value)} />
        : <JsonView v={doc.content} missing={missing} />)}
      {children}
      {doc && doc.status === 'brouillon' && (
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          {!edit && <button class="btn" disabled={doc.verbatimsMissing > 0} onClick={() => patch({ status: 'valide' })}>Valider</button>}
          {!edit && <button class="ghost-btn" onClick={() => { setJson(JSON.stringify(doc.content, null, 2)); setEdit(true); }}>Modifier</button>}
          {edit && <><button class="btn" onClick={() => { try { patch({ content: JSON.parse(json) }); } catch { setErr('JSON invalide.'); } }}>Enregistrer</button><button class="ghost-btn" onClick={() => setEdit(false)}>Annuler</button></>}
        </div>
      )}
      {d.validated && doc && doc.version !== d.validated.version && <p class="small muted" style="margin:0">Version validée conservée : v{d.validated.version}.</p>}
      {err && <span class="small" style="color:var(--alert)">{err}</span>}
    </section>
  );
}

function copy(text: string) { void navigator.clipboard?.writeText(text); }

function StepAnalyse({ data, reload }: { data: Full; reload: () => void }) {
  const p = data.prospect;
  const sortie = data.docs.analyse.validated?.content?.messageSortie as string | null | undefined;
  return (
    <div style="display:flex;flex-direction:column;gap:14px">
      <DocPanel data={data} type="analyse" reload={reload} />
      {p.verdict === 'disqualifie' && (
        <div class="card" style="display:flex;flex-direction:column;gap:8px">
          <strong>Disqualifié</strong>
          {sortie && <><div class="small" style="white-space:pre-line">{sortie}</div><div><button class="ghost-btn" onClick={() => copy(sortie)}>Copier le message de sortie</button></div></>}
          {!p.forceContinue
            ? <div><button class="ghost-btn" onClick={async () => { await api(`/agence/prospects/${p.id}`, { method: 'PATCH', body: JSON.stringify({ forceContinue: true }) }); reload(); }}>Forcer la suite (c'est vous qui tranchez)</button></div>
            : <span class="small muted">Suite forcée par vous.</span>}
        </div>
      )}
    </div>
  );
}

function StepPlan({ data, reload }: { data: Full; reload: () => void }) {
  const p = data.prospect;
  const [research, setResearch] = useState(p.marketResearch ?? '');
  const [loom, setLoom] = useState({ url: p.loomUrl ?? '', on: p.loomSentOn ?? '' });
  const save = async (body: Record<string, unknown>) => { await api(`/agence/prospects/${p.id}`, { method: 'PATCH', body: JSON.stringify(body) }); reload(); };
  const script = data.docs.script_loom.validated?.content ?? data.docs.script_loom.latest?.content;
  return (
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="card" style="display:flex;flex-direction:column;gap:8px">
        <label class="field">Recherche marché (collée par vous ; le plan s'en sert si elle est remplie)<textarea rows={4} value={research} onInput={(e) => setResearch((e.target as HTMLTextAreaElement).value)} /></label>
        {research !== (p.marketResearch ?? '') && <div><button class="ghost-btn" onClick={() => save({ marketResearch: research })}>Enregistrer</button></div>}
      </div>
      <DocPanel data={data} type="plan" reload={reload} />
      <DocPanel data={data} type="script_loom" reload={reload}>
        {script?.messageEmail && (
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="ghost-btn small" onClick={() => copy(`${script.messageEmail.objet}\n\n${String(script.messageEmail.corps).replaceAll('[LIEN LOOM]', loom.url || '[LIEN LOOM]')}`)}>Copier l'email</button>
            <button class="ghost-btn small" onClick={() => copy(String(script.messageSms ?? '').replaceAll('[LIEN LOOM]', loom.url || '[LIEN LOOM]'))}>Copier le SMS</button>
          </div>
        )}
      </DocPanel>
      <div class="card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
        <label class="field">Lien du Loom<input type="url" value={loom.url} onInput={(e) => setLoom({ ...loom, url: (e.target as HTMLInputElement).value })} placeholder="https://www.loom.com/share/…" /></label>
        <label class="field">Envoyé le<input type="date" value={loom.on} onInput={(e) => setLoom({ ...loom, on: (e.target as HTMLInputElement).value })} /></label>
        <button class="ghost-btn" onClick={() => save({ loomUrl: loom.url, loomSentOn: loom.on })}>Enregistrer</button>
        <span class="small muted">L'espace n'envoie rien : copiez le message, envoyez-le vous-même.</span>
      </div>
    </div>
  );
}

function StepR2({ data, reload }: { data: Full; reload: () => void }) {
  const p = data.prospect;
  const { me } = useSession();
  const [offer, setOffer] = useState({ text: p.offerText ?? '', price: p.offerPrice ?? '' });
  const [out, setOut] = useState({ outcome: 'signe', reason: '', amount: '', clientId: p.clientId ?? '' });
  const [msg, setMsg] = useState<string | null>(null);
  const save = async (body: Record<string, unknown>) => { await api(`/agence/prospects/${p.id}`, { method: 'PATCH', body: JSON.stringify(body) }); reload(); };
  const ressource = data.docs.pitch_r2.validated?.content?.ressourceAvantR2;
  return (
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
        <label class="field">Date et heure du R2<input type="datetime-local" value={toLocalInput(data.r2?.scheduledAt ?? null)}
          onChange={async (e) => { await api(`/agence/prospects/${p.id}/calls/r2`, { method: 'PATCH', body: JSON.stringify({ scheduledAt: fromLocalInput((e.target as HTMLInputElement).value) }) }); reload(); }} /></label>
        <a class="btn" href={`/agence/prospects/${p.id}?mode=appel&etape=4`}>Mode en appel</a>
        {ressource?.titre && <span class="small">À envoyer avant le R2 : <strong>{ressource.titre}</strong> — {ressource.pourquoi}</span>}
      </div>
      <div class="card" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:10px">
        <label class="field">L'offre pour ce prospect (saisie par vous)<textarea rows={3} value={offer.text} onInput={(e) => setOffer({ ...offer, text: (e.target as HTMLTextAreaElement).value })} /></label>
        <label class="field">Le prix (saisi par vous — jamais proposé par Claude)<input value={offer.price} onInput={(e) => setOffer({ ...offer, price: (e.target as HTMLInputElement).value })} /></label>
        <div><button class="ghost-btn" onClick={() => save({ offerText: offer.text, offerPrice: offer.price })}>Enregistrer l'offre</button></div>
      </div>
      <DocPanel data={data} type="pitch_r2" reload={reload} />
      <div class="card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
        <label class="field">Issue
          <select value={out.outcome} onChange={(e) => setOut({ ...out, outcome: (e.target as HTMLSelectElement).value })}><option value="signe">Signé</option><option value="perdu">Perdu</option><option value="a_relancer">À relancer</option></select>
        </label>
        <label class="field">Motif<input value={out.reason} onInput={(e) => setOut({ ...out, reason: (e.target as HTMLInputElement).value })} /></label>
        {out.outcome === 'signe' && <label class="field">Montant signé (€ HT)<input inputMode="decimal" value={out.amount} onInput={(e) => setOut({ ...out, amount: (e.target as HTMLInputElement).value })} /></label>}
        {out.outcome === 'signe' && (
          <label class="field">Client créé dans l'espace
            <select value={out.clientId} onChange={(e) => setOut({ ...out, clientId: (e.target as HTMLSelectElement).value })}><option value="">— pas encore —</option>{me.clients.map((c) => <option value={c.id}>{c.name}</option>)}</select>
          </label>
        )}
        <button class="btn" onClick={async () => {
          setMsg(null);
          try {
            await api(`/agence/prospects/${p.id}/outcome`, { method: 'POST', body: JSON.stringify({ outcome: out.outcome, reason: out.reason, amountCents: out.amount ? Math.round(Number(out.amount.replace(',', '.')) * 100) : null }) });
            if (out.outcome === 'signe' && out.clientId !== (p.clientId ?? '')) await api(`/agence/prospects/${p.id}`, { method: 'PATCH', body: JSON.stringify({ clientId: out.clientId || null }) });
            setMsg('Issue enregistrée.'); reload();
          } catch (x) { setMsg((x as ApiError).message); }
        }}>Enregistrer l'issue</button>
        {msg && <span class="small">{msg}</span>}
        <span class="small muted">À la signature, créez le client à la main (fiche client) : rien du R1 n'est copié dans son onboarding.</span>
      </div>
    </div>
  );
}

/** Mode « en appel » : la trame (étape 1) ou le pitch (étape 4) en grand, saisie à côté, enregistrement à chaque frappe. */
function CallMode({ data, step, reload }: { data: Full; step: 1 | 4; reload: () => void }) {
  const p = data.prospect;
  const pitch = data.docs.pitch_r2.validated?.content ?? data.docs.pitch_r2.latest?.content;
  const r2 = useAutosave(`/agence/prospects/${p.id}/calls/r2`);
  const [r2notes, setR2notes] = useState<string>(data.r2?.notes?._libre ?? '');
  return (
    <div style="display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <h1 style="margin:0">{p.name} · {step === 1 ? 'R1' : 'R2'} en cours</h1>
        <a class="ghost-btn" style="margin-left:auto" href={`/agence/prospects/${p.id}?etape=${step}`}>Quitter le mode en appel</a>
      </div>
      {step === 1 ? <Trame data={data} big onFigures={reload} /> : (
        <div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:14px">
          <div class="card" style="font-size:18px;line-height:1.55">
            {!pitch ? <p>Pas encore de pitch : demandez-le dans l'onglet R2.</p> : (
              <>
                <h2>1. Récap</h2><JsonView v={pitch.recap} missing={new Set()} />
                <h2>2. Le plan</h2><ol>{(pitch.plan ?? []).map((x: string) => <li>{x}</li>)}</ol>
                <h2>3. Objections</h2><JsonView v={pitch.objections} missing={new Set()} />
                <h2>4. L'offre et le prix</h2><p style="white-space:pre-line">{p.offerText || '— offre non saisie —'}</p><p><strong>{p.offerPrice || '— prix non saisi —'}</strong></p>
                <h2>5. Question de clôture</h2><p>{pitch.questionCloture}</p>
                <h2>6. À creuser</h2><ul>{(pitch.pointsACreuser ?? []).map((x: string) => <li>{x}</li>)}</ul>
              </>
            )}
          </div>
          <div class="card" style="display:flex;flex-direction:column;gap:8px">
            <div class="label">Coût maximum d'un rendez-vous</div>
            <div class="kpi-value">{data.cost.value === null ? '—' : formatEuros(data.cost.value * 100)}</div>
            <label class="field">Notes du R2 ({r2.state === 'saving' ? 'enregistrement…' : r2.state === 'saved' ? 'enregistré' : 'enregistrement automatique'})
              <textarea rows={16} value={r2notes} onInput={(e) => { const v = (e.target as HTMLTextAreaElement).value; setR2notes(v); r2.set('_libre', v); }} />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Réglages ─────────────────────────────────────────────────────────────────

interface Settings { template: { version: number; blocks: TemplateBlock[] }; templateVersions: { version: number; created_at: string }[]; ghlClientId: string | null; clients: { id: string; name: string }[]; caseStudies: { id: string; client: string; target: string | null; vertical: string | null; figures: string | null; url: string | null }[]; margin: number }

export function ProspectSettingsScreen() {
  const { data, error, reload } = useApi<Settings>('/agence/prospects-reglages', []);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  return <SettingsForm key={data.template.version} data={data} reload={reload} />;
}

function SettingsForm({ data, reload }: { data: Settings; reload: () => void }) {
  const [margin, setMargin] = useState(String(Math.round(data.margin * 100)));
  const [cases, setCases] = useState(data.caseStudies);
  const [blocks, setBlocks] = useState<TemplateBlock[]>(data.template.blocks);
  const [msg, setMsg] = useState<string | null>(null);
  async function put(body: Record<string, unknown>, ok: string) {
    setMsg(null);
    try { await api('/agence/prospects-reglages', { method: 'PUT', body: JSON.stringify(body) }); setMsg(ok); reload(); } catch (x) { setMsg((x as ApiError).message); }
  }
  const setCase = (i: number, k: string, v: string) => setCases(cases.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  const setBlock = (i: number, patch: Partial<TemplateBlock>) => setBlocks(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  return (
    <>
      <PageHead a="Prospects" b="réglages" right={<a class="ghost-btn" href="/agence/prospects">← Prospects</a>} />
      {msg && <p class="small section">{msg}</p>}
      <section class="card section" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
        <label class="field">GoHighLevel qui porte vos R1 (rendez-vous à venir)
          <select value={data.ghlClientId ?? ''} onChange={(e) => put({ ghlClientId: (e.target as HTMLSelectElement).value || null }, 'GoHighLevel des R1 enregistré.')}>
            <option value="">— aucun —</option>{data.clients.map((c) => <option value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <span class="small muted">Lecture seule : les rendez-vous viennent de la synchro de ce client, rien n'est écrit dans GoHighLevel.</span>
      </section>
      <section class="card section" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
        <label class="field">Marge acceptable (%) — coût max. d'un RDV = ticket × durée × marge × closing<input inputMode="decimal" value={margin} onInput={(e) => setMargin((e.target as HTMLInputElement).value)} /></label>
        <button class="ghost-btn" onClick={() => put({ margin: Number(margin.replace(',', '.')) / 100 }, 'Marge enregistrée.')}>Enregistrer</button>
      </section>
      <section class="card section" style="display:flex;flex-direction:column;gap:10px">
        <h3 style="margin:0">Cas clients cités en preuve</h3>
        <p class="small muted" style="margin:0">Les chiffres officiels sont saisis une fois ici ; Claude ne cite que ceux-là. Une case vide reste vide.</p>
        {cases.map((c, i) => (
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(180px,100%),1fr));gap:8px;align-items:end">
            <label class="field">Client<input value={c.client} onInput={(e) => setCase(i, 'client', (e.target as HTMLInputElement).value)} /></label>
            <label class="field">Cible<input value={c.target ?? ''} onInput={(e) => setCase(i, 'target', (e.target as HTMLInputElement).value)} /></label>
            <label class="field">Verticale<input value={c.vertical ?? ''} onInput={(e) => setCase(i, 'vertical', (e.target as HTMLInputElement).value)} /></label>
            <label class="field">Chiffres officiels<input value={c.figures ?? ''} onInput={(e) => setCase(i, 'figures', (e.target as HTMLInputElement).value)} /></label>
            <label class="field">Lien<input value={c.url ?? ''} onInput={(e) => setCase(i, 'url', (e.target as HTMLInputElement).value)} /></label>
            <button class="ghost-btn small" onClick={() => setCases(cases.filter((_, j) => j !== i))}>Retirer</button>
          </div>
        ))}
        <div style="display:flex;gap:8px"><button class="ghost-btn" onClick={() => setCases([...cases, { id: '', client: '', target: null, vertical: null, figures: null, url: null }])}>+ Cas client</button>
          <button class="btn" onClick={() => put({ caseStudies: cases }, 'Cas clients enregistrés.')}>Enregistrer les cas clients</button></div>
      </section>
      <section class="card section" style="display:flex;flex-direction:column;gap:12px">
        <h3 style="margin:0">Trame du R1 · version {data.template.version}</h3>
        <p class="small muted" style="margin:0">Enregistrer crée une nouvelle version : les fiches déjà menées gardent la leur. Les champs de saisie (et les chiffres qu'ils alimentent) restent ceux de la trame par défaut.</p>
        {blocks.map((b, i) => (
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:8px">
            <label class="field">Temps<input value={b.time} onInput={(e) => setBlock(i, { time: (e.target as HTMLInputElement).value })} /></label>
            <label class="field">Titre<input value={b.title} onInput={(e) => setBlock(i, { title: (e.target as HTMLInputElement).value })} /></label>
            <label class="field">Objectif<input value={b.goal} onInput={(e) => setBlock(i, { goal: (e.target as HTMLInputElement).value })} /></label>
            <label class="field" style="grid-column:1/-1">Questions (une par ligne)<textarea rows={Math.max(3, b.questions.length + 1)} value={b.questions.join('\n')}
              onInput={(e) => setBlock(i, { questions: (e.target as HTMLTextAreaElement).value.split('\n').map((x) => x.trim()).filter(Boolean) })} /></label>
          </div>
        ))}
        <div><button class="btn" onClick={() => put({ template: blocks }, 'Nouvelle version de la trame enregistrée.')}>Enregistrer une nouvelle version</button></div>
        <p class="small muted" style="margin:0">Versions : {data.templateVersions.map((v) => `v${v.version} (${formatDate(v.created_at)})`).join(' · ') || 'v1 (par défaut)'}</p>
      </section>
    </>
  );
}
