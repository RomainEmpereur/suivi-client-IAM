import { useEffect, useState } from 'preact/hooks';
import { ApiError, api, useApi } from './api.ts';
import { navigate, useLocation } from './router.ts';
import { SessionContext, useSession, type Me, type Session } from './session.ts';
import { store } from './store.ts';
import { ErrorBox, Loading } from './components/ui.tsx';
import { DashboardScreen } from './screens/Dashboard.tsx';
import { OnboardingScreen } from './screens/Onboarding.tsx';
import { DeliveryScreen } from './screens/Delivery.tsx';
import { DeliverableScreen } from './screens/Deliverable.tsx';
import { FeedbackScreen, ReportScreen } from './screens/Report.tsx';
import { AgencyGuidesScreen, GuideScreen } from './screens/Guides.tsx';
import { CashScreen } from './screens/Cash.tsx';
import { ClientEditScreen } from './screens/ClientEdit.tsx';
import { FinanceScreen } from './screens/Finance.tsx';
import {
  AppointmentsScreen, ConnectionsScreen, ConsoleScreen, GuidesScreen, InfrastructureScreen, LaterScreen, PilotageScreen,
} from './screens/Screens.tsx';

const NAV = [
  { group: 'Accueil', items: [
    ['tableau-de-bord', 'Tableau de bord'], ['pilotage', 'Pilotage'], ['infrastructure', 'Infrastructure'],
    ['rendez-vous', 'Rendez-vous'], ['encaissements', 'Encaissements'], ['rapport', 'Rapport'], ['connexions', 'Connexions'],
  ] },
  { group: 'Démarrage et aide', items: [['onboarding', 'Onboarding'], ['guides', 'Guides'], ['feedback', 'Feedback']] },
] as const;

export function App() {
  const [view, setViewState] = useState<'agence' | 'client'>(store.get('view') === 'client' ? 'client' : 'agence');
  const me = useApi<Me>('/me', [view]);

  // 401 : pas d'identité ; 403 : identité inconnue (ex. démo en ligne, avant le choix d'une identité fictive).
  if (me.error instanceof ApiError && (me.error.status === 401 || me.error.status === 403)) return <DevLogin error={me.error} />;
  if (me.error) return <div class="login"><ErrorBox error={me.error} /><DevSwitch /></div>;
  if (!me.data) return <div class="login"><Loading /></div>;

  const isAgency = me.data.user.role === 'agence';
  const session: Session = {
    me: me.data,
    isAgency,
    view: isAgency ? view : 'client',
    setView: (v) => { store.set('view', v === 'client' ? 'client' : null); setViewState(v); },
  };
  return (
    <SessionContext.Provider value={session}>
      <Shell />
    </SessionContext.Provider>
  );
}

function Shell() {
  const { path, search } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  const session = useSession();
  const { me, view, isAgency } = session;

  const m = path.match(/^\/c\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/);
  const agencyClient = path.match(/^\/agence\/clients\/([^/]+)$/)?.[1] ?? null;
  const clientId = m?.[1] ?? null;
  const screen = m?.[2] ?? 'tableau-de-bord';
  const subId = m?.[3] ?? null;
  const defaultClient = me.clients[0]?.id ?? null;

  useEffect(() => {
    if (path === '/' || (path.startsWith('/agence') && view === 'client')) {
      if (isAgency && view === 'agence') navigate('/agence', true);
      else if (defaultClient) navigate(`/c/${clientId ?? (agencyClient && agencyClient !== 'nouveau' ? agencyClient : null) ?? defaultClient}/tableau-de-bord`, true);
    }
  }, [path, view]);
  useEffect(() => setMenuOpen(false), [path]);

  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light';
    if (next === 'light') document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
    store.set('theme', next === 'light' ? 'light' : null);
    setTheme(next);
  }

  // Un client navigue toujours dans SON espace, quel que soit l'identifiant présent dans l'URL.
  const activeClient = isAgency ? (clientId ?? (agencyClient && agencyClient !== 'nouveau' ? agencyClient : null) ?? store.get('lastClient') ?? defaultClient) : defaultClient;
  useEffect(() => { if (clientId && isAgency) store.set('lastClient', clientId); }, [clientId]);
  const clientName = me.clients.find((c) => c.id === activeClient)?.name;

  return (
    <div class="layout">
      <div class="topbar">
        <button class="ghost-btn" aria-expanded={menuOpen} aria-controls="sidebar" onClick={() => setMenuOpen(!menuOpen)}>☰ Menu</button>
        <span class="brand">Obsidian <em>Partners</em></span>
      </div>
      <aside id="sidebar" class={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div class="brand">Obsidian <em>Partners</em></div>

        {isAgency && (
          <div class="view-banner" role="status">
            <span class="label">{view === 'agence' ? 'Vue agence' : 'Vue client · lecture seule'}</span>
            {view === 'agence'
              ? <button type="button" onClick={() => { session.setView('client'); if (!clientId && activeClient) navigate(`/c/${activeClient}/tableau-de-bord`); }}>Vue client</button>
              : <button type="button" onClick={() => session.setView('agence')}>← Agence</button>}
          </div>
        )}

        {isAgency && (
          <div class="nav-group">
            {view === 'agence' && <a class="nav-link" href="/agence" aria-current={path === '/agence' ? 'page' : undefined}>Console multi-clients</a>}
            {view === 'agence' && <a class="nav-link" href="/agence/finance" aria-current={path === '/agence/finance' ? 'page' : undefined}>Suivi financier</a>}
            <label class="label" for="client-select" style="padding:10px 10px 6px">Client</label>
            <select id="client-select" class="client-select" value={activeClient ?? ''}
              onChange={(e) => { const v = (e.target as HTMLSelectElement).value; navigate(agencyClient ? `/agence/clients/${v}` : `/c/${v}/${clientId ? screen : 'tableau-de-bord'}`); }}>
              {me.clients.map((c) => <option value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        {!isAgency && clientName && <div class="label" style="padding:0 10px">{clientName}</div>}

        {activeClient && NAV.map((g) => (
          <nav class="nav-group" aria-label={g.group}>
            <span class="label">{g.group}</span>
            {g.items.map(([slug, label]) => (
              <a class="nav-link" href={`/c/${activeClient}/${slug}`} aria-current={clientId && screen === slug ? 'page' : undefined}>{label}</a>
            ))}
          </nav>
        ))}
        {activeClient && isAgency && view === 'agence' && (
          <nav class="nav-group" aria-label="Agence">
            <span class="label">Agence</span>
            <a class="nav-link" href={`/agence/clients/${activeClient}`} aria-current={path === `/agence/clients/${activeClient}` ? 'page' : undefined}>Fiche client</a>
            <a class="nav-link" href={`/c/${activeClient}/delivery`} aria-current={clientId && screen === 'delivery' ? 'page' : undefined}>Delivery</a>
            <a class="nav-link" href="/agence/guides" aria-current={path === '/agence/guides' ? 'page' : undefined}>Guides (rédaction)</a>
          </nav>
        )}

        <div class="sidebar-foot">
          <button class="ghost-btn" onClick={toggleTheme}>{theme === 'light' ? 'Mode nuit' : 'Mode jour'}</button>
          <a class="ghost-btn" href={me.logoutUrl} onClick={() => store.set('devUser', null)}>Se déconnecter</a>
          <span class="mono small muted" style="padding:0 4px;overflow-wrap:anywhere">{me.user.email}</span>
          <DevSwitch />
        </div>
      </aside>

      <main class="main" id="contenu">
        {path === '/agence' && isAgency && view === 'agence' ? <ConsoleScreen />
          : path === '/agence/guides' && isAgency && view === 'agence' ? <AgencyGuidesScreen />
          : path === '/agence/finance' && isAgency && view === 'agence' ? <FinanceScreen />
          : agencyClient && isAgency && view === 'agence' ? <ClientEditScreen key={agencyClient} clientId={agencyClient === 'nouveau' ? null : agencyClient} />
          : clientId ? <ClientScreen key={`${clientId}-${view}-${subId ?? ''}`} clientId={clientId} screen={screen} subId={subId} search={search} />
          : <Loading />}
      </main>
    </div>
  );
}

function ClientScreen({ clientId, screen, subId, search }: { clientId: string; screen: string; subId: string | null; search: string }) {
  switch (screen) {
    case 'livrables': return subId ? <DeliverableScreen clientId={clientId} deliverableId={subId} /> : <InfrastructureScreen clientId={clientId} />;
    case 'tableau-de-bord': return <DashboardScreen clientId={clientId} search={search} />;
    case 'pilotage': return <PilotageScreen clientId={clientId} search={search} />;
    case 'infrastructure': return <InfrastructureScreen clientId={clientId} />;
    case 'connexions': return <ConnectionsScreen clientId={clientId} />;
    case 'guides': return subId ? <GuideScreen clientId={clientId} guideId={subId} /> : <GuidesScreen clientId={clientId} />;
    case 'rendez-vous': return <AppointmentsScreen clientId={clientId} />;
    case 'encaissements': return <CashScreen clientId={clientId} />;
    case 'rapport': return <ReportScreen clientId={clientId} />;
    case 'feedback': return <FeedbackScreen clientId={clientId} />;
    case 'onboarding': return <OnboardingScreen clientId={clientId} />;
    case 'delivery': return <DeliveryScreen clientId={clientId} />;
    default: return <LaterScreen clientId={clientId} a="Page" b="introuvable" lot={1}>Cette page n'existe pas.</LaterScreen>;
  }
}

/** Sélecteur d'identité — développement uniquement (le serveur refuse X-Dev-User en production). */
function DevLogin({ error }: { error: ApiError }) {
  const [users, setUsers] = useState<{ email: string; role: string }[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => { api<{ users: { email: string; role: string }[] }>('/dev/users').then((r) => setUsers(r.users)).catch(() => setUnavailable(true)); }, []);
  return (
    <div class="login">
      <div class="brand" style="font-size:24px;margin-bottom:12px">Obsidian <em>Partners</em></div>
      {unavailable && <p class="muted">{error.status === 401 ? 'Connexion requise. Rechargez la page pour recevoir un code par email.' : error.message}</p>}
      {users && (
        <div class="card">
          <div class="label" style="margin-bottom:10px">Démonstration · choisir une identité fictive</div>
          {users.map((u) => (
            <button class="ghost-btn" style="display:block;width:100%;margin-bottom:6px" onClick={() => { store.set('devUser', u.email); location.href = '/'; }}>
              {u.email} <span class="mono small">· {u.role}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DevSwitch() {
  if (!store.get('devUser')) return null;
  return <button class="ghost-btn small" onClick={() => { store.set('devUser', null); store.set('view', null); location.href = '/'; }}>Changer d'identité (dev)</button>;
}
