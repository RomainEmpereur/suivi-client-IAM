/**
 * Règles GoHighLevel partagées par l'import ponctuel (scripts/import-mcp.ts) et la synchronisation quotidienne
 * (jobs/sync-daily). Décision 0006. Une seule définition, deux usages.
 */

/** Réglages GHL d'un client (clients.ghl_config_json). */
export interface GhlClientConfig {
  locationId: string;
  /** Pipelines lus (opportunités, attribution, ventes). */
  pipelineIds: string[];
  /** Pipeline affiché sur le tableau de bord (instantané par étape). */
  displayPipelineId: string | null;
  /** Calendriers lus pour les rendez-vous. */
  calendarIds: string[];
  /** Étapes qui prouvent que l'appel a eu lieu (→ honoré). */
  postCallStageIds: string[];
  /** Étapes « no-show » (→ absent). */
  noShowStageIds: string[];
  /** Étapes gagnées (→ vente). */
  wonStageIds: string[];
  /** Titres de rendez-vous à exclure comme tests internes. */
  testTitlePrefixes: string[];
  /** Pipelines affichés (plusieurs possibles) ; prime sur displayPipelineId. */
  displayPipelineIds?: string[];
}

/**
 * Réglage saisi par NOMS (pipelines et étapes tels qu'affichés dans GHL), résolu en identifiants au moment
 * de la synchronisation. Un nom inconnu bloque la synchronisation avec la liste des noms disponibles.
 */
export interface GhlNamedConfig {
  locationId: string;
  pipelineNames: string[];
  displayPipelineNames?: string[];
  calendarIds?: string[];
  postCallStageNames: string[];
  noShowStageNames: string[];
  wonStageNames: string[];
  testTitlePrefixes?: string[];
}

export function resolveGhlConfig(
  named: GhlNamedConfig,
  pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[],
): GhlClientConfig {
  const norm = (x: string) => x.trim().toLowerCase();
  const pick = named.pipelineNames.map((n) => {
    const p = pipelines.find((x) => norm(x.name) === norm(n));
    if (!p) throw new Error(`Pipeline GHL introuvable : « ${n} ». Disponibles : ${pipelines.map((x) => `« ${x.name} »`).join(', ')}`);
    return p;
  });
  const stagesFor = (names: string[]) => names.flatMap((n) => {
    const ids = pick.flatMap((p) => p.stages.filter((st) => norm(st.name) === norm(n)).map((st) => st.id));
    if (!ids.length) throw new Error(`Étape GHL introuvable : « ${n} » dans ${pick.map((p) => `« ${p.name} »`).join(', ')}`);
    return ids;
  });
  const display = (named.displayPipelineNames ?? named.pipelineNames).map((n) => pick.find((p) => norm(p.name) === norm(n))?.id)
    .filter((x): x is string => Boolean(x));
  return {
    locationId: named.locationId,
    pipelineIds: pick.map((p) => p.id),
    displayPipelineId: display[0] ?? null,
    displayPipelineIds: display,
    calendarIds: named.calendarIds ?? [],
    postCallStageIds: stagesFor(named.postCallStageNames),
    noShowStageIds: stagesFor(named.noShowStageNames),
    wonStageIds: stagesFor(named.wonStageNames),
    testTitlePrefixes: named.testTitlePrefixes ?? [],
  };
}

export type ApptStatus = 'prevu' | 'honore' | 'absent' | 'annule';

/**
 * Statut d'un rendez-vous importé, dans l'ordre :
 * annulé dans le calendrier → annulé ; noshow → absent ; showed → honoré ;
 * puis, pour le DERNIER rendez-vous passé non annulé du contact seulement :
 * étape d'après appel → honoré (prime sur no-show) ; étape no-show → absent ; sinon prévu.
 * Un rendez-vous futur n'est jamais honoré ni absent.
 */
export function ghlAppointmentStatus(input: {
  ghlStatus: string | null | undefined;
  scheduledAt: string;
  isLastPastForContact: boolean;
  contactStageIds: string[];
  config: Pick<GhlClientConfig, 'postCallStageIds' | 'noShowStageIds'>;
  now?: number;
}): ApptStatus {
  const now = input.now ?? Date.now();
  const future = Date.parse(input.scheduledAt) > now;
  const s = (input.ghlStatus ?? '').toLowerCase();
  if (s === 'cancelled' || s === 'invalid') return 'annule';
  if (future) return 'prevu';
  if (s === 'noshow') return 'absent';
  if (s === 'showed') return 'honore';
  if (input.isLastPastForContact) {
    if (input.contactStageIds.some((x) => input.config.postCallStageIds.includes(x))) return 'honore';
    if (input.contactStageIds.some((x) => input.config.noShowStageIds.includes(x))) return 'absent';
  }
  return 'prevu';
}

/** Attribution Meta d'une opportunité GHL (champ `attributions`) : identifiants numériques prioritaires. */
export function ghlAttribution(opp: { attributions?: { utmAdId?: string; utmCampaignId?: string; utmCampaign?: string; utmSource?: string; adSource?: string }[]; source?: string }) {
  const list = opp.attributions ?? [];
  const withAd = list.find((a) => a.utmAdId);
  const withCampaign = list.find((a) => a.utmCampaignId);
  const isMeta = Boolean(withAd || withCampaign) || /facebook|instagram|meta/i.test(String(opp.source ?? ''))
    || list.some((a) => /facebook|^ig$|instagram/i.test(String(a.utmSource ?? a.adSource ?? '')));
  return {
    adId: withAd?.utmAdId ?? null,
    campaignId: withCampaign?.utmCampaignId ?? null,
    campaignName: withCampaign?.utmCampaign ?? null,
    isMeta,
  };
}

/** Jour calendaire à Paris d'un horodatage (AAAA-MM-JJ). */
export function parisDay(iso: string | number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
