/**
 * Module Prospects (section 29, décision 0027) : du R1 au R2, vue agence uniquement.
 * Les calculs (coût maximum d'un rendez-vous, contrôles de qualification) et la vérification des verbatims sont faits ici,
 * par le code : le modèle rédige autour des résultats, il ne calcule pas.
 */

export const PROSPECT_STAGES = ['r1_a_prevoir', 'r1_fait', 'analyse_validee', 'plan_valide', 'loom_envoye', 'r2_planifie', 'signe', 'perdu', 'a_relancer'] as const;
export type ProspectStage = (typeof PROSPECT_STAGES)[number];
export const PROSPECT_STAGE_LABEL: Record<ProspectStage, string> = {
  r1_a_prevoir: 'R1 à prévoir', r1_fait: 'R1 fait', analyse_validee: 'Analyse validée', plan_valide: 'Plan validé', loom_envoye: 'Loom envoyé',
  r2_planifie: 'R2 planifié', signe: 'Signé', perdu: 'Perdu', a_relancer: 'À relancer',
};
export const PROSPECT_VERDICT_LABEL: Record<string, string> = { qualifie: 'Qualifié', a_creuser: 'À creuser', disqualifie: 'Disqualifié' };
export const PROSPECT_DOC_TYPES = ['analyse', 'plan', 'script_loom', 'pitch_r2'] as const;
export type ProspectDocType = (typeof PROSPECT_DOC_TYPES)[number];
export const PROSPECT_DOC_LABEL: Record<ProspectDocType, string> = {
  analyse: 'Analyse post-R1', plan: "Mini plan d'action", script_loom: 'Script du Loom', pitch_r2: 'Pitch R2',
};

/** Chiffres du prospect. Le taux de closing est stocké en ratio (0,25 = 25 %). */
export const PROSPECT_FIGURES = ['ticket_mensuel', 'duree_vie_mois', 'taux_closing', 'capacite_demos_semaine', 'clients_payants', 'budget_pub_jour', 'objectif_3_mois'] as const;
export type ProspectFigure = (typeof PROSPECT_FIGURES)[number];
export const PROSPECT_FIGURE_LABEL: Record<ProspectFigure, { label: string; unit: 'eur' | 'mois' | 'pct' | 'int' | 'eur_jour' }> = {
  ticket_mensuel: { label: 'Ticket mensuel', unit: 'eur' },
  duree_vie_mois: { label: 'Durée de vie client', unit: 'mois' },
  taux_closing: { label: 'Taux de closing', unit: 'pct' },
  capacite_demos_semaine: { label: 'Capacité de démos / semaine', unit: 'int' },
  clients_payants: { label: 'Clients payants', unit: 'int' },
  budget_pub_jour: { label: 'Budget publicitaire / jour', unit: 'eur_jour' },
  objectif_3_mois: { label: 'Nouveaux clients visés sur 3 mois', unit: 'int' },
};
export type Figures = Partial<Record<ProspectFigure, number | null>>;

/** Seuils de qualification (section 29) : coût d'acquisition cible et budget publicitaire minimum. */
export const QUALIF_CAC_MIN_EUR = 195;
export const QUALIF_CAC_MAX_EUR = 326;
export const QUALIF_BUDGET_MIN_EUR_JOUR = 20;
export const DEFAULT_MARGIN = 0.25;

/**
 * Coût maximum d'un rendez-vous = ticket mensuel × durée de vie × marge acceptable × taux de closing.
 * Une hypothèse manquante → pas de résultat (« à confirmer en R2 »), jamais une estimation.
 */
export function maxCostPerAppointment(f: Figures, margin = DEFAULT_MARGIN) {
  const ticket = f.ticket_mensuel ?? null;
  const life = f.duree_vie_mois ?? null;
  const closing = f.taux_closing ?? null;
  const missing = ([['ticket_mensuel', ticket], ['duree_vie_mois', life], ['taux_closing', closing]] as const).filter(([, v]) => v === null || !Number.isFinite(v)).map(([k]) => k);
  const ltv = ticket !== null && life !== null ? ticket * life : null;
  const value = missing.length ? null : Math.round(ticket! * life! * margin * closing! * 100) / 100;
  return { value, missing: missing as ProspectFigure[], margin, ticket, life, closing, ltv };
}

/** Contrôles de qualification calculés : ils éclairent le verdict, ils ne le remplacent pas. */
export function qualificationChecks(f: Figures, sellsInDemo: boolean | null, margin = DEFAULT_MARGIN) {
  const cost = maxCostPerAppointment(f, margin).value;
  const check = (ok: boolean | null, label: string, detail: string) => ({ ok, label, detail });
  return [
    check(f.clients_payants == null ? null : f.clients_payants > 0, 'Clients payants', f.clients_payants == null ? 'à confirmer en R2' : `${f.clients_payants}`),
    check(sellsInDemo, 'Vend en démo', sellsInDemo === null ? 'à confirmer en R2' : sellsInDemo ? 'oui' : 'non'),
    check(cost === null ? null : cost >= QUALIF_CAC_MIN_EUR, `Coût max. d'un RDV ≥ ${QUALIF_CAC_MIN_EUR} € (cible ${QUALIF_CAC_MIN_EUR}–${QUALIF_CAC_MAX_EUR} €)`, cost === null ? 'à confirmer en R2' : `${cost} €`),
    check(f.budget_pub_jour == null ? null : f.budget_pub_jour >= QUALIF_BUDGET_MIN_EUR_JOUR, `Budget pub ≥ ${QUALIF_BUDGET_MIN_EUR_JOUR} €/jour`, f.budget_pub_jour == null ? 'à confirmer en R2' : `${f.budget_pub_jour} €/jour`),
  ];
}

/** Normalisation pour comparer « mot pour mot » : casse, apostrophes, guillemets, tirets, espaces et ponctuation de bord. */
export function normalizeForQuote(s: string): string {
  return s.normalize('NFC').toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”«»"]/g, '')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[\s  ]+/g, ' ')
    .trim()
    .replace(/^[\s.,;:!?'-]+|[\s.,;:!?'-]+$/g, '');
}

/** Chaque verbatim doit se retrouver mot pour mot dans la transcription (ou les notes). Renvoie ceux qui sont introuvables. */
export function checkVerbatims(quotes: string[], sources: string[]): { quote: string; found: boolean }[] {
  const hay = normalizeForQuote(sources.filter(Boolean).join('\n'));
  return quotes.map((q) => {
    const n = normalizeForQuote(q);
    return { quote: q, found: n.length > 0 && hay.includes(n) };
  });
}

/** Tous les champs « verbatim » d'un document structuré (récursif). */
export function collectVerbatims(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) for (const x of node) collectVerbatims(x, out);
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'verbatim') {
        if (typeof v === 'string' && v.trim()) out.push(v.trim());
      } else if (k === 'verbatims' && Array.isArray(v)) {
        for (const x of v) { if (typeof x === 'string' && x.trim()) out.push(x.trim()); }
      } else {
        collectVerbatims(v, out);
      }
    }
  }
  return out;
}

// ─── Trame du R1 ────────────────────────────────────────────────────────────────

export interface TemplateField { key: string; label: string; type: 'text' | 'number' | 'choice' | 'datetime'; options?: string[]; figure?: ProspectFigure; unit?: 'pct' }
export interface TemplateBlock { id: string; time: string; title: string; goal: string; questions: string[]; fields: TemplateField[]; live_calc?: boolean }

/** Trame par défaut, calée sur la vidéo d'immersion (30 minutes, trois temps, deux issues). */
export const DEFAULT_R1_TEMPLATE: TemplateBlock[] = [
  {
    id: 'cadre', time: '0 à 2 min', title: 'Cadre', goal: "Poser le déroulé et l'absence de pression",
    questions: [
      "« On a trente minutes. Je vous pose des questions sur votre situation, on regarde vos chiffres, et à la fin je vous dis si ça a du sens d'aller plus loin. Ça vous va ? »",
      '« Vous avez pu voir la vidéo ? »',
    ],
    fields: [{ key: 'video_vue', label: 'Vidéo vue', type: 'choice', options: ['oui', 'non', 'en partie'] }],
  },
  {
    id: 'situation', time: '2 à 12 min', title: 'Situation et objectifs', goal: "Comprendre d'où viennent les clients et ce qui a déclenché l'appel",
    questions: [
      "« D'où viennent vos clients aujourd'hui ? »",
      "« Qu'est-ce que vous avez déjà essayé, avec qui, pour quel montant ? »",
      '« Pourquoi ça n\'a pas tenu, selon vous ? »',
      '« Qu\'est-ce qui fait que vous regardez ça maintenant ? »',
      '« Où voulez-vous être dans six mois ? »',
      '« Et si rien ne change d\'ici là ? »',
    ],
    fields: [
      { key: 'canaux', label: 'Canaux actuels', type: 'text' },
      { key: 'deja_essaye', label: 'Déjà essayé', type: 'text' },
      { key: 'declencheur', label: 'Déclencheur', type: 'text' },
      { key: 'objectif_6_mois', label: 'Objectif à six mois', type: 'text' },
      { key: 'cout_inaction', label: "Coût de l'inaction", type: 'text' },
    ],
  },
  {
    id: 'compatibilite', time: '12 à 20 min', title: 'Compatibilité', goal: 'Vérifier que le système peut fonctionner chez lui',
    questions: [
      "« Combien de clients payants aujourd'hui ? »",
      '« Vous vendez en démo ? Qui les fait, et combien par semaine pouvez-vous en absorber ? »',
      '« À quel métier vendez-vous le mieux ? Lesquels restent le plus longtemps ? »',
      '« Qui décide avec vous ? »',
    ],
    fields: [
      { key: 'clients_payants', label: 'Clients payants', type: 'number', figure: 'clients_payants' },
      { key: 'vente_demo', label: 'Vente en démo', type: 'choice', options: ['oui', 'non'] },
      { key: 'capacite_demos', label: 'Capacité de démos / semaine', type: 'number', figure: 'capacite_demos_semaine' },
      { key: 'verticales', label: 'Verticales', type: 'text' },
      { key: 'decideurs', label: 'Décideurs', type: 'text' },
    ],
  },
  {
    id: 'estimation', time: '20 à 27 min', title: 'Estimation chiffrée', goal: "Calculer devant lui ce qu'un rendez-vous peut coûter", live_calc: true,
    questions: [
      '« Combien vous rapporte un client par mois ? »',
      '« Combien de temps reste-t-il en moyenne ? »',
      '« Sur dix démos, combien signent ? »',
      '« Combien de nouveaux clients visez-vous sur trois mois ? »',
      '« Quel budget publicitaire pouvez-vous engager par jour ? »',
    ],
    fields: [
      { key: 'ticket', label: 'Ticket mensuel (€)', type: 'number', figure: 'ticket_mensuel' },
      { key: 'duree_vie', label: 'Durée de vie (mois)', type: 'number', figure: 'duree_vie_mois' },
      { key: 'taux_closing', label: 'Taux de closing (%)', type: 'number', figure: 'taux_closing', unit: 'pct' },
      { key: 'objectif_3_mois', label: 'Nouveaux clients visés sur 3 mois', type: 'number', figure: 'objectif_3_mois' },
      { key: 'budget_pub', label: 'Budget publicitaire (€/jour)', type: 'number', figure: 'budget_pub_jour' },
    ],
  },
  {
    id: 'issue', time: '27 à 30 min', title: 'Issue', goal: "Proposer le R2 ou donner le plan d'action",
    questions: [
      "Si compatible : « Je vous propose un second rendez-vous. D'ici là, j'analyse votre marché et je vous envoie une vidéo avec ce que je ferais chez vous. »",
      'Sinon : les deux ou trois choses à faire, dans l\'ordre.',
    ],
    fields: [
      { key: 'issue_r1', label: 'Issue du R1', type: 'choice', options: ['R2 proposé', "Plan d'action donné"] },
      { key: 'date_r2', label: 'Date du R2', type: 'datetime' },
    ],
  },
];

/** Valeur d'une figure saisie dans la trame (pourcentage → ratio). null si vide ou non numérique. */
export function figureFromField(field: TemplateField, raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.').replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n)) return null;
  return field.unit === 'pct' ? n / 100 : n;
}
