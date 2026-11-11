/** Les huit phases de la chaîne de production (§10), dans l'ordre. */
export const PHASES = [
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'offre', label: 'Offre de trafic froid' },
  { key: 'landing', label: 'Landing page' },
  { key: 'vsl', label: 'VSL' },
  { key: 'ads', label: 'Publicités vidéo' },
  { key: 'sequences', label: 'Séquences' },
  { key: 'recette', label: 'Branchements et recette' },
  { key: 'lancement', label: 'Lancement' },
] as const;

export type PhaseKey = (typeof PHASES)[number]['key'];
export type PhaseState = 'a_venir' | 'en_cours' | 'livre' | 'valide';

export const PHASE_STATE_LABEL: Record<PhaseState, string> = {
  a_venir: 'À venir',
  en_cours: 'En cours',
  livre: 'Livré',
  valide: 'Validé',
};

export const DELIVERABLE_TYPE_LABEL: Record<string, string> = {
  offre: 'Offre',
  landing: 'Landing page',
  vsl_script: 'Script VSL',
  vsl_video: 'Vidéo VSL',
  ads_scripts: 'Scripts publicitaires',
  ads_videos: 'Vidéos publicitaires',
  sequences: 'Séquences',
  tracking: 'Tracking',
  campagne: 'Campagne',
};

/** Statuts visibles par le client (§10). « brouillon » n'existe que côté agence. */
export type DeliverableStatus = 'brouillon' | 'en_preparation' | 'a_relire' | 'valide' | 'mis_a_jour';
export const DELIVERABLE_STATUS_LABEL: Record<DeliverableStatus, string> = {
  brouillon: 'Brouillon (interne)',
  en_preparation: 'En préparation',
  a_relire: 'À relire',
  valide: 'Validé',
  mis_a_jour: 'Mis à jour',
};
