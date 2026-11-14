import { useEffect, useState } from 'preact/hooks';
import { formatDate, formatDateTime } from '@obsidian/domain';
import { ApiError, api, useApi } from '../api.ts';
import { navigate } from '../router.ts';
import { useSession } from '../session.ts';
import { AgencyNote, EmptyState, ErrorBox, Loading, PageHead, Pill } from '../components/ui.tsx';

/** Liste de tâches de l'agence (décision 0030) : par client ou pour l'agence, avec échéance et descriptif. Vue agence uniquement. */

interface Task {
  id: string; clientId: string | null; clientName: string | null; title: string; description: string | null; dueDate: string | null;
  status: 'a_faire' | 'fait'; doneAt: string | null; overdue: boolean; dueToday: boolean;
}
interface Data { today: string; items: Task[]; counts: { open: number; overdue: number; today: number } }

const dayLabel = (d: string) => formatDate(`${d}T12:00:00Z`);
function relative(d: string, today: string) {
  const diff = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return "aujourd'hui";
  if (diff === 1) return 'demain';
  if (diff === -1) return 'hier';
  return diff < 0 ? `il y a ${-diff} j` : `dans ${diff} j`;
}

export function TasksScreen({ search }: { search: string }) {
  const filter = new URLSearchParams(search).get('client') ?? '';
  const [showDone, setShowDone] = useState(false);
  const { data, error, reload: load } = useApi<Data>(`/agence/taches${filter ? `?clientId=${encodeURIComponent(filter)}` : ''}`, [filter]);
  const reload = () => { load(); window.dispatchEvent(new Event('taches-maj')); };
  const { me } = useSession();
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const open = data.items.filter((t) => t.status === 'a_faire');
  const done = data.items.filter((t) => t.status === 'fait');
  const groups: [string, Task[], string?][] = [
    ['En retard', open.filter((t) => t.overdue), 'var(--alert)'],
    ["Aujourd'hui", open.filter((t) => t.dueToday), 'var(--warn)'],
    ['À venir', open.filter((t) => t.dueDate && !t.overdue && !t.dueToday)],
    ['Sans échéance', open.filter((t) => !t.dueDate)],
  ];
  const setFilter = (v: string) => navigate(`/agence/taches${v ? `?client=${encodeURIComponent(v)}` : ''}`, true);
  return (
    <>
      <PageHead a="Tâches" b="de l'agence"
        sub={`${data.counts.open} à faire${data.counts.overdue ? ` · ${data.counts.overdue} en retard` : ''}${data.counts.today ? ` · ${data.counts.today} aujourd'hui` : ''}. Visible de l'agence uniquement.`} />
      <NewTask clients={me.clients} defaultClient={filter} onDone={reload} />
      <div class="section" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <label class="small muted" for="task-filter">Afficher</label>
        <select id="task-filter" class="client-select" style="width:auto" value={filter} onChange={(e) => setFilter((e.target as HTMLSelectElement).value)}>
          <option value="">Tous les clients</option>
          <option value="agence">Agence (général)</option>
          {me.clients.map((c) => <option value={c.id}>{c.name}</option>)}
        </select>
        <label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone((e.target as HTMLInputElement).checked)} /> Afficher les tâches faites ({done.length})</label>
      </div>
      {open.length === 0 && !showDone && <EmptyState title="Rien à faire">Ajoutez une tâche ci-dessus : client, titre, échéance et un mot de descriptif.</EmptyState>}
      {groups.filter(([, list]) => list.length).map(([label, list, color]) => (
        <section class="section">
          <h3 style={{ margin: '0 0 8px', color }}>{label} <span class="small muted">({list.length})</span></h3>
          <div style="display:flex;flex-direction:column;gap:8px">{list.map((t) => <TaskRow t={t} today={data.today} clients={me.clients} onChange={reload} />)}</div>
        </section>
      ))}
      {showDone && done.length > 0 && (
        <section class="section">
          <h3 style="margin:0 0 8px">Faites <span class="small muted">({done.length})</span></h3>
          <div style="display:flex;flex-direction:column;gap:8px">{done.map((t) => <TaskRow t={t} today={data.today} clients={me.clients} onChange={reload} />)}</div>
        </section>
      )}
      <AgencyNote>vue agence uniquement : les clients ne voient jamais cette liste.</AgencyNote>
    </>
  );
}

type ClientOpt = { id: string; name: string };

function NewTask({ clients, defaultClient, onDone }: { clients: ClientOpt[]; defaultClient: string; onDone: () => void }) {
  const empty = { clientId: defaultClient === 'agence' ? '' : defaultClient, title: '', description: '', dueDate: '' };
  const [f, setF] = useState(empty);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).value });
  async function submit(e: Event) {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await api('/agence/taches', { method: 'POST', body: JSON.stringify({ ...f, clientId: f.clientId || null, dueDate: f.dueDate || null }) }); setF({ ...empty, clientId: f.clientId }); onDone(); }
    catch (x) { setErr((x as ApiError).message); } finally { setBusy(false); }
  }
  return (
    <form class="card section" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr));gap:10px;align-items:end" onSubmit={submit}>
      <label class="field">Client
        <select value={f.clientId} onChange={set('clientId')}><option value="">Agence (général)</option>{clients.map((c) => <option value={c.id}>{c.name}</option>)}</select>
      </label>
      <label class="field" style="grid-column:span 2">Tâche<input required maxLength={200} value={f.title} onInput={set('title')} placeholder="Ex. Relancer le client pour le pixel" /></label>
      <label class="field">Échéance<input type="date" value={f.dueDate} onInput={set('dueDate')} /></label>
      <label class="field" style="grid-column:1/-1">Descriptif (facultatif)<textarea rows={2} maxLength={5000} value={f.description} onInput={set('description')} /></label>
      <div style="display:flex;gap:8px;align-items:center"><button class="btn" disabled={busy}>+ Ajouter la tâche</button>{err && <span class="small" style="color:var(--alert)">{err}</span>}</div>
    </form>
  );
}

function TaskRow({ t, today, clients, onChange }: { t: Task; today: string; clients: ClientOpt[]; onChange: () => void }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ clientId: t.clientId ?? '', title: t.title, description: t.description ?? '', dueDate: t.dueDate ?? '' });
  const [err, setErr] = useState<string | null>(null);
  const patch = async (body: Record<string, unknown>) => {
    setErr(null);
    try { await api(`/agence/taches/${t.id}`, { method: 'PATCH', body: JSON.stringify(body) }); setEdit(false); onChange(); } catch (x) { setErr((x as ApiError).message); }
  };
  const del = async () => { if (!confirm(`Supprimer la tâche « ${t.title} » ?`)) return; await api(`/agence/taches/${t.id}`, { method: 'DELETE' }); onChange(); };
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).value });
  const edge = t.overdue ? 'var(--alert)' : t.dueToday ? 'var(--warn)' : 'var(--border)';
  if (edit) return (
    <div class="card" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr));gap:8px;align-items:end">
      <label class="field">Client<select value={f.clientId} onChange={set('clientId')}><option value="">Agence (général)</option>{clients.map((c) => <option value={c.id}>{c.name}</option>)}</select></label>
      <label class="field" style="grid-column:span 2">Tâche<input maxLength={200} value={f.title} onInput={set('title')} /></label>
      <label class="field">Échéance<input type="date" value={f.dueDate} onInput={set('dueDate')} /></label>
      <label class="field" style="grid-column:1/-1">Descriptif<textarea rows={3} value={f.description} onInput={set('description')} /></label>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn" onClick={() => patch({ ...f, clientId: f.clientId || null, dueDate: f.dueDate || null })}>Enregistrer</button>
        <button class="ghost-btn" onClick={() => setEdit(false)}>Annuler</button>
        {err && <span class="small" style="color:var(--alert)">{err}</span>}
      </div>
    </div>
  );
  return (
    <div class="card" style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', borderLeft: `3px solid ${edge}`, opacity: t.status === 'fait' ? 0.65 : 1 }}>
      <input type="checkbox" style="margin-top:4px;width:18px;height:18px;flex:none" checked={t.status === 'fait'} aria-label={t.status === 'fait' ? 'Remettre à faire' : 'Marquer comme faite'}
        onChange={(e) => patch({ status: (e.target as HTMLInputElement).checked ? 'fait' : 'a_faire' })} />
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">
        <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
          <strong style={{ textDecoration: t.status === 'fait' ? 'line-through' : undefined, overflowWrap: 'anywhere' }}>{t.title}</strong>
          {t.clientId ? <a href={`/agence/clients/${t.clientId}`}><Pill kind="info">{t.clientName}</Pill></a> : <Pill kind="neutral">Agence</Pill>}
        </div>
        {t.description && <div class="small" style="white-space:pre-line;overflow-wrap:anywhere">{t.description}</div>}
        <div class="small muted">
          {t.status === 'fait'
            ? `Faite le ${t.doneAt ? formatDateTime(t.doneAt) : '—'}`
            : t.dueDate ? <span style={{ color: t.overdue ? 'var(--alert)' : t.dueToday ? 'var(--warn)' : undefined }}>Échéance : {dayLabel(t.dueDate)} ({relative(t.dueDate, today)})</span> : 'Sans échéance'}
        </div>
        {err && <span class="small" style="color:var(--alert)">{err}</span>}
      </div>
      <div style="display:flex;gap:6px;flex:none">
        <button class="ghost-btn small" onClick={() => setEdit(true)}>Modifier</button>
        <button class="ghost-btn small" onClick={del} aria-label="Supprimer">Supprimer</button>
      </div>
    </div>
  );
}

/** Lien du menu, avec le nombre de tâches en retard ou à faire aujourd'hui. */
export function TasksLink({ path }: { path: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((x) => x + 1);
    window.addEventListener('taches-maj', on);
    return () => window.removeEventListener('taches-maj', on);
  }, []);
  const { data } = useApi<{ urgent: number }>('/agence/taches/compteur', [path, tick]);
  const n = data?.urgent ?? 0;
  return (
    <a class="nav-link" href="/agence/taches" aria-current={path === '/agence/taches' ? 'page' : undefined} title="Tâches en retard ou à faire aujourd'hui">
      Tâches{n > 0 && <span class="nav-count" aria-label={`${n} en retard ou pour aujourd'hui`}>{n}</span>}
    </a>
  );
}
