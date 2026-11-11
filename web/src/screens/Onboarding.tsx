import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  ONBOARDING_SECTIONS, formatDate, formatDateTime, isAnswered, missingRequired, sectionProgress, type Question,
} from '@obsidian/domain';
import { ApiError, api, useApi } from '../api.ts';
import { useSession } from '../session.ts';
import { AgencyNote, ErrorBox, Loading, PageHead } from '../components/ui.tsx';

interface OnboardingData {
  locked: boolean;
  submittedAt: string | null;
  editableSections: string[];
  reopenings: { id: string; section: string; questionKey: string | null; message: string; createdAt: string }[];
  answers: Record<string, { value: string | null; updatedAt: string }>;
  changesAfterSubmit?: Record<string, { previous: string | null; at: string }>;
}

type SaveState = { state: 'saving' | 'saved' | 'error'; message?: string };

export function OnboardingScreen({ clientId }: { clientId: string }) {
  const { data, error, loading, reload } = useApi<OnboardingData>(`/clients/${clientId}/onboarding`);
  const { me, view } = useSession();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saves, setSaves] = useState<Record<string, SaveState>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const timers = useRef<Record<string, number>>({});

  useEffect(() => {
    if (data) setValues(Object.fromEntries(Object.entries(data.answers).map(([k, v]) => [k, v.value ?? ''])));
  }, [data]);

  const isClient = me.user.role === 'client';
  const editable = new Set(data?.editableSections ?? []);
  const scope = data ? (data.locked ? [...editable] : ONBOARDING_SECTIONS.map((s) => s.key)) : [];
  const missing = useMemo(() => missingRequired(values, scope), [values, data]);

  function change(q: Question, value: string) {
    setValues((v) => ({ ...v, [q.key]: value }));
    clearTimeout(timers.current[q.key]);
    timers.current[q.key] = window.setTimeout(() => persist(q, value), q.type === 'choice' || q.type === 'multi' ? 0 : 700);
  }

  async function persist(q: Question, value: string) {
    setSaves((s) => ({ ...s, [q.key]: { state: 'saving' } }));
    try {
      await api(`/clients/${clientId}/onboarding/answers/${q.key}`, { method: 'PUT', body: JSON.stringify({ value }) });
      setSaves((s) => ({ ...s, [q.key]: { state: 'saved' } }));
    } catch (e) {
      setSaves((s) => ({ ...s, [q.key]: { state: 'error', message: (e as Error).message } }));
    }
  }

  async function submit() {
    setSubmitError(null);
    const isComplement = data?.locked;
    if (!confirm(isComplement
      ? 'Envoyer votre complément ? La section repassera en lecture seule.'
      : 'Envoyer le formulaire ? Il passera en lecture seule ; Obsidian Partners pourra rouvrir une section si un complément est nécessaire.')) return;
    try {
      await api(`/clients/${clientId}/onboarding/submit`, { method: 'POST' });
      reload();
    } catch (e) {
      setSubmitError((e as ApiError).message);
    }
  }

  const reopenedKeys = new Set((data?.reopenings ?? []).map((r) => r.questionKey).filter(Boolean));

  return (
    <>
      <PageHead
        a="Votre" b="onboarding"
        sub="Tout ce dont nous avons besoin pour écrire votre offre, votre page, votre VSL et vos publicités. Chaque réponse est enregistrée automatiquement : vous pouvez reprendre plus tard."
      />
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading />}
      {data && (
        <>
          {data.locked && data.reopenings.length === 0 && (
            <div class="banner accent" role="status">
              <span><strong>Formulaire envoyé</strong> le {formatDate(data.submittedAt)}. Il est en lecture seule.</span>
            </div>
          )}
          {data.reopenings.map((r) => (
            <a class="banner warn" href={`#section-${r.section}`} style="color:inherit">
              <span><strong>Complément demandé</strong> · {ONBOARDING_SECTIONS.find((s) => s.key === r.section)?.title} — {r.message}</span>
              <span class="mono small">{formatDate(r.createdAt)}</span>
            </a>
          ))}

          <div class="onb-layout">
            <nav class="onb-nav card" aria-label="Sections du formulaire">
              {ONBOARDING_SECTIONS.map((s, i) => {
                const p = sectionProgress(s, values);
                return (
                  <a href={`#section-${s.key}`} class="onb-nav-item" onClick={(e) => { e.preventDefault(); document.getElementById(`section-${s.key}`)?.scrollIntoView({ behavior: 'smooth' }); }}>
                    <span class="small">{String(i + 1).padStart(2, '0')} · {s.title}</span>
                    <span class="progress" aria-hidden="true"><div style={{ width: `${(p.done / p.total) * 100}%` }} /></span>
                    <span class="mono small muted">{p.done}/{p.total}{p.complete ? ' · complet' : ''}{editable.has(s.key) && data.locked ? ' · rouverte' : ''}</span>
                  </a>
                );
              })}
            </nav>

            <div>
              {ONBOARDING_SECTIONS.map((s, i) => {
                const canEdit = isClient && editable.has(s.key);
                return (
                  <section id={`section-${s.key}`} class="section card onb-section">
                    <h2 class="section-title"><span class="num">{String(i + 1).padStart(2, '0')} ·</span> {s.title}</h2>
                    {s.questions.map((q) => (
                      <QuestionField
                        q={q} value={values[q.key] ?? ''} canEdit={canEdit} save={saves[q.key]}
                        highlight={reopenedKeys.has(q.key)}
                        change={data.changesAfterSubmit?.[q.key]}
                        onChange={(v) => change(q, v)}
                      />
                    ))}
                    {me.user.role === 'agence' && view === 'agence' && data.locked && (
                      <ReopenForm clientId={clientId} sectionKey={s.key} questions={s.questions} onDone={reload} />
                    )}
                  </section>
                );
              })}

              {isClient && editable.size > 0 && (
                <div class="card section" style="display:flex;flex-direction:column;gap:10px">
                  {missing.length > 0
                    ? <p class="small" style="margin:0;color:var(--warn)">{missing.length} question{missing.length > 1 ? 's' : ''} obligatoire{missing.length > 1 ? 's' : ''} sans réponse. <a href={`#q-${missing[0].key}`}>Aller à la première →</a></p>
                    : <p class="small" style="margin:0;color:var(--accent)">Toutes les questions obligatoires sont remplies.</p>}
                  {submitError && <div class="banner alert" role="alert">{submitError}</div>}
                  <button class="btn" disabled={missing.length > 0} onClick={submit}>{data.locked ? 'Envoyer le complément' : 'Envoyer le formulaire'}</button>
                </div>
              )}
              {!isClient && view === 'agence' && !data.submittedAt && (
                <AgencyNote>le client n'a pas encore envoyé son formulaire ; les réponses ci-dessus sont des brouillons.</AgencyNote>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function QuestionField({ q, value, canEdit, save, highlight, change, onChange }: {
  q: Question; value: string; canEdit: boolean; save?: SaveState; highlight: boolean;
  change?: { previous: string | null; at: string }; onChange: (v: string) => void;
}) {
  const id = `q-${q.key}`;
  const answered = isAnswered(q, value);
  const display = q.type === 'multi' ? (() => { try { return (JSON.parse(value || '[]') as string[]).join(', '); } catch { return value; } })() : value;
  return (
    <div class={`onb-q ${highlight ? 'highlight' : ''}`} id={id}>
      <label for={`${id}-input`} class="onb-label">
        {q.num !== null && <span class="mono muted">{q.num}. </span>}
        {q.label}
        {q.required && <span style="color:var(--alert)" aria-hidden="true"> *</span>}
        {q.required && <span class="sr-only"> (obligatoire)</span>}
        {q.added && <span class="pill neutral" style="margin-left:8px;font-size:10px">Nouveau</span>}
      </label>
      {q.hint && <div class="small muted">{q.hint}</div>}

      {!canEdit ? (
        <div class={`onb-readonly ${answered ? '' : 'muted'}`}>{answered ? <>{display}{q.unit ? ` ${q.unit}` : ''}</> : 'Pas encore de réponse'}</div>
      ) : q.type === 'long' ? (
        <textarea id={`${id}-input`} rows={4} value={value} onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)} />
      ) : q.type === 'choice' ? (
        <div class="onb-options" role="radiogroup" aria-labelledby={id}>
          {q.options!.map((o) => (
            <label><input type="radio" name={id} checked={value === o} onChange={() => onChange(o)} /> {o}</label>
          ))}
        </div>
      ) : q.type === 'multi' ? (
        <div class="onb-options">
          {q.options!.map((o) => {
            let arr: string[] = [];
            try { arr = JSON.parse(value || '[]'); } catch { arr = []; }
            return (
              <label><input type="checkbox" checked={arr.includes(o)}
                onChange={(e) => onChange(JSON.stringify((e.target as HTMLInputElement).checked ? [...arr, o] : arr.filter((x) => x !== o)))} /> {o}</label>
            );
          })}
        </div>
      ) : (
        <div style="display:flex;align-items:center;gap:8px">
          <input id={`${id}-input`} type="text" inputMode={q.type === 'number' ? 'decimal' : undefined} value={value}
            style={q.type === 'number' ? 'max-width:160px' : ''} onInput={(e) => onChange((e.target as HTMLInputElement).value)} />
          {q.unit && <span class="small muted">{q.unit}</span>}
        </div>
      )}

      <div class="mono small" aria-live="polite" style="min-height:18px">
        {save?.state === 'saving' && <span class="muted">Enregistrement…</span>}
        {save?.state === 'saved' && <span style="color:var(--accent)">Enregistré</span>}
        {save?.state === 'error' && <span style="color:var(--alert)">Non enregistré : {save.message}</span>}
      </div>
      {change && (
        <div class="small" style="color:var(--agency)">
          Modifié après l'envoi ({formatDateTime(change.at)}) · avant : « {change.previous ?? 'vide'} » — revoir les livrables concernés.
        </div>
      )}
    </div>
  );
}

function ReopenForm({ clientId, sectionKey, questions, onDone }: { clientId: string; sectionKey: string; questions: Question[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [questionKey, setQuestionKey] = useState('');
  const [message, setMessage] = useState('');
  const [err, setErr] = useState<string | null>(null);
  if (!open) return <button class="ghost-btn" onClick={() => setOpen(true)}>Rouvrir cette section pour un complément…</button>;
  async function send() {
    setErr(null);
    try {
      await api(`/clients/${clientId}/onboarding/reopen`, { method: 'POST', body: JSON.stringify({ section: sectionKey, questionKey: questionKey || null, message }) });
      setOpen(false); setMessage(''); onDone();
    } catch (e) { setErr((e as Error).message); }
  }
  return (
    <div class="card" style="border-color:var(--agency);display:flex;flex-direction:column;gap:8px;margin-top:8px">
      <span class="label" style="color:var(--agency)">Demander un complément</span>
      <select class="client-select" value={questionKey} onChange={(e) => setQuestionKey((e.target as HTMLSelectElement).value)} aria-label="Question à mettre en évidence">
        <option value="">Toute la section</option>
        {questions.map((q) => <option value={q.key}>{q.num ? `${q.num}. ` : ''}{q.label.slice(0, 80)}</option>)}
      </select>
      <textarea rows={3} placeholder="Message explicite pour le client" value={message} onInput={(e) => setMessage((e.target as HTMLTextAreaElement).value)} aria-label="Message pour le client" />
      {err && <div class="small" style="color:var(--alert)">{err}</div>}
      <div style="display:flex;gap:8px">
        <button class="btn" onClick={send} disabled={!message.trim()}>Rouvrir</button>
        <button class="ghost-btn" onClick={() => setOpen(false)}>Annuler</button>
      </div>
    </div>
  );
}
