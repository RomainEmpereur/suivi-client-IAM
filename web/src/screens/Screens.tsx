import { useState } from 'preact/hooks';
import {
  DELIVERABLE_STATUS_LABEL, DELIVERABLE_TYPE_LABEL, PHASE_STATE_LABEL, formatDate, formatDateTime, formatEuros, formatInt,
  type AppointmentCounter, type DeliverableStatus, type PhaseState,
} from '@obsidian/domain';
import { api, useApi } from '../api.ts';
import { useSession } from '../session.ts';
import { Counter } from '../components/Counter.tsx';
import { CONNECTION_LABEL, type ClientOverview } from '../components/ClientAlerts.tsx';
import {
  AgencyNote, DataTable, EmptyState, ErrorBox, Loading, PageHead, Pill, SEVERITY_EDGE, SEVERITY_LABEL, SectionTitle, Segmented,
} from '../components/ui.tsx';

/** undefined tant que l'aperçu n'est pas chargé (ou refusé) : on n'affiche alors aucune date. */
const useLastSync = (clientId: string) => { const d = useApi<ClientOverview>(`/clients/${clientId}`).data; return d ? d.lastSync : undefined; };

// ─────────────────────────── Infrastructure (§10) ───────────────────────────

interface Infra {
  phases: { key: string; label: string; state: PhaseState; startedAt: string | null; blocker: string | null }[];
  deliverables: { id: string; type: string; phase: string; title: string; status: DeliverableStatus; version?: number; externalUrl?: string | null; clientSummary?: string | null; published: boolean; publishedAt?: string | null }[];
  tasks: Record<'agence' | 'client', Task[]>;
}
interface Task { id: string; label: string; description: string | null; status: string; dueDate: string | null; guideId: string | null; overdue: boolean; blocking: boolean }

export function InfrastructureScreen({ clientId }: { clientId: string }) {
  const { data, error, loading, reload } = useApi<Infra>(`/clients/${clientId}/infrastructure`);
  const { me, view } = useSession();
  const lastSync = useLastSync(clientId);
  const canTick = (owner: 'agence' | 'client') => (me.user.role === 'client' && owner === 'client') || (me.user.role === 'agence' && view === 'agence');

  async function toggle(t: Task) {
    await api(`/clients/${clientId}/tasks/${t.id}`, { method: 'PATCH', body: JSON.stringify({ status: t.status === 'fait' ? 'a_faire' : 'fait' }) });
    reload();
  }
  async function publish(id: string) {
    if (!confirm('Publier ce livrable ? Il deviendra visible par le client.')) return;
    await api(`/clients/${clientId}/deliverables/${id}/publish`, { method: 'POST', body: JSON.stringify({ confirm: true }) });
    reload();
  }

  const current = data?.phases.find((p) => p.state === 'en_cours');
  return (
    <>
      <PageHead a="Votre" b="infrastructure" lastSync={lastSync} sub="Ce qui est livré, ce qui est en cours, et ce qu'on attend de vous." />
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading />}
      {data && (
        <>
          <div class="card">
            <ol class="timeline" style="list-style:none;margin:0;padding:0">
              {data.phases.map((p, i) => (
                <li class={`phase ${p.state}`} aria-current={p.state === 'en_cours' ? 'step' : undefined}>
                  <span class="label">{String(i + 1).padStart(2, '0')} · {PHASE_STATE_LABEL[p.state]}</span>
                  <span class="phase-name">{p.label}</span>
                </li>
              ))}
            </ol>
            {current && (
              <p class="small" style="margin:14px 0 0">
                <strong>En cours : {current.label}</strong>{current.startedAt && <span class="muted"> · depuis le {formatDate(current.startedAt)}</span>}
                {current.blocker && <span style="color:var(--warn)"> · bloqué : {current.blocker}</span>}
              </p>
            )}
          </div>

          <div class="section" style="display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:20px" data-stack>
            <div>
              <SectionTitle a="Les" b="livrables" />
              {data.deliverables.length === 0 && <EmptyState title="Aucun livrable pour le moment">Ils apparaissent ici au fil de la production.</EmptyState>}
              <div class="grid grid-2 stack">
                {data.deliverables.map((d) => (
                  <article class="card edge deliverable" style={{ '--edge': d.status === 'valide' ? 'var(--accent)' : d.status === 'a_relire' ? 'var(--warn)' : 'var(--border)' }}>
                    <div class="kpi-row">
                      <span class="label">{DELIVERABLE_TYPE_LABEL[d.type] ?? d.type}{d.version && d.version > 1 ? ` · v${d.version}` : ''}</span>
                      <Pill kind={d.status === 'valide' ? 'tenu' : d.status === 'a_relire' ? 'surveiller' : 'neutral'}>{DELIVERABLE_STATUS_LABEL[d.status]}</Pill>
                    </div>
                    <h3>{d.title}</h3>
                    {d.clientSummary && <p class="small muted" style="margin:0">{d.clientSummary}</p>}
                    {d.publishedAt && <span class="mono small muted">Publié le {formatDate(d.publishedAt)}</span>}
                    {d.externalUrl && d.status !== 'en_preparation'
                      ? <a class="btn" href={d.externalUrl} target="_blank" rel="noopener noreferrer">Ouvrir le livrable ↗</a>
                      : <button class="btn" disabled>Contenu disponible à la publication</button>}
                    {view === 'agence' && me.user.role === 'agence' && !d.published && (
                      <>
                        <button class="ghost-btn" onClick={() => publish(d.id)}>Publier pour le client…</button>
                        <AgencyNote>ce livrable n'est pas publié ; le client voit seulement « En préparation ».</AgencyNote>
                      </>
                    )}
                  </article>
                ))}
              </div>
            </div>
            <div>
              <SectionTitle a="Qui fait" b="quoi" />
              <TaskColumn title="Ce que vous faites" tasks={data.tasks.client} canTick={canTick('client')} onToggle={toggle} clientId={clientId} />
              <div style="height:12px" />
              <TaskColumn title="Ce qu'on fait" tasks={data.tasks.agence} canTick={canTick('agence')} onToggle={toggle} clientId={clientId} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

function TaskColumn({ title, tasks, canTick, onToggle, clientId }: { title: string; tasks: Task[]; canTick: boolean; onToggle: (t: Task) => void; clientId: string }) {
  return (
    <div class="card">
      <div class="label">{title}</div>
      {tasks.length === 0 && <p class="muted small">Rien pour le moment.</p>}
      {tasks.map((t) => (
        <div class={`task ${t.status === 'fait' ? 'done' : ''}`}>
          <input type="checkbox" checked={t.status === 'fait'} disabled={!canTick} onChange={() => onToggle(t)} aria-label={t.label} />
          <div>
            <div class="task-label">{t.label}{t.blocking && t.status !== 'fait' ? <span class="mono small" style="color:var(--warn)"> · bloquant</span> : null}</div>
            <div class="small muted">
              {t.dueDate && <span class={t.overdue ? 'overdue' : ''}>{t.overdue ? 'En retard · ' : 'Échéance · '}{formatDate(t.dueDate)}</span>}
              {t.status === 'en_cours' && ' · en cours'}
              {t.status === 'bloque' && ' · bloqué'}
              {t.guideId && <> · <a href={`/c/${clientId}/guides#${t.guideId}`}>Voir le guide</a></>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────── Connexions (§11) ───────────────────────────

const CONN_STATE: Record<string, { label: string; kind: string }> = {
  ok: { label: 'Opérationnel', kind: 'ok' }, degrade: { label: 'Dégradé', kind: 'degrade' },
  casse: { label: 'En panne', kind: 'casse' }, non_configure: { label: 'Non configuré', kind: 'non_configure' },
};

export function ConnectionsScreen({ clientId }: { clientId: string }) {
  const { data, error } = useApi<{ connections: { id: string; type: string; state: string; lastCheckedAt: string | null; clientAction: string | null; guideId: string | null; errorMessage?: string | null; tokenExpiresAt?: string | null; tokenConfigured?: boolean }[] }>(`/clients/${clientId}/connections`);
  const { view, me } = useSession();
  const lastSync = useLastSync(clientId);
  const order = ['meta', 'pixel', 'ghl', 'calendrier', 'domaine', 'mailing', 'formulaire'];
  return (
    <>
      <PageHead a="Vos" b="connexions" lastSync={lastSync} sub="Si une connexion est en panne, la mesure l'est aussi : vérifiez ici avant de conclure à de mauvais résultats." />
      {error && <ErrorBox error={error} />}
      {data && (
        <div class="grid" style="gap:10px">
          {[...data.connections].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type)).map((c) => {
            const s = CONN_STATE[c.state];
            return (
              <div class="card edge" style={{ '--edge': c.state === 'ok' ? 'var(--accent)' : c.state === 'degrade' ? 'var(--warn)' : c.state === 'casse' ? 'var(--alert)' : 'var(--border)' }}>
                <div class="kpi-row">
                  <strong style="font-weight:500">{CONNECTION_LABEL[c.type] ?? c.type}</strong>
                  <Pill kind={s.kind}>{s.label}</Pill>
                </div>
                <div class="mono small muted">Dernier contrôle : {formatDateTime(c.lastCheckedAt)}</div>
                {c.clientAction && c.state !== 'ok' && <p class="small" style="margin:8px 0 0">{c.clientAction}{c.guideId && <> <a href={`/c/${clientId}/guides#${c.guideId}`}>Voir le guide →</a></>}</p>}
                {view === 'agence' && (
                  <div class="small" style="margin-top:8px;color:var(--agency)">
                    {c.errorMessage && <div>Erreur technique : {c.errorMessage}</div>}
                    <div>Jeton : {c.tokenConfigured ? 'configuré' : 'absent'}{c.tokenExpiresAt && ` · expire le ${formatDate(c.tokenExpiresAt)}`}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {view === 'agence' && me.user.role === 'agence' && <AgencyConnectionTools clientId={clientId} />}
    </>
  );
}

/** Vue agence : saisie des jetons (chiffrés, jamais réaffichés) et synchronisation manuelle (§13, §16). */
function AgencyConnectionTools({ clientId }: { clientId: string }) {
  const [type, setType] = useState<'ghl' | 'meta'>('ghl');
  const [token, setToken] = useState('');
  const [externalId, setExternalId] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: Event) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const r = await api<{ state: string; error: string | null }>(`/clients/${clientId}/connections/${type}/token`, { method: 'PUT', body: JSON.stringify({ token, externalId }) });
      setToken('');
      setMsg(r.state === 'ok' ? { ok: true, text: 'Jeton enregistré (chiffré) et connexion testée.' } : { ok: false, text: `Jeton enregistré, mais le test a échoué : ${r.error}` });
    } catch (x) { setMsg({ ok: false, text: (x as Error).message }); } finally { setBusy(false); }
  }
  async function sync() {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ result: { opportunities: number; appointments: number } }>(`/clients/${clientId}/sync`, { method: 'POST', body: '{}' });
      setMsg({ ok: true, text: `Synchronisation GHL terminée : ${r.result.opportunities} opportunités, ${r.result.appointments} rendez-vous lus.` });
    } catch (x) { setMsg({ ok: false, text: (x as Error).message }); } finally { setBusy(false); }
  }
  return (
    <div class="section card" style="border-color:var(--agency);display:flex;flex-direction:column;gap:10px">
      <span class="label" style="color:var(--agency)">Vue agence · jetons et synchronisation</span>
      <form class="date-range" onSubmit={save}>
        <select class="client-select" style="width:auto" value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value as 'ghl' | 'meta')} aria-label="Connexion">
          <option value="ghl">GoHighLevel</option>
          <option value="meta">Meta</option>
        </select>
        <input type="text" placeholder={type === 'ghl' ? 'Identifiant du sous-compte (location)' : 'act_… (compte publicitaire)'} value={externalId}
          onInput={(e) => setExternalId((e.target as HTMLInputElement).value)} aria-label="Identifiant externe" required />
        <input type="password" autocomplete="off" placeholder="Jeton (jamais réaffiché)" value={token}
          onInput={(e) => setToken((e.target as HTMLInputElement).value)} aria-label="Jeton" required style="background:var(--surface-2);border:1px solid var(--border);border-radius:7px;padding:5px 8px" />
        <button class="btn" type="submit" disabled={busy}>Enregistrer et tester</button>
      </form>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="ghost-btn" onClick={sync} disabled={busy}>Synchroniser GHL maintenant (30 derniers jours)</button>
        <span class="small muted">Synchronisation automatique chaque jour à 6 h (Paris).</span>
      </div>
      {msg && <div class="small" style={{ color: msg.ok ? 'var(--accent)' : 'var(--alert)' }} role="status">{msg.text}</div>}
    </div>
  );
}

// ─────────────────────────── Guides (§11) ───────────────────────────

export function GuidesScreen({ clientId }: { clientId: string }) {
  const { data, error } = useApi<{ guides: { id: string; title: string; kind: string; url: string | null; pinned: boolean; readAt: string | null; published?: boolean }[] }>(`/clients/${clientId}/guides`);
  const lastSync = useLastSync(clientId);
  const KIND: Record<string, string> = { pdf: 'PDF', video: 'Vidéo', page: 'Page' };
  return (
    <>
      <PageHead a="Les" b="guides" lastSync={lastSync} sub="Les procédures pas à pas. « Mettre à jour ses rendez-vous » est la plus importante : sans elle, le compteur ne peut pas avancer." />
      {error && <ErrorBox error={error} />}
      {data && (
        <div class="grid grid-3 stack">
          {data.guides.map((g) => (
            <article id={g.id} class="card edge deliverable" style={{ '--edge': g.published === false ? 'var(--agency)' : 'var(--border)' }}>
              <div class="kpi-row"><span class="label">{KIND[g.kind] ?? g.kind}{g.pinned ? ' · pour vous' : ''}</span>{g.readAt && <Pill kind="neutral">Lu</Pill>}</div>
              <h3>{g.title}</h3>
              {g.url && <a class="btn" href={g.url} target="_blank" rel="noopener noreferrer">Ouvrir ↗</a>}
              {g.published === false && <AgencyNote>ce guide est en brouillon, il n'est pas visible par le client.</AgencyNote>}
            </article>
          ))}
        </div>
      )}
    </>
  );
}

// ─────────────────────────── Rendez-vous (liste datée, §8 et §16 ; gestion, décision 0006) ───────────────────────────

const APPT_STATUS: Record<string, string> = { prevu: 'Prévu', annule: 'Annulé', honore: 'Honoré', absent: 'Absent' };

interface ApptItem {
  id: string; contact_name: string | null; booked_at: string; scheduled_at: string; status: string;
  counts_toward_target: number; exclusion_reason: string | null; origin: string; status_source: string; status_updated_at: string | null;
}

export function AppointmentsScreen({ clientId }: { clientId: string }) {
  const { data, error, reload } = useApi<{ counter: AppointmentCounter; appointments: ApptItem[] }>(`/clients/${clientId}/appointments`);
  const { me, view } = useSession();
  const lastSync = useLastSync(clientId);
  const [filter, setFilter] = useState<'tous' | 'a_renseigner' | 'a_venir'>('tous');
  const [err, setErr] = useState<string | null>(null);
  const canEdit = me.user.role === 'agence' && view === 'agence';
  const canAdd = me.user.role === 'client' || canEdit;
  const now = Date.now();
  const missing = (a: ApptItem) => a.status === 'prevu' && Date.parse(a.scheduled_at) < now;
  const rows = (data?.appointments ?? []).filter((a) =>
    filter === 'a_renseigner' ? missing(a) : filter === 'a_venir' ? Date.parse(a.scheduled_at) >= now && a.status === 'prevu' : true);
  const missingCount = (data?.appointments ?? []).filter(missing).length;

  async function patch(a: ApptItem, body: Record<string, unknown>) {
    setErr(null);
    try {
      await api(`/clients/${clientId}/appointments/${a.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      reload();
    } catch (e) { setErr((e as Error).message); }
  }
  function toggleCount(a: ApptItem) {
    if (a.counts_toward_target) {
      const reason = prompt('Motif de l\'exclusion du compteur (ex. hors cible, doublon, test) :');
      if (!reason?.trim()) return;
      patch(a, { countsTowardTarget: false, exclusionReason: reason.trim() });
    } else patch(a, { countsTowardTarget: true });
  }

  return (
    <>
      <PageHead a="Rendez-vous" b="datés" lastSync={lastSync} sub="La liste qui fonde le compteur contractuel. C'est la seule page nominative de l'espace." />
      {error && <ErrorBox error={error} />}
      {err && <div class="banner alert" role="alert">{err}</div>}
      {data && (
        <>
          {data.counter.windowStart && <Counter clientId={clientId} counter={data.counter} />}
          {missingCount > 0 && (
            <div class="banner warn">
              <span><strong>{missingCount} rendez-vous passé{missingCount > 1 ? 's' : ''} sans statut.</strong> {canEdit ? 'Indiquez s\'ils ont été honorés : sans cela, ils ne comptent pas.' : 'Obsidian Partners les renseigne ; tant que ce n\'est pas fait, ils ne comptent pas.'}</span>
              <button class="ghost-btn" onClick={() => setFilter('a_renseigner')}>Afficher</button>
            </div>
          )}
          <div class="section" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between">
            <Segmented label="Filtre" value={filter} onChange={setFilter} options={[
              { value: 'tous', label: `Tous (${data.appointments.length})` },
              { value: 'a_renseigner', label: `À renseigner (${missingCount})` },
              { value: 'a_venir', label: 'À venir' },
            ]} />
            {canAdd && <AddAppointment clientId={clientId} onDone={reload} />}
          </div>
          <div style="margin-top:12px">
            <DataTable
              caption="Rendez-vous"
              rows={rows}
              initialSort={{ key: 'scheduled', dir: 'desc' }}
              rowClass={(r) => (missing(r) ? 'warn' : '')}
              columns={[
                { key: 'contact', label: 'Contact', value: (r) => r.contact_name ?? '—' },
                { key: 'scheduled', label: 'Rendez-vous', value: (r) => r.scheduled_at, render: (r) => formatDateTime(r.scheduled_at) },
                { key: 'booked', label: 'Pris le', value: (r) => r.booked_at, render: (r) => formatDate(r.booked_at) },
                {
                  key: 'status', label: 'Statut', value: (r) => r.status,
                  render: (r) => canEdit ? (
                    <select class="client-select" style="width:auto;padding:4px 8px" value={r.status} aria-label={`Statut du rendez-vous de ${r.contact_name ?? 'ce contact'}`}
                      onChange={(e) => patch(r, { status: (e.target as HTMLSelectElement).value })}>
                      {Object.entries(APPT_STATUS).map(([k, l]) => (
                        <option value={k} disabled={(k === 'honore' || k === 'absent') && Date.parse(r.scheduled_at) > now}>{l}{k === 'prevu' && missing(r) ? ' — à renseigner' : ''}</option>
                      ))}
                    </select>
                  ) : missing(r) ? <span style="color:var(--warn)">Statut à renseigner</span> : APPT_STATUS[r.status],
                },
                {
                  key: 'counts', label: 'Compte dans les 30', value: (r) => (r.status === 'honore' && r.counts_toward_target ? 1 : 0),
                  render: (r) => (
                    <span style="display:inline-flex;gap:8px;align-items:center">
                      {!r.counts_toward_target ? <span class="muted">Exclu · {r.exclusion_reason}</span> : r.status === 'honore' ? <span style="color:var(--accent)">Oui</span> : 'Non'}
                      {canEdit && <button class="ghost-btn small" onClick={() => toggleCount(r)}>{r.counts_toward_target ? 'Exclure…' : 'Réintégrer'}</button>}
                    </span>
                  ),
                },
                {
                  key: 'source', label: 'Source', value: (r) => r.origin,
                  render: (r) => <span class="mono small muted">{r.origin === 'saisie' ? 'Saisi' : 'GHL'}{r.status_source === 'agence' ? ' · statut agence' : ''}</span>,
                },
              ]}
            />
          </div>
        </>
      )}
    </>
  );
}

function AddAppointment({ clientId, onDone }: { clientId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [when, setWhen] = useState('');
  const [err, setErr] = useState<string | null>(null);
  if (!open) return <button class="btn" onClick={() => setOpen(true)}>Ajouter un rendez-vous</button>;
  async function send(e: Event) {
    e.preventDefault(); setErr(null);
    try {
      // La saisie datetime-local est l'heure de Paris du navigateur ; on l'envoie en ISO.
      await api(`/clients/${clientId}/appointments`, { method: 'POST', body: JSON.stringify({ contactName: name, scheduledAt: new Date(when).toISOString() }) });
      setOpen(false); setName(''); setWhen(''); onDone();
    } catch (x) { setErr((x as Error).message); }
  }
  return (
    <form class="card date-range" onSubmit={send} style="padding:10px 12px">
      <input type="text" placeholder="Prénom N. du contact" value={name} required onInput={(e) => setName((e.target as HTMLInputElement).value)} aria-label="Contact" />
      <input type="datetime-local" value={when} required onInput={(e) => setWhen((e.target as HTMLInputElement).value)} aria-label="Date et heure" />
      <button class="btn" type="submit">Ajouter</button>
      <button class="ghost-btn" type="button" onClick={() => setOpen(false)}>Annuler</button>
      {err && <span class="small" style="color:var(--alert)">{err}</span>}
    </form>
  );
}

// ─────────────────────────── Pilotage (§9) : bloc 01 en lot 1 ───────────────────────────

interface Reco { id: string; date: string; severity: string; title: string; body: string; state: string; published?: boolean; internalNote?: string | null; repeatCount: number }

export function PilotageScreen({ clientId }: { clientId: string }) {
  const { data, error } = useApi<{ recommendations: Reco[] }>(`/clients/${clientId}/recommendations`);
  const lastSync = useLastSync(clientId);
  const { view } = useSession();
  const latest = data?.recommendations[0]?.date;
  const today = data?.recommendations.filter((r) => r.date === latest) ?? [];
  return (
    <>
      <PageHead a="Pilotage" b="détaillé" lastSync={lastSync} sub="L'écran de travail : quoi faire aujourd'hui, et sur quels chiffres." />
      {error && <ErrorBox error={error} />}
      <SectionTitle num="01" a="Recommandations" b="du jour" right={latest && <span class="mono small muted">{formatDate(latest)}</span>} />
      {data && today.length === 0 && (
        <EmptyState title="Aucune recommandation publiée">
          L'analyse du jour apparaît ici après la synchronisation de 6 h 00{view === 'client' ? ', une fois relue par Obsidian Partners' : ''}.
        </EmptyState>
      )}
      <div class="grid" style="gap:10px">
        {today.map((r) => (
          <article class="card edge reco" style={{ '--edge': SEVERITY_EDGE[r.severity] }}>
            <div class="kpi-row">
              <Pill kind={r.severity}>{SEVERITY_LABEL[r.severity]}</Pill>
              <span class="mono small muted">{r.state === 'traitee' ? 'Traitée' : r.state === 'ignoree' ? 'Ignorée' : 'Ouverte'}{r.repeatCount > 1 ? ` · ${r.repeatCount}e jour` : ''}</span>
            </div>
            <h3>{r.title}</h3>
            <p>{r.body}</p>
            {view === 'agence' && r.published === false && <AgencyNote>non publiée, le client ne la voit pas.</AgencyNote>}
            {view === 'agence' && r.internalNote && <div class="small" style="color:var(--agency)">Note interne : {r.internalNote}</div>}
          </article>
        ))}
      </div>
      {['02 · KPI clés', '03 · Du clic à la vente', '04 · Évolution', '05 · Campagnes', '06 · Publicités'].map((b) => (
        <div class="section">
          <div class="label" style="margin-bottom:8px">{b}</div>
          <EmptyState title="Bloc livré au lot 5">Les seuils, verdicts, funnel, courbes annotées et le tableau des publicités (coût par rendez-vous par créative) arrivent au lot 5.</EmptyState>
        </div>
      ))}
    </>
  );
}

// ─────────────────────────── Écrans des lots suivants ───────────────────────────

export function LaterScreen({ clientId, a, b, lot, children }: { clientId: string; a: string; b: string; lot: number; children: string }) {
  const lastSync = useLastSync(clientId);
  return (
    <>
      <PageHead a={a} b={b} lastSync={lastSync} />
      <EmptyState title={`Disponible au lot ${lot}`}>{children}</EmptyState>
    </>
  );
}

// ─────────────────────────── Console agence (§12) ───────────────────────────

interface ConsoleRow {
  id: string; name: string; offer: string | null; status: string; isDemo: boolean; phase: string | null; daysSinceStart: number | null;
  counter: { validated: number; target: number; onPace: boolean; daysRemaining: number } | null;
  spend7_cents: number | null; costPerBooked7_cents: number | null; connections: { type: string; state: string }[];
  openRecos: number; openFeedback: number; overdueClientTasks: number; red: boolean; redReasons: string[];
  onboarding: 'a_remplir' | 'envoye' | 'complement_demande'; onboardingSubmittedAt: string | null;
}

export function ConsoleScreen() {
  const { data, error, loading } = useApi<{ summary: { spend30_cents: number | null; avgCostPerBooked30_cents: number | null; clientsBehindPace: number }; rows: ConsoleRow[] }>('/agence/console');
  const [onlyRed, setOnlyRed] = useState(false);
  return (
    <>
      <PageHead a="Console" b="agence" sub="Tous les clients, triés par ce qui demande une action." />
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading />}
      {data && (
        <>
          <div class="grid grid-3">
            <div class="card edge kpi" style={{ '--edge': 'var(--accent)' }}><span class="label">Dépense pilotée · 30 j</span><span class="kpi-value">{formatEuros(data.summary.spend30_cents)}</span></div>
            <div class="card edge kpi"><span class="label">Coût moyen par rendez-vous · 30 j</span><span class="kpi-value">{formatEuros(data.summary.avgCostPerBooked30_cents, { decimals: true })}</span></div>
            <div class="card edge kpi" style={{ '--edge': data.summary.clientsBehindPace ? 'var(--alert)' : 'var(--border)' }}><span class="label">Clients en retard sur le rythme</span><span class="kpi-value">{data.summary.clientsBehindPace}</span></div>
          </div>
          <div class="section">
            <label class="small muted" style="display:inline-flex;gap:8px;align-items:center;margin-bottom:10px">
              <input type="checkbox" checked={onlyRed} onChange={(e) => setOnlyRed((e.target as HTMLInputElement).checked)} /> Seulement les lignes en rouge
            </label>
            <DataTable
              caption="Clients"
              rows={data.rows.filter((r) => !onlyRed || r.red)}
              initialSort={{ key: 'action', dir: 'desc' }}
              rowClass={(r) => (r.red ? 'red' : '')}
              columns={[
                { key: 'name', label: 'Client', value: (r) => r.name, render: (r) => <a href={`/c/${r.id}/tableau-de-bord`} title={r.redReasons.join(' · ')}>{r.name}</a> },
                { key: 'action', label: 'À traiter', value: (r) => (r.red ? 1000 : 0) + r.openFeedback + r.overdueClientTasks + r.openRecos, render: (r) => r.red ? r.redReasons.join(' · ') : '—' },
                { key: 'phase', label: 'Phase', value: (r) => r.phase },
                { key: 'onb', label: 'Onboarding', value: (r) => r.onboardingSubmittedAt, render: (r) => <a href={`/c/${r.id}/onboarding`}>{r.onboarding === 'a_remplir' ? 'À remplir' : r.onboarding === 'complement_demande' ? 'Complément demandé' : `Envoyé le ${formatDate(r.onboardingSubmittedAt, { year: false })}`}</a> },
                { key: 'days', label: 'Jours', value: (r) => r.daysSinceStart, render: (r) => formatInt(r.daysSinceStart) },
                { key: 'counter', label: 'RDV validés', value: (r) => r.counter?.validated ?? null, render: (r) => r.counter ? `${r.counter.validated} / ${r.counter.target}${r.counter.onPace ? '' : ' · retard'}` : '—' },
                { key: 'spend7', label: 'Dépense 7 j', value: (r) => r.spend7_cents, render: (r) => formatEuros(r.spend7_cents) },
                { key: 'cpb7', label: 'Coût / RDV 7 j', value: (r) => r.costPerBooked7_cents, render: (r) => formatEuros(r.costPerBooked7_cents, { decimals: true }) },
                { key: 'conn', label: 'Connexions', value: (r) => r.connections.filter((c) => c.state === 'casse').length, render: (r) => { const b = r.connections.filter((c) => c.state === 'casse').length; const dg = r.connections.filter((c) => c.state === 'degrade').length; return b ? `${b} en panne` : dg ? `${dg} dégradée${dg > 1 ? 's' : ''}` : 'OK'; } },
                { key: 'recos', label: 'Recos ouvertes', value: (r) => r.openRecos },
                { key: 'fb', label: 'Retours', value: (r) => r.openFeedback },
                { key: 'late', label: 'Tâches client en retard', value: (r) => r.overdueClientTasks },
              ]}
            />
          </div>
        </>
      )}
    </>
  );
}
