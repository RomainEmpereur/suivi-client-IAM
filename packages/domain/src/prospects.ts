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
export const PROSPECT_DOC_TYPES = ['analyse', 'recherche', 'plan', 'script_loom', 'pitch_r2', 'proposition'] as const;
export type ProspectDocType = (typeof PROSPECT_DOC_TYPES)[number];
export const PROSPECT_DOC_LABEL: Record<ProspectDocType, string> = {
  analyse: 'Analyse post-R1', recherche: 'Recherche marché', plan: "Mini plan d'action", script_loom: 'Script du Loom', pitch_r2: 'Pitch R2', proposition: 'Proposition commerciale',
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

// ─── Trame complétée depuis la transcription, et vérification de la fiche ─────

/** Champs de la trame qu'une transcription peut compléter : textes et choix, hors chiffres (repris dans `chiffres`) et hors dates. */
export function autofillFields(blocks: TemplateBlock[]): TemplateField[] {
  return blocks.flatMap((b) => b.fields).filter((f) => !f.figure && f.type !== 'datetime');
}

export type TrameOrigin = 'trame' | 'transcription' | 'manuel';
export interface CompletenessItem { key: string; label: string; block: string; status: TrameOrigin | 'manquant'; value: string | null; verbatim: string | null }

/** Ce qui est rempli dans la fiche, et d'où ça vient. Les notes portent `_origines` et `_verbatims` pour les champs déduits de la transcription. */
export function trameCompleteness(
  blocks: TemplateBlock[], notes: Record<string, unknown>,
  figures: Partial<Record<ProspectFigure, { value: number | null; origin: string | null }>>,
): CompletenessItem[] {
  const origins = (notes._origines && typeof notes._origines === 'object' ? notes._origines : {}) as Record<string, string>;
  const verbatims = (notes._verbatims && typeof notes._verbatims === 'object' ? notes._verbatims : {}) as Record<string, string>;
  const out: CompletenessItem[] = [];
  for (const b of blocks) {
    for (const f of b.fields) {
      if (f.figure) {
        const fig = figures[f.figure];
        const has = fig && fig.value !== null && fig.value !== undefined;
        out.push({
          key: f.key, label: f.label, block: b.title,
          status: has ? ((fig!.origin as TrameOrigin) ?? 'trame') : 'manquant',
          value: has ? String(f.unit === 'pct' ? Math.round(fig!.value! * 1000) / 10 : fig!.value) : null, verbatim: null,
        });
        continue;
      }
      const raw = notes[f.key];
      const v = raw === null || raw === undefined ? '' : String(raw).trim();
      out.push({
        key: f.key, label: f.label, block: b.title,
        status: v ? (origins[f.key] === 'transcription' ? 'transcription' : 'trame') : 'manquant',
        value: v || null, verbatim: v && origins[f.key] === 'transcription' ? verbatims[f.key] ?? null : null,
      });
    }
  }
  return out;
}

// ─── Mise à jour de l'analyse depuis la fiche (décision 0031) ─────────────────

/** Valeur lisible d'un chiffre (pour la fiche de l'analyse). */
export function figureText(k: ProspectFigure, v: number | null | undefined): string | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const u = PROSPECT_FIGURE_LABEL[k].unit;
  const n = (x: number) => String(Math.round(x * 100) / 100).replace('.', ',');
  return u === 'pct' ? `${n(v * 100)} %` : u === 'eur' ? `${n(v)} €` : u === 'eur_jour' ? `${n(v)} €/jour` : u === 'mois' ? `${n(v)} mois` : n(v);
}

/** Champs de la fiche de l'analyse alimentés par les chiffres. */
const FICHE_FROM_FIGURE: [string, ProspectFigure][] = [
  ['ticketMensuel', 'ticket_mensuel'], ['dureeVieClient', 'duree_vie_mois'], ['tauxClosing', 'taux_closing'],
  ['capaciteDemos', 'capacite_demos_semaine'], ['clientsPayants', 'clients_payants'], ['budgetPublicitaire', 'budget_pub_jour'],
];
/** Mots qui désignent un chiffre dans les listes « à confirmer » et les raisons du verdict. */
const FIGURE_WORDS: Record<ProspectFigure, RegExp> = {
  ticket_mensuel: /ticket|panier|abonnement mensuel/i,
  duree_vie_mois: /dur[ée]e de vie|r[ée]tention/i,
  taux_closing: /closing|taux de signature/i,
  capacite_demos_semaine: /capacit[ée]/i,
  clients_payants: /clients payants/i,
  budget_pub_jour: /budget/i,
  objectif_3_mois: /objectif|3 mois|trois mois/i,
};
const COST_WORDS = /co[uû]t max|co[uû]t maximum/i;

/**
 * « Mettre à jour » l'analyse (décision 0031) : reprend, sans réécriture par Claude, ce que Romain a saisi depuis
 * dans la trame et les chiffres. Chiffres, fiche, champs de la trame, coût maximum et contrôles recalculés par le code ;
 * les points « à confirmer » désormais renseignés disparaissent. Le verdict lui-même (jugement) ne change pas.
 */
export function refreshAnalyse(
  content: Record<string, unknown>,
  ctx: { figures: Figures; notes: Record<string, unknown>; blocks: TemplateBlock[]; margin: number; sellsInDemo: boolean | null },
): { content: Record<string, unknown>; changed: string[] } {
  const out = JSON.parse(JSON.stringify(content ?? {})) as Record<string, unknown>;
  const changed: string[] = [];
  const has = (k: ProspectFigure) => ctx.figures[k] !== null && ctx.figures[k] !== undefined && Number.isFinite(ctx.figures[k] as number);

  // Chiffres : ceux de la fiche (trame, corrections de Romain, transcription), une absence reste null.
  const chiffres = { ...((out.chiffres && typeof out.chiffres === 'object' ? out.chiffres : {}) as Record<string, unknown>) };
  for (const k of PROSPECT_FIGURES) {
    const v = has(k) ? ctx.figures[k]! : null;
    if (chiffres[k] !== v) { chiffres[k] = v; changed.push(`chiffres.${k}`); }
  }
  out.chiffres = chiffres;

  // Fiche : valeurs chiffrées lisibles, décideurs saisis dans la trame.
  const fiche = { ...((out.fiche && typeof out.fiche === 'object' ? out.fiche : {}) as Record<string, unknown>) };
  for (const [field, k] of FICHE_FROM_FIGURE) {
    const t = figureText(k, ctx.figures[k]);
    if (t && fiche[field] !== t) { fiche[field] = t; changed.push(`fiche.${field}`); }
  }
  const origins = (ctx.notes._origines && typeof ctx.notes._origines === 'object' ? ctx.notes._origines : {}) as Record<string, string>;
  const typed = (key: string) => {
    const v = ctx.notes[key];
    return typeof v === 'string' && v.trim() && origins[key] !== 'transcription' ? v.trim() : null;
  };
  const dec = typed('decideurs');
  if (dec && fiche.decideurs !== dec) { fiche.decideurs = dec; changed.push('fiche.decideurs'); }
  out.fiche = fiche;

  // Trame : un champ saisi par Romain remplace la valeur déduite (sans citation : c'est sa saisie).
  if (out.trame && typeof out.trame === 'object') {
    const trame = { ...(out.trame as Record<string, unknown>) };
    for (const f of autofillFields(ctx.blocks)) {
      const v = typed(f.key);
      const cur = trame[f.key] as { valeur?: unknown } | undefined;
      if (v && cur?.valeur !== v) { trame[f.key] = { valeur: v, verbatim: null }; changed.push(`trame.${f.key}`); }
    }
    out.trame = trame;
  }

  // À confirmer en R2 : un point qui porte sur un chiffre désormais renseigné disparaît.
  const filledWords = PROSPECT_FIGURES.filter(has).map((k) => FIGURE_WORDS[k]);
  const cost = maxCostPerAppointment(ctx.figures, ctx.margin);
  if (Array.isArray(out.aConfirmerEnR2)) {
    const before = out.aConfirmerEnR2.length;
    out.aConfirmerEnR2 = out.aConfirmerEnR2.filter((x) => {
      const s = typeof x === 'string' ? x : JSON.stringify(x);
      if (cost.value !== null && COST_WORDS.test(s)) return false;
      return !filledWords.some((re) => re.test(s));
    });
    if ((out.aConfirmerEnR2 as unknown[]).length !== before) changed.push('aConfirmerEnR2');
  }

  // Raisons du verdict : les lignes chiffrées sont refaites par le code ; le verdict ne change pas.
  if (out.verdict && typeof out.verdict === 'object') {
    const verdict = { ...(out.verdict as Record<string, unknown>) };
    const raisons = Array.isArray(verdict.raisons) ? (verdict.raisons as unknown[]).filter((x) => typeof x === 'string') as string[] : [];
    const kept = raisons.filter((r) => !COST_WORDS.test(r) && !/^Budget pub/i.test(r) && !/^Clients payants/i.test(r) && !/^Calcul (du code|mis à jour)/i.test(r));
    const computed = qualificationChecks(ctx.figures, ctx.sellsInDemo, ctx.margin)
      .filter((q) => q.label !== 'Vend en démo')
      .map((q) => `Calcul mis à jour — ${q.label} : ${q.ok === null ? 'à confirmer en R2' : q.ok ? 'oui' : 'non'} (${q.detail})`);
    const next = [...computed, ...kept];
    if (JSON.stringify(next) !== JSON.stringify(raisons)) { verdict.raisons = next; changed.push('verdict.raisons'); }
    out.verdict = verdict;
  }
  return { content: out, changed };
}

// ─── Contexte du tunnel de vente des SaaS (décision 0032) ─────────────────────

/**
 * Ce qu'Obsidian Partners installe chez ses clients SaaS, joint aux briefs du plan, du script du Loom et du pitch R2.
 * Valeur par défaut, modifiable dans les réglages Prospects (clé `prospects_contexte_tunnel`). Aucun prix.
 */
export const DEFAULT_TUNNEL_CONTEXT = `Ce qu'Obsidian Partners installe pour un éditeur de SaaS B2B (le plan applique cette méthode au marché du prospect) :
- Une seule verticale à la fois, choisie sur trois critères : des clients contents existants, le ticket le plus élevé, la douleur la plus forte.
- Une offre de trafic froid écrite pour cette verticale : l'avatar, son problème, le mécanisme nommé du logiciel, la promesse et la preuve.
- Des publicités vidéo Meta de 45 à 60 secondes qui parlent à l'avatar dès la première phrase (« Si vous dirigez… »), trois angles testés en même temps.
- Un formulaire instantané Meta de trois questions qui filtre les curieux et donne accès à une présentation vidéo.
- Une page avec la vidéo de présentation (VSL) et le calendrier de réservation de la démo, puis des séquences email et un rappel rapide de ceux qui n'ont pas réservé.
- La démo est faite par l'équipe du client ; tout est construit sur ses comptes (publicités, pages, CRM), il en reste propriétaire.
- Le pilotage se fait sur un seul chiffre : le coût par rendez-vous, comparé au coût maximum qu'un rendez-vous peut coûter (calculé à partir du ticket, de la durée de vie, de la marge et du taux de closing).
- Lancement prudent : 20 à 30 € par jour pendant deux à trois semaines (700 à 1 000 € le premier mois) pour laisser Meta apprendre (une cinquantaine de leads) et mesurer le coût par rendez-vous, puis augmentation par paliers seulement quand ce coût tient.
- Un espace client suit tout : chiffres, rendez-vous, livrables.`;

// ─── Proposition commerciale (décision 0034) ──────────────────────────────────

/** Parties de la proposition rédigées par Claude, à partir de l'analyse et du plan validés. */
export const PROPOSAL_AI_FIELDS = ['SITUATION', 'OBJECTIFS', 'DEJA_ESSAYE', 'PLAN', 'CAS_CLIENT', 'PROCHAINES_ETAPES'] as const;
export type ProposalAiField = (typeof PROPOSAL_AI_FIELDS)[number];
/** Parties remplies par le code : identité, date et prix (jamais par Claude). */
export const PROPOSAL_CODE_FIELDS = ['ENTREPRISE', 'PROSPECT', 'DATE', 'PRIX_MISE_EN_PLACE', 'PRIX_RESULTAT', 'CONDITION_RESULTAT'] as const;

export interface ProposalOffer { setup: string; success: string; condition: string }
export const DEFAULT_PROPOSAL_OFFER: ProposalOffer = {
  setup: '1 500 €',
  success: '1 500 €',
  condition: 'une fois 30 démos ajoutées à votre agenda avec votre avatar client',
};

export const DEFAULT_PROPOSAL_TEMPLATE = `# Proposition commerciale — {{ENTREPRISE}}

**Préparée pour** {{PROSPECT}} · **le** {{DATE}} · **par** Romain Auroux, Obsidian Partners

## 1. Où vous en êtes aujourd'hui

{{SITUATION}}

## 2. Ce que vous voulez atteindre

{{OBJECTIFS}}

## 3. Ce que vous avez déjà essayé

{{DEJA_ESSAYE}}

## 4. Ce que nous construisons pour vous

Un système d'acquisition complet, construit dans vos propres comptes, pour remplir votre agenda de démos avec votre client idéal :

- **L'offre** : votre offre d'entrée, formulée pour des prospects qui ne vous connaissent pas encore.
- **La page et la vidéo de présentation** : une page de réservation et une vidéo de 6 à 8 minutes, tournée par vous à partir de notre script.
- **Les publicités Meta** : les scripts, les visuels et la mise en ligne des campagnes.
- **Les relances** : les séquences email et SMS qui amènent chaque inscrit jusqu'à la démo.
- **Le CRM et l'agenda** : GoHighLevel paramétré (pipeline, agenda, rappels) pour que chaque démo soit suivie.
- **Le pilotage** : un suivi chaque semaine dans votre espace client, avec le coût par démo et nos recommandations.

{{PLAN}}

## 5. Un cas proche du vôtre

{{CAS_CLIENT}}

## 6. L'investissement

- **Mise en place : {{PRIX_MISE_EN_PLACE}}**, à la signature.
- **{{PRIX_RESULTAT}}** {{CONDITION_RESULTAT}}.
- Le budget publicitaire est réglé directement par vous à Meta ; il n'est pas compris dans ces montants.

## 7. Ce qui vous appartient

Les comptes publicitaires, le CRM, les pages, les vidéos et les publicités sont créés à votre nom et restent à vous, que nous continuions ensemble ou non.

## 8. Prochaines étapes

{{PROCHAINES_ETAPES}}

---

Romain Auroux · Obsidian Partners
`;

/** Remplace les {{CHAMPS}} du modèle ; un champ sans valeur devient « [à compléter] » (rien d'inventé). */
export function renderProposal(template: string, values: Partial<Record<string, string | null | undefined>>): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, k: string) => {
    const v = values[k];
    return typeof v === 'string' && v.trim() ? v.trim() : '[à compléter]';
  });
}

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function inlineHtml(s: string) {
  return escHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
}

/** Markdown simple (titres, paragraphes, listes, citations, gras, italique, liens, séparateur) → HTML, converti en Google Doc par Drive. */
export function proposalHtml(markdown: string, title: string): string {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  const flush = () => {
    if (para.length) { out.push(`<p>${inlineHtml(para.join(' '))}</p>`); para = []; }
    if (list) { out.push(`</${list}>`); list = null; }
  };
  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if (!line.trim()) { flush(); continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { flush(); out.push(`<h${m[1].length}>${inlineHtml(m[2])}</h${m[1].length}>`); continue; }
    if (/^-{3,}$/.test(line.trim())) { flush(); out.push('<hr>'); continue; }
    if ((m = line.match(/^>\s?(.*)$/))) { flush(); out.push(`<blockquote>${inlineHtml(m[1])}</blockquote>`); continue; }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/)) || (m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      const kind = /^\s*\d/.test(line) ? 'ol' : 'ul';
      if (para.length) { out.push(`<p>${inlineHtml(para.join(' '))}</p>`); para = []; }
      if (list !== kind) { if (list) out.push(`</${list}>`); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inlineHtml(m[1])}</li>`);
      continue;
    }
    if (list) { out.push(`</${list}>`); list = null; }
    para.push(line.trim());
  }
  flush();
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(title)}</title></head><body>${out.join('\n')}</body></html>`;
}
