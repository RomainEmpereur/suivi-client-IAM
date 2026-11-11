/**
 * Formulaire d'onboarding (§7) : les 43 questions du formulaire Google existant, dans leurs 8 sections,
 * plus les ajouts du cahier des charges (marqués `added: true`).
 * Les clés sont STABLES : elles servent de clé en base (onboarding_answers.question_key). On ne renomme pas
 * une clé existante ; on en ajoute une nouvelle.
 */
export type QuestionType = 'short' | 'long' | 'number' | 'choice' | 'multi';

export interface Question {
  key: string;
  /** Numéro affiché : celui du formulaire Google (1 à 43), ou null pour un ajout. */
  num: number | null;
  label: string;
  type: QuestionType;
  required: boolean;
  hint?: string;
  options?: string[];
  unit?: string;
  added?: boolean;
  /** Alimente clients.unit_economics_json (plafond du coût par rendez-vous, §14). */
  unitEconomics?: 'monthly_ticket_cents' | 'lifetime_months' | 'gross_margin' | 'demo_close_rate' | 'weekly_appointment_capacity';
}

export interface Section {
  key: string;
  title: string;
  questions: Question[];
}

const q = (key: string, num: number | null, label: string, type: QuestionType = 'long', extra: Partial<Question> = {}): Question =>
  ({ key, num, label, type, required: true, ...extra });

export const ONBOARDING_SECTIONS: Section[] = [
  {
    key: 'entreprise', title: "L'entreprise et le contexte",
    questions: [
      q('q01', 1, "Nom et description de l'entreprise"),
      q('q02', 2, 'Lien du site web', 'short'),
      q('q03', 3, 'Revenus mensuels récurrents actuels', 'short', { hint: 'MRR à date, en euros.' }),
      q('q04', 4, 'Combien de clients actifs actuellement ? Et quel est le ticket moyen par client (par mois) ?', 'short'),
      q('q05', 5, 'En quelques phrases, décrivez ce que propose votre entreprise'),
      q('q06', 6, "Quelle est la mission / vision de l'entreprise ?"),
      q('q07', 7, "Quels canaux d'acquisition avez-vous actuellement en place ?", 'multi', {
        options: ['Cold call', 'Cold email', 'Références', 'Salons professionnels', 'Publicités payantes', 'Prospection LinkedIn'],
      }),
      q('fondateur_pourquoi', null, 'Pourquoi avez-vous créé ce produit ? Racontez le moment précis où vous avez décidé de vous lancer.', 'long', {
        added: true, hint: "L'histoire du fondateur nourrit la VSL et les emails : un lieu, une date, une scène.",
      }),
      q('fondateur_echec', null, 'Racontez un échec ou un moment difficile dans cette histoire, et ce que vous en avez tiré.', 'long', { added: true }),
    ],
  },
  {
    key: 'service', title: 'Le service',
    questions: [
      q('q08', 8, "Décrivez en détail votre service : qu'est-ce que vous livrez exactement ?"),
      q('q09', 9, 'Quelles sont les fonctionnalités clés de votre SaaS ?'),
      q('q10', 10, "Est-ce qu'il y a une maintenance après achat ?", 'short'),
      q('q11', 11, "Qu'est-ce qui rend votre SaaS différent de ce qu'on trouve ailleurs ?"),
    ],
  },
  {
    key: 'douleurs', title: 'Douleurs résolues et bénéfices apportés',
    questions: [
      q('q12', 12, "Quels sont les plus gros problèmes que vos clients avaient avant d'utiliser votre SaaS, et qu'ils ont pu résoudre grâce à lui ?"),
      q('q13', 13, "Qu'est-ce que ces problèmes leur coûtaient concrètement ? (temps, argent, stress)"),
      q('q14', 14, 'Quels résultats concrets vos clients obtiennent-ils après avoir utilisé votre produit ?'),
      q('q15', 15, "Quel est le résultat le plus impressionnant qu'un de vos clients a obtenu ?"),
      q('cas_chiffre', null, 'Un cas client chiffré : qui, situation de départ, ce qui a été mis en place, résultat mesuré et en combien de temps.', 'long', { added: true }),
      q('cas_accord', null, 'Avons-nous votre accord, et celui du client, pour le citer nommément ?', 'choice', {
        added: true, options: ['Oui, nommément', 'Oui, de façon anonyme', 'Non', 'À demander au client'],
      }),
      q('q16', 16, "Qu'est-ce que vos clients peuvent faire ou obtenir APRÈS votre intervention, qu'ils ne pouvaient pas faire AVANT ?"),
      q('q17', 17, "Quelles objections reviennent le plus souvent avant l'achat ?"),
      q('q18', 18, 'Comment répondez-vous à ces objections ?'),
      q('q19', 19, "Qu'est-ce qui pousse un client à chercher une solution comme la vôtre maintenant ? Quel événement déclenche sa décision ?"),
      q('q20', 20, "Aujourd'hui, comment vos clients gèrent-ils ce problème avant de vous connaître ? (outil, méthode manuelle, tableur, concurrent) Et pourquoi ça ne suffit pas ?"),
      q('frein_habitude', null, 'Qu’est-ce qui retient vos prospects de changer, même quand ils reconnaissent le problème ?', 'long', {
        added: true, hint: "L'habitude : « on a toujours fait comme ça », un outil déjà payé, une équipe formée…",
      }),
      q('frein_anxiete', null, "Qu'est-ce qui les inquiète au moment de décider ?", 'long', {
        added: true, hint: "L'anxiété : migration des données, adoption par l'équipe, peur de se tromper devant la direction…",
      }),
    ],
  },
  {
    key: 'icp', title: 'Le client idéal',
    questions: [
      q('q21', 21, 'Qui est votre client idéal ? (poste, taille d’entreprise, secteur, douleur principale, etc.)'),
      q('avatar_journee', null, 'Décrivez une journée de votre client idéal : ce qu’il fait à 8 h, ce qui l’agace, ce qu’il se dit.', 'long', {
        added: true, hint: 'Une scène, pas une catégorie. Ses mots à lui, si possible.',
      }),
      q('q22', 22, "Dans quels secteurs d'activité vos meilleurs clients opèrent-ils ?"),
      q('q23', 23, "Qui prend les décisions d'achat chez vos clients ?", 'short'),
      q('q24', 24, "Quelles sont les caractéristiques d'un mauvais client pour vous ?"),
      q('q25', 25, 'Quel est le profil de votre meilleur client actuel ?'),
    ],
  },
  {
    key: 'offre', title: "L'offre et la tarification",
    questions: [
      q('q26', 26, 'Avez-vous une garantie / promesse de résultats ?', 'short'),
      q('q27', 27, 'Décrivez votre processus de vente actuel en détail (de la prise de contact à la signature)'),
      q('q28', 28, 'Avez-vous des témoignages ou des études de cas clients ?', 'short'),
      q('q29', 29, 'Combien de temps dure le cycle de vente en moyenne ?', 'short'),
      q('ue_ticket', null, 'Ticket mensuel moyen par client', 'number', { added: true, unit: '€ / mois', unitEconomics: 'monthly_ticket_cents' }),
      q('ue_duree', null, "Durée de vie moyenne d'un client", 'number', { added: true, unit: 'mois', unitEconomics: 'lifetime_months' }),
      q('ue_marge', null, 'Marge brute', 'number', { added: true, unit: '%', unitEconomics: 'gross_margin' }),
      q('ue_closing', null, 'Taux de closing en démo (sur 10 démos tenues, combien signent ?)', 'number', { added: true, unit: '%', unitEconomics: 'demo_close_rate' }),
    ],
  },
  {
    key: 'equipe', title: "L'équipe et le fonctionnement interne",
    questions: [
      q('q30', 30, 'Combien de personnes composent l’équipe et quels sont leurs rôles ?'),
      q('q31', 31, 'Quelle est la capacité de production actuelle ?', 'short'),
      q('ue_capacite', null, 'Combien de rendez-vous commerciaux pouvez-vous absorber par semaine ?', 'number', {
        added: true, unit: 'RDV / semaine', unitEconomics: 'weekly_appointment_capacity',
      }),
      q('q32', 32, "Quels sont vos goulots d'étranglement aujourd'hui ?"),
    ],
  },
  {
    key: 'positionnement', title: 'Positionnement et marché',
    questions: [
      q('q33', 33, 'Qui sont vos principaux concurrents directs ?'),
      q('q34', 34, 'Quelle est votre proposition de valeur en une phrase ?'),
      q('q35', 35, 'Quel est le message que vous voulez que vos prospects retiennent ?'),
      q('q36', 36, 'Y a-t-il des croyances ou idées reçues dans votre marché que vous voulez briser ?'),
      q('q37', 37, 'Quels sont les mots / phrases que vos clients utilisent pour décrire leurs problèmes ?'),
    ],
  },
  {
    key: 'campagne', title: 'Objectifs de la campagne et contraintes',
    questions: [
      q('q38', 38, "Quel est pour vous l'objectif principal de cette première campagne Meta ?"),
      q('q39', 39, 'Y a-t-il des contraintes légales, sectorielles ou de communication à respecter ?', 'short'),
      q('q40', 40, "À quoi ressemble le succès pour vous d'ici 90 jours ?"),
      q('q41', 41, 'Quel est le budget publicitaire mensuel disponible ?', 'choice', {
        options: ['20 à 30 € / jour', '30 à 50 € / jour', '50 à 100 € / jour'],
      }),
      q('q42', 42, 'Quel est votre coût par lead cible (si vous en avez une idée) ?', 'short'),
      q('q43', 43, 'Combien de nouveaux clients voulez-vous acquérir tous les mois ?', 'short'),
    ],
  },
];

export const ALL_QUESTIONS: (Question & { section: string })[] =
  ONBOARDING_SECTIONS.flatMap((s) => s.questions.map((x) => ({ ...x, section: s.key })));

export const QUESTION_BY_KEY = new Map(ALL_QUESTIONS.map((x) => [x.key, x]));

/** Une réponse est « remplie » si elle n'est pas vide (et, pour un choix multiple, au moins une case). */
export function isAnswered(q: Question, value: string | null | undefined): boolean {
  if (value == null) return false;
  const v = value.trim();
  if (!v) return false;
  if (q.type === 'multi') {
    try { return (JSON.parse(v) as unknown[]).length > 0; } catch { return false; }
  }
  if (q.type === 'number') return Number.isFinite(Number(v.replace(',', '.')));
  return true;
}

/** Validation de la forme d'une réponse avant écriture. Renvoie un message d'erreur ou null. */
export function validateAnswer(q: Question, value: string): string | null {
  if (value.length > 20_000) return 'Réponse trop longue (20 000 caractères maximum).';
  if (!value.trim()) return null; // vider un champ est permis
  if (q.type === 'number' && !Number.isFinite(Number(value.trim().replace(',', '.')))) return 'Un nombre est attendu.';
  if (q.type === 'choice' && !q.options!.includes(value)) return 'Choix invalide.';
  if (q.type === 'multi') {
    try {
      const arr = JSON.parse(value);
      if (!Array.isArray(arr) || arr.some((x) => !q.options!.includes(x))) return 'Choix invalide.';
    } catch { return 'Choix invalide.'; }
  }
  return null;
}

export function sectionProgress(section: Section, answers: Record<string, string | null | undefined>) {
  const required = section.questions.filter((x) => x.required);
  const done = required.filter((x) => isAnswered(x, answers[x.key])).length;
  return { done, total: required.length, complete: done === required.length };
}

export function missingRequired(answers: Record<string, string | null | undefined>, sectionKeys?: string[]) {
  return ALL_QUESTIONS.filter((x) => x.required && (!sectionKeys || sectionKeys.includes(x.section)) && !isAnswered(x, answers[x.key]));
}

/** Conversion des réponses chiffrées vers clients.unit_economics_json (montants en centimes, taux en 0..1). */
export function unitEconomicsFromAnswers(answers: Record<string, string | null | undefined>) {
  const out: Record<string, number> = {};
  for (const x of ALL_QUESTIONS) {
    if (!x.unitEconomics) continue;
    const raw = answers[x.key];
    if (!raw || !isAnswered(x, raw)) continue;
    const n = Number(raw.trim().replace(',', '.'));
    if (x.unitEconomics === 'monthly_ticket_cents') out[x.unitEconomics] = Math.round(n * 100);
    else if (x.unitEconomics === 'gross_margin' || x.unitEconomics === 'demo_close_rate') out[x.unitEconomics] = n / 100;
    else out[x.unitEconomics] = n;
  }
  return out;
}
