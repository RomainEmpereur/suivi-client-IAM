import { formatDate } from '@obsidian/domain';

export interface ClientOverview {
  client: { id: string; name: string; status: string; campaignsLaunchedAt: string | null; isDemo: boolean; onboardingSubmittedAt: string | null };
  lastSync: string | null;
  brokenConnections: { type: string; state: string }[];
  overdueClientTasks: { id: string; label: string; due_date: string; blocking: number }[];
  progress: { label: string; done: number; total: number; nextStep: string | null } | null;
}

export const CONNECTION_LABEL: Record<string, string> = {
  meta: 'Compte publicitaire Meta', pixel: 'Pixel et événements', ghl: 'API GoHighLevel', calendrier: 'Calendrier',
  domaine: 'Domaine et page publiée', mailing: "Envoi d'emails", formulaire: 'Formulaire relié au CRM',
};

/** Ce qui doit être vu en premier : mesure en panne, tâches client en retard, avancement (§8, §10, §11). */
export function ClientAlerts({ clientId, overview }: { clientId: string; overview: ClientOverview }) {
  const broken = overview.brokenConnections.filter((c) => c.state === 'casse');
  return (
    <>
      {!overview.client.onboardingSubmittedAt && ['prospect', 'onboarding', 'build'].includes(overview.client.status) && (
        <a class="banner accent" href={`/c/${clientId}/onboarding`}>
          <span><strong>Première étape : votre onboarding.</strong> Tant qu'il n'est pas envoyé, la production ne peut pas démarrer. Vos réponses sont enregistrées au fil de l'eau.</span>
          <span class="mono small">Remplir le formulaire →</span>
        </a>
      )}
      {broken.length > 0 && (
        <a class="banner alert" href={`/c/${clientId}/connexions`} style="color:inherit">
          <span><strong>Mesure en panne</strong> — {broken.map((c) => CONNECTION_LABEL[c.type] ?? c.type).join(', ')}. Les chiffres affichés peuvent être incomplets : ce n'est pas forcément un mauvais résultat.</span>
          <span class="mono small">Voir les connexions →</span>
        </a>
      )}
      {overview.overdueClientTasks.map((t) => (
        <a class="banner warn" href={`/c/${clientId}/infrastructure`} style="color:inherit">
          <span><strong>À faire de votre côté</strong> — {t.label}</span>
          <span class="mono small">échéance dépassée : {formatDate(t.due_date)}</span>
        </a>
      ))}
      {overview.progress && !overview.client.campaignsLaunchedAt && overview.client.status !== 'actif' && (
        <a class="banner accent" href={`/c/${clientId}/infrastructure`}>
          <span>
            <strong>{overview.progress.label} en cours</strong> · {overview.progress.done}/{overview.progress.total}
            {overview.progress.nextStep && <> · prochaine étape : {overview.progress.nextStep}</>}
          </span>
          <span class="mono small">Infrastructure →</span>
        </a>
      )}
    </>
  );
}
