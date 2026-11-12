import { useState } from 'preact/hooks';
import { formatDate, formatDateTime } from '@obsidian/domain';
import { api, useApi } from '../api.ts';
import { SEVERITY_EDGE, SEVERITY_LABEL } from './ui.tsx';

export interface AlertItem {
  id: string; clientId: string; runDate: string; ruleKey: string | null; severity: string; title: string | null; detail: string | null;
  from: string; to: string;
}

function AlertLine({ a }: { a: AlertItem }) {
  return (
    <div style={{ borderLeft: `3px solid ${SEVERITY_EDGE[a.severity] ?? 'var(--border)'}`, padding: '4px 10px', margin: '6px 0' }}>
      <div class="small"><strong>{a.title}</strong> <span class="mono small muted">· {SEVERITY_LABEL[a.severity] ?? a.severity}</span></div>
      {a.detail && <div class="small muted">{a.detail}</div>}
    </div>
  );
}

/** Alertes du jour, tous clients (console agence). */
export function ConsoleAlerts({ clients }: { clients: { id: string; name: string }[] }) {
  const { data, error, reload } = useApi<{ alerts: AlertItem[]; computedAt: string | null }>('/agence/alerts');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  async function recompute() {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ clients: number; alerts: number }>('/agence/alerts/run', { method: 'POST' });
      setMsg(`${r.alerts} alerte${r.alerts > 1 ? 's' : ''} sur ${r.clients} clients.`);
      reload();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  const alerts = data?.alerts ?? [];
  const byClient = clients.map((c) => ({ ...c, list: alerts.filter((a) => a.clientId === c.id) })).filter((c) => c.list.length)
    .sort((a, b) => b.list.filter((x) => x.severity === 'corriger').length - a.list.filter((x) => x.severity === 'corriger').length || b.list.length - a.list.length);
  const fix = alerts.filter((a) => a.severity === 'corriger').length;
  const shown = open ? byClient : byClient.slice(0, 4);
  return (
    <div class="card section">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between">
        <div>
          <div class="label">Alertes du jour · 7 derniers jours</div>
          <div class="small muted">
            {data ? `${alerts.length} alerte${alerts.length > 1 ? 's' : ''} dont ${fix} à corriger, ${byClient.length} client${byClient.length > 1 ? 's' : ''} concerné${byClient.length > 1 ? 's' : ''}` : 'Chargement…'}
            {data?.computedAt ? ` · calculées le ${formatDateTime(data.computedAt)}` : data ? ' · pas encore calculées' : ''}
          </div>
        </div>
        <button class="ghost-btn" onClick={recompute} disabled={busy}>{busy ? 'Calcul…' : 'Recalculer maintenant'}</button>
      </div>
      {msg && <div class="small muted" style="margin-top:6px">{msg}</div>}
      {error && <div class="small" style="color:var(--alert)">{error.message}</div>}
      {shown.map((c) => (
        <div style="margin-top:12px">
          <a href={`/c/${c.id}/tableau-de-bord`}><strong>{c.name}</strong></a>
          {c.list.map((a) => <AlertLine a={a} />)}
        </div>
      ))}
      {byClient.length > 4 && <button class="ghost-btn small" style="margin-top:8px" onClick={() => setOpen(!open)}>{open ? 'Réduire' : `Voir les ${byClient.length - 4} autres clients`}</button>}
      {data && alerts.length === 0 && data.computedAt && <div class="small muted" style="margin-top:8px">Aucune alerte : rien ne demande d'action aujourd'hui.</div>}
    </div>
  );
}

/** Alertes du jour d'un client (tableau de bord, vue agence uniquement). */
export function ClientAlertsCard({ clientId }: { clientId: string }) {
  const { data } = useApi<{ alerts: AlertItem[] }>(`/agence/clients/${clientId}/alerts`);
  if (!data || data.alerts.length === 0) return null;
  return (
    <div class="card section">
      <div class="label">Alertes du jour · visibles par l'agence seulement</div>
      <div class="small muted">Du {formatDate(data.alerts[0].from)} au {formatDate(data.alerts[0].to)}</div>
      {data.alerts.map((a) => <AlertLine a={a} />)}
    </div>
  );
}
