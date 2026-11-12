/**
 * Delivery (master prompt, docs/delivery/master-prompt.md) : les étapes 0 à 8, leurs conditions de lancement,
 * et l'extraction des consignes de chaque étape. La rédaction se fait dans le projet Claude de delivery ;
 * l'espace vérifie les conditions, prépare le brief, et suit la validation (décision 0008).
 */
import { MASTER_PROMPT } from './generated/master-prompt.ts';
import { QUESTION_BY_KEY, isAnswered } from './onboarding.ts';

export { MASTER_PROMPT };

export interface DeliveryStep {
  key: string;
  label: string;
  /** Titre exact de la section du master prompt (début de ligne, sans les dièses). */
  heading: string;
  /** Livrable client créé (non publié) à la validation ; null = document interne. */
  deliverable: { type: string; phase: string; title: string } | null;
  /** Ne démarre qu'une fois le mécanisme nommé choisi par le client (étape 1C). */
  needsMechanism: boolean;
  /** Point récurrent (étape 8) : jamais « validé », brief disponible chaque semaine. */
  recurring?: boolean;
}

export const DELIVERY_STEPS: DeliveryStep[] = [
  { key: 's0', label: '0 · Onboarding et recherche', heading: '3. Étape 0 — Onboarding et recherche', deliverable: null, needsMechanism: false },
  { key: 's1a', label: '1A · Analyse publicitaire concurrentielle', heading: '1A · Analyse publicitaire concurrentielle', deliverable: null, needsMechanism: false },
  { key: 's1b', label: "1B · L'offre (document interne)", heading: "1B · L'offre, document interne", deliverable: null, needsMechanism: false },
  { key: 's1c', label: '1C · La page client', heading: '1C · La page client', deliverable: { type: 'offre', phase: 'offre', title: 'Offre de trafic froid — page client' }, needsMechanism: false },
  { key: 's2', label: '2 · La VSL', heading: '5. Étape 2 — La VSL', deliverable: { type: 'vsl_script', phase: 'vsl', title: 'Script de la VSL' }, needsMechanism: true },
  { key: 's3', label: '3 · La landing page', heading: '6. Étape 3 — La landing page', deliverable: { type: 'landing', phase: 'landing', title: 'Landing page' }, needsMechanism: true },
  { key: 's4', label: "4 · Les scripts d'ads", heading: "7. Étape 4 — Les scripts d'ads", deliverable: { type: 'ads_scripts', phase: 'ads', title: 'Scripts des publicités' }, needsMechanism: true },
  { key: 's5', label: '5 · Les séquences email', heading: '8. Étape 5 — Les séquences email', deliverable: { type: 'sequences', phase: 'sequences', title: 'Séquences email' }, needsMechanism: true },
  { key: 's6', label: '6 · Formulaire Meta et calendrier', heading: '9. Étape 6 — Formulaire Meta et calendrier', deliverable: { type: 'tracking', phase: 'recette', title: 'Formulaire Meta et calendrier' }, needsMechanism: true },
  { key: 's7', label: '7 · La structure de campagne', heading: '10. Étape 7 — La structure de campagne', deliverable: { type: 'campagne', phase: 'lancement', title: 'Structure de campagne' }, needsMechanism: true },
  { key: 's8', label: '8 · Le point hebdomadaire', heading: '11. Étape 8 — Le point hebdomadaire', deliverable: null, needsMechanism: true, recurring: true },
];
export const DELIVERY_STEP_BY_KEY = new Map(DELIVERY_STEPS.map((s) => [s.key, s]));

/**
 * Infos de base exigées avant tout lancement (§14 du master prompt), lues dans l'onboarding.
 * Les ressources (logo, captures, témoignages) ne sont PAS bloquantes : le dossier Drive suffit quand il existe.
 */
export const DELIVERY_REQUIRED_ANSWERS: { key: string; label: string }[] = [
  { key: 'q01', label: "Nom et description de l'entreprise" },
  { key: 'q02', label: 'URL du site' },
  { key: 'fondateur_pourquoi', label: 'Histoire du fondateur' },
  { key: 'ue_ticket', label: 'Ticket mensuel moyen' },
  { key: 'ue_duree', label: "Durée de vie d'un client" },
  { key: 'ue_closing', label: 'Taux de closing en démo' },
  { key: 'ue_capacite', label: 'Capacité de rendez-vous par semaine' },
  { key: 'q26', label: 'Garantie prévue' },
  { key: 'q33', label: 'Concurrents cités' },
  { key: 'q21', label: 'Client idéal' },
  { key: 'q22', label: 'Marchés (secteurs) où il vend' },
];

export function deliveryGate(onboardingSubmittedAt: string | null, answers: Record<string, string | null | undefined>) {
  const missing: string[] = [];
  if (!onboardingSubmittedAt) missing.push("Formulaire d'onboarding envoyé");
  for (const r of DELIVERY_REQUIRED_ANSWERS) {
    const q = QUESTION_BY_KEY.get(r.key);
    if (!q || !isAnswered(q, answers[r.key])) missing.push(r.label);
  }
  return { ok: missing.length === 0, missing };
}

/** Étapes rédigées d'un coup au lancement (0 à 7) ; le point hebdomadaire (8) se demande chaque semaine. */
export const CHAIN_STEPS = DELIVERY_STEPS.filter((s) => !s.recurring).map((s) => s.key);

/**
 * Une étape est ouverte dès que les conditions de lancement sont remplies (décision 0009 : Claude rédige toute la chaîne,
 * l'agence valide chaque pièce). La VSL et la suite ne se valident qu'une fois le mécanisme nommé fixé.
 */
export function stepAvailability(_key: string, ctx: { gateOk: boolean }): { available: boolean; reason: string | null } {
  if (!ctx.gateOk) return { available: false, reason: "Conditions de lancement non remplies (onboarding et infos de base)." };
  return { available: true, reason: null };
}

export function validationBlocker(step: DeliveryStep, ctx: { hasContent: boolean; mechanism: string | null; stale: boolean }): string | null {
  if (step.recurring) return 'Le point hebdomadaire est récurrent : il ne se valide pas.';
  if (!ctx.hasContent) return "Rien à valider : le livrable n'a pas encore de contenu.";
  if (ctx.stale) return 'Une étape en amont a changé : régénérez cette pièce ou gardez-la telle quelle avant de valider.';
  if ((step.needsMechanism || step.key === 's1c') && !ctx.mechanism) return 'Le nom du mécanisme n\'est pas fixé (étape 1C).';
  return null;
}

/** Consignes d'une étape, extraites du master prompt (de son titre au titre de même niveau suivant). */
export function stepInstructions(step: DeliveryStep, md: string = MASTER_PROMPT): string {
  return masterSection(step.heading, md);
}

/** Règles valables pour toutes les étapes, jointes à chaque brief : règles d'or et garde-fous du master prompt. */
export const ALWAYS_SECTIONS = ["2. Les règles d'or", '13. Garde-fous'];

/** Une section du master prompt, de son titre au titre de même niveau suivant. */
export function masterSection(heading: string, md: string = MASTER_PROMPT): string {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => /^#{2,3} /.test(l) && l.replace(/^#+ /, '').trim() === heading);
  if (start < 0) throw new Error(`Section introuvable dans le master prompt : ${heading}`);
  const level = lines[start].match(/^#+/)![0].length;
  let end = lines.length;
  for (let j = start + 1; j < lines.length; j++) {
    const m = lines[j].match(/^(#+) /);
    if (m && m[1].length <= level) { end = j; break; }
  }
  return lines.slice(start, end).join('\n').trim();
}
