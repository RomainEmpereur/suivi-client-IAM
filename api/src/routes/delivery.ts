import { Hono, type Context } from 'hono';
import {
  ALL_QUESTIONS, ALWAYS_SECTIONS, CHAIN_STEPS, DELIVERY_STEPS, DELIVERY_STEP_BY_KEY, MASTER_PROMPT, ONBOARDING_SECTIONS, deliveryGate, derived,
  formatDate, formatEuros, formatInt, formatPercent, type Integrations, isAnswered, masterSection, stepAvailability, stepInstructions, validationBlocker,
  type DeliveryStep,
} from '@obsidian/domain';
import type { AppEnv, Bindings, ClientRow } from '../env.ts';
import { requireAgency } from '../auth.ts';
import { scopeClient } from '../scope.ts';
import { all, audit, first, newId, nowIso } from '../db.ts';
import { HttpError, notFound } from '../errors.ts';
import { clientTotals, periodBounds } from '../metrics.ts';

/**
 * Delivery automatique (décisions 0008 et 0009).
 * - Après l'onboarding, l'agence lance la chaîne : Claude (tâche planifiée Claude Code, sur l'abonnement de l'agence)
 *   rédige les étapes 0 à 7 dans l'ordre et dépose chaque pièce via /api/robot. Aucun modèle n'est appelé par le Worker.
 * - L'agence relit, modifie, demande une reprise avec consigne, et valide. Une pièce client validée est publiée
 *   aussitôt dans l'espace du client (livrable mis en page).
 * - La génération ne valide ni ne publie jamais rien.
 */
export const delivery = new Hono<AppEnv>();
delivery.use('/:clientId/delivery', scopeClient);
delivery.use('/:clientId/delivery/*', scopeClient);
delivery.use('/:clientId/delivery', async (c, next) => { requireAgency(c); await next(); });
delivery.use('/:clientId/delivery/*', async (c, next) => { requireAgency(c); await next(); });

/** Master prompt complet (pour un travail manuel dans le projet Claude). Agence uniquement. */
export const deliveryAgency = new Hono<AppEnv>();
deliveryAgency.get('/delivery/master-prompt', (c) => { requireAgency(c); return c.json({ text: MASTER_PROMPT }); });

interface StepRow {
  id: string; client_id: string; step: string; status: 'a_faire' | 'en_cours' | 'a_valider' | 'valide';
  result_url: string | null; notes: string | null; validated_at: string | null; updated_at: string;
  content_md: string | null; content_version: number; content_source: string | null; generated_at: string | null;
  queued_at: string | null; instruction: string | null; stale: number; last_error: string | null;
  integrations_json?: string | null;
}

const MAX_CONTENT = 200_000;
const MAX_INSTRUCTION = 2_000;

/** Verticale (décision 0024) : clé d'étape stockée « s1c@<id> » ; '' = verticale principale. */
export interface VerticalRow {
  id: string; client_id: string; name: string; avatar: string; market: string | null; competitors: string | null;
  promise_changes: string | null; notes: string | null; mechanism: string | null; status: string; created_at: string;
}
const SEP = '@';
/** « s1c@vt_x » → { key: 's1c', vid: 'vt_x' } ; « s1c » → { key: 's1c', vid: '' }. */
export function splitStepKey(raw: string) { const i = raw.indexOf(SEP); return i < 0 ? { key: raw, vid: '' } : { key: raw.slice(0, i), vid: raw.slice(i + 1) }; }

async function loadState(db: D1Database, clientId: string, vid = '') {
  const client = await first<ClientRow>(db, 'SELECT * FROM clients WHERE id = ?1', clientId);
  if (!client) throw notFound();
  const vertical = vid ? await first<VerticalRow>(db, 'SELECT * FROM verticals WHERE id = ?1 AND client_id = ?2', vid, clientId) : null;
  if (vid && !vertical) throw notFound();
  const sk = (k: string) => (vid ? `${k}${SEP}${vid}` : k);
  const [answerRows, stepRows, connections, assets] = await Promise.all([
    all<{ question_key: string; answer: string | null }>(db, 'SELECT question_key, answer FROM onboarding_answers WHERE client_id = ?1', clientId),
    all<StepRow>(db, vid ? `SELECT * FROM delivery_steps WHERE client_id = ?1 AND step LIKE ?2`
      : `SELECT * FROM delivery_steps WHERE client_id = ?1 AND instr(step, '${SEP}') = 0`, ...(vid ? [clientId, `%${SEP}${vid}`] : [clientId])),
    all<{ type: string; state: string; external_id: string | null; last_checked_at: string | null; error_message: string | null }>(db,
      'SELECT type, state, external_id, last_checked_at, error_message FROM connections WHERE client_id = ?1', clientId),
    all<{ type: string; file_name: string | null; external_url: string | null; description: string | null }>(db,
      'SELECT type, file_name, external_url, description FROM onboarding_assets WHERE client_id = ?1 ORDER BY created_at', clientId),
  ]);
  const answers = Object.fromEntries(answerRows.map((a) => [a.question_key, a.answer]));
  const gate = deliveryGate(client.onboarding_submitted_at ?? null, answers);
  const byStep = new Map(stepRows.map((r) => [splitStepKey(r.step).key, r]));
  // Verticale : la chaîne principale sert de référence dans les briefs (faits du produit, jamais l'avatar).
  const mainByStep = vid
    ? new Map((await all<StepRow>(db, `SELECT * FROM delivery_steps WHERE client_id = ?1 AND instr(step, '${SEP}') = 0`, clientId)).map((r) => [r.step, r]))
    : null;
  return { client, answers, gate, byStep, connections, assets, vid, vertical, sk, mainByStep,
    mechanism: (vertical ? vertical.mechanism : client.delivery_mechanism) ?? null };
}
type State = Awaited<ReturnType<typeof loadState>>;

const hasContent = (r: StepRow | undefined) => Boolean(r?.content_md?.trim() || r?.result_url);

function serializeStep(s: DeliveryStep, st: State) {
  const row = st.byStep.get(s.key);
  const a = stepAvailability(s.key, { gateOk: st.gate.ok });
  return {
    key: s.key, apiKey: st.sk(s.key), label: s.label, recurring: Boolean(s.recurring), needsMechanism: s.needsMechanism,
    deliverable: s.deliverable ? s.deliverable.title : null,
    status: row?.status ?? 'a_faire', resultUrl: row?.result_url ?? null, notes: row?.notes ?? null,
    validatedAt: row?.validated_at ?? null, updatedAt: row?.updated_at ?? null,
    contentMd: row?.content_md ?? null, contentVersion: row?.content_version ?? 0, contentSource: row?.content_source ?? null,
    generatedAt: row?.generated_at ?? null, queued: Boolean(row?.queued_at), queuedAt: row?.queued_at ?? null,
    instruction: row?.instruction ?? null, stale: Boolean(row?.stale), lastError: row?.last_error ?? null,
    integrations: s.key === 's3' ? parseIntegrations(row?.integrations_json) : null,
    available: a.available, lockedReason: a.reason,
    validationBlocker: validationBlocker(s, { hasContent: hasContent(row), mechanism: st.mechanism, stale: Boolean(row?.stale), connections: st.connections }),
  };
}

delivery.get('/:clientId/delivery', async (c) => {
  const st = await loadState(c.env.DB, c.get('client').id, c.req.query('verticale') ?? '');
  const verticals = await all<VerticalRow>(c.env.DB, `SELECT * FROM verticals WHERE client_id = ?1 AND status = 'active' ORDER BY created_at`, st.client.id);
  return c.json({
    verticalsEnabled: Boolean(st.client.verticals_enabled),
    verticals: verticals.map(serializeVertical),
    vertical: st.vertical ? serializeVertical(st.vertical) : null,
    gate: st.gate,
    mechanism: st.mechanism,
    driveFolderUrl: st.client.drive_folder_url ?? null,
    generationConfigured: Boolean(c.env.DELIVERY_ROBOT_TOKEN),
    steps: DELIVERY_STEPS.map((s) => serializeStep(s, st)),
  });
});

// ─── Verticales (décision 0024) : agence uniquement, activées client par client ───────────────

function readVertical(body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, string | null> = {};
  const field = (k: string, col: string, max: number, required: boolean) => {
    if (partial && !(k in body)) return;
    const v = typeof body[k] === 'string' ? (body[k] as string).trim() : '';
    if (required && !v) throw new HttpError(400, k === 'name' ? 'Nom de la verticale requis.' : "Décrivez l'avatar visé.");
    if (v.length > max) throw new HttpError(400, `${k} : ${max} caractères au plus.`);
    out[col] = v || null;
  };
  field('name', 'name', 120, true);
  field('avatar', 'avatar', 2000, true);
  field('market', 'market', 1000, false);
  field('competitors', 'competitors', 1000, false);
  field('promiseChanges', 'promise_changes', 2000, false);
  field('notes', 'notes', 2000, false);
  if ('status' in body) {
    if (body.status !== 'active' && body.status !== 'archivee') throw new HttpError(400, 'Statut invalide.');
    out.status = body.status as string;
  }
  return out;
}

delivery.post('/:clientId/delivery/verticales', async (c) => {
  const db = c.env.DB;
  const client = c.get('client');
  const user = c.get('user');
  const row = await first<ClientRow>(db, 'SELECT * FROM clients WHERE id = ?1', client.id);
  if (!row?.verticals_enabled) throw new HttpError(409, 'Les verticales ne sont pas activées pour ce client (fiche client).');
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Corps de requête invalide.');
  const f = readVertical(body, false);
  const id = newId('vt');
  await db.prepare('INSERT INTO verticals (id, client_id, name, avatar, market, competitors, promise_changes, notes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
    .bind(id, client.id, f.name, f.avatar, f.market ?? null, f.competitors ?? null, f.promise_changes ?? null, f.notes ?? null).run();
  await audit(db, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'verticale_creation', objectType: 'vertical', objectId: id, after: f });
  return c.json({ ok: true, id }, 201);
});

delivery.patch('/:clientId/delivery/verticales/:verticalId', async (c) => {
  const db = c.env.DB;
  const client = c.get('client');
  const user = c.get('user');
  const v = await first<VerticalRow>(db, 'SELECT * FROM verticals WHERE id = ?1 AND client_id = ?2', c.req.param('verticalId'), client.id);
  if (!v) throw notFound();
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Corps de requête invalide.');
  const f = readVertical(body, true);
  const cols = Object.keys(f);
  if (cols.length) {
    await db.prepare(`UPDATE verticals SET ${cols.map((k, i) => `${k} = ?${i + 1}`).join(', ')}, updated_at = ?${cols.length + 1} WHERE id = ?${cols.length + 2}`)
      .bind(...cols.map((k) => f[k]), nowIso(), v.id).run();
  }
  await audit(db, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'verticale_modification', objectType: 'vertical', objectId: v.id, after: f });
  return c.json({ ok: true });
});

/** Codes d'intégration de la landing (décision 0017). */
function parseIntegrations(json: string | null | undefined): Integrations {
  try { const v = json ? JSON.parse(json) : {}; return { vsl: v.vsl ?? null, calendrier: v.calendrier ?? null }; } catch { return { vsl: null, calendrier: null }; }
}
const MAX_EMBED = 20_000;
const RESOURCE_LABEL: Record<string, string> = {
  logo: 'Logo', charte: 'Charte graphique', captures_produit: 'Captures du produit', temoignage: 'Témoignage',
  enregistrement: 'Enregistrement', acces_site: 'Accès au site', autre: 'Autre',
};

function stepOr404(raw: string) {
  const s = DELIVERY_STEP_BY_KEY.get(splitStepKey(raw).key);
  if (!s) throw notFound();
  return s;
}
const vidOf = (raw: string) => splitStepKey(raw).vid;

export const serializeVertical = (v: VerticalRow) => ({
  id: v.id, name: v.name, avatar: v.avatar, market: v.market, competitors: v.competitors, promiseChanges: v.promise_changes,
  notes: v.notes, mechanism: v.mechanism, status: v.status, createdAt: v.created_at,
});

/** Brief d'une étape (copie manuelle possible dans le projet Claude). */
delivery.get('/:clientId/delivery/:step/brief', async (c) => {
  const step = stepOr404(c.req.param('step'));
  const db = c.env.DB;
  const st = await loadState(db, c.get('client').id, vidOf(c.req.param('step')));
  if (!st.gate.ok) throw new HttpError(409, 'Conditions de lancement non remplies (onboarding et infos de base).');
  const weekly = step.key === 's8' ? await weeklyBlock(db, st.client) : null;
  return c.json({ text: buildBrief(step, st, weekly) });
});

function buildBrief(step: DeliveryStep, st: State, weekly: string | null): string {
  const { client } = st;
  const row = st.byStep.get(step.key);
  const out: string[] = [];
  const v = st.vertical;
  out.push(`# ${client.name}${v ? ` — Verticale « ${v.name} »` : ''} — Étape ${step.label}`);
  out.push('');
  out.push(`Applique le master prompt de delivery au client ${client.name}, pour l'étape ${step.label} uniquement. ` +
    'Consomme les pièces des étapes précédentes reproduites ci-dessous : ne les réinvente pas.');
  out.push('');
  if (v) {
    out.push(`## Verticale : ${v.name}`);
    out.push("Cette chaîne vise un AUTRE avatar que la verticale principale du client. Le produit, l'histoire du fondateur, les chiffres " +
      "unitaires, la garantie et les ressources restent ceux de l'onboarding ; l'avatar, sa douleur, son villain, la promesse, le mécanisme " +
      "nommé, les preuves et les mots viennent de cette verticale. Les pièces de la verticale principale, en fin de brief, sont une " +
      "référence pour les faits du produit : n'en reprends jamais l'avatar ni les accroches.");
    out.push(`- **Avatar visé** : ${v.avatar}`);
    if (v.market) out.push(`- **Marché** : ${v.market}`);
    if (v.competitors) out.push(`- **Concurrents de cette verticale** : ${v.competitors}`);
    if (v.promise_changes) out.push(`- **Ce qui change dans la promesse** : ${v.promise_changes}`);
    if (v.notes) out.push(`- **Notes de l'agence** : ${v.notes}`);
    out.push('');
  }
  if (row?.instruction) {
    out.push("## Consigne de reprise de l'agence (prioritaire)");
    out.push(row.instruction);
    out.push('');
    if (row.content_md) {
      out.push('## Version actuelle à reprendre');
      out.push(row.content_md);
      out.push('');
    }
  }
  if (st.mechanism) {
    out.push(`**Mécanisme nommé retenu (à reprendre mot pour mot) : ${st.mechanism}**`);
    out.push('');
  }

  const prior = DELIVERY_STEPS.slice(0, DELIVERY_STEPS.indexOf(step)).filter((s) => !s.recurring && hasContent(st.byStep.get(s.key)));
  out.push('## Pièces des étapes précédentes');
  if (prior.length === 0) out.push("Aucune : c'est la première étape.");
  for (const s of prior) {
    const r = st.byStep.get(s.key)!;
    out.push(`### ${s.label} (${r.status === 'valide' ? 'validée par l\'agence' : 'brouillon, pas encore validé'})`);
    if (r.result_url) out.push(`Lien : ${r.result_url}`);
    if (r.content_md) out.push(r.content_md.trim());
    out.push('');
  }

  out.push('## Dossier client');
  out.push(`- Site : ${st.answers.q02?.trim() || 'non renseigné'}`);
  out.push(client.drive_folder_url
    ? `- Ressources (logo, captures, témoignages, cas client) : dossier Drive ${client.drive_folder_url}`
    : '- Ressources : aucun dossier fourni. Avancer sans, et lister à la fin ce qui manquerait pour renforcer la pièce.');
  if (st.assets.length) {
    out.push(`- Ressources déposées dans l'espace (${st.assets.length}) :`);
    for (const a of st.assets) out.push(`  - ${RESOURCE_LABEL[a.type] ?? a.type} : ${a.file_name ?? a.external_url ?? ''}${a.description ? ` — ${a.description}` : ''}`);
  }
  out.push(`- Onboarding envoyé le ${formatDate(client.onboarding_submitted_at ?? null, { year: true })}`);
  out.push('');

  if (weekly) { out.push(weekly); out.push(''); }
  if (step.checksConnections) { out.push(connectionsBlock(st)); out.push(''); }

  out.push("## Réponses d'onboarding (mots du client, à reprendre tels quels)");
  for (const section of ONBOARDING_SECTIONS) {
    const answered = section.questions.filter((q) => isAnswered(q, st.answers[q.key]));
    if (answered.length === 0) continue;
    out.push(`### ${section.title}`);
    for (const q of answered) {
      let v = st.answers[q.key]!.trim();
      if (q.type === 'multi') { try { v = (JSON.parse(v) as string[]).join(', '); } catch { /* valeur brute */ } }
      out.push(`**${q.label}**${q.unit ? ` (${q.unit})` : ''}`);
      out.push(v);
      out.push('');
    }
  }
  const unanswered = ALL_QUESTIONS.filter((q) => !isAnswered(q, st.answers[q.key]));
  if (unanswered.length) {
    out.push(`Questions sans réponse : ${unanswered.map((q) => q.label).join(' · ')}. Ne pas inventer : signaler ce qui manque.`);
    out.push('');
  }

  out.push("## Consignes de l'étape (extrait du master prompt)");
  out.push(stepInstructions(step));
  out.push('');
  out.push('## Règles valables pour toutes les étapes (extrait du master prompt)');
  for (const h of ALWAYS_SECTIONS) out.push(masterSection(h), '');
  out.push('');
  out.push('## Ce que tu rends');
  out.push("Le livrable complet en markdown (titres, listes, tableaux), prêt à être relu par l'agence puis lu par le client. " +
    'Aucun commentaire sur ta démarche, aucune question en suspens dans le corps du texte : ce qui manque va dans une dernière section « À compléter ».');
  if (step.key === 's1c') {
    out.push(st.mechanism
      ? `Garde le mécanisme retenu « ${st.mechanism} ».`
      : 'Propose les trois noms de mécanisme demandés et indique celui que tu recommandes : il sera retenu pour toute la suite (l\'agence pourra le changer).');
  }
  if (st.mainByStep) {
    const ref = (['s0', 's1c'] as const).map((k) => [k, st.mainByStep!.get(k)] as const).filter(([, r]) => r?.content_md);
    if (ref.length) {
      out.push('');
      out.push('## Référence : verticale principale (faits du produit uniquement, ne pas reprendre l\'avatar)');
      for (const [k, r] of ref) { out.push(`### ${DELIVERY_STEP_BY_KEY.get(k)!.label}`); out.push(r!.content_md!.trim()); out.push(''); }
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

const CONNECTION_LABEL: Record<string, string> = {
  meta: 'Compte publicitaire Meta', pixel: 'Pixel', ghl: 'Sous-compte GoHighLevel', calendrier: 'Calendrier',
  domaine: 'Domaine de la landing', mailing: "Domaine d'envoi des emails", formulaire: 'Formulaire instantané',
};
const CONNECTION_STATE: Record<string, string> = { ok: 'opérationnelle', degrade: 'dégradée', casse: 'en erreur', non_configure: 'non configurée' };

/** Étape 9 : l'état des connexions tel que l'espace le connaît (aucun jeton, aucune donnée personnelle). */
function connectionsBlock(st: State): string {
  const lines = ["## État des connexions dans l'espace", '| Connexion | Identifiant | État | Dernier contrôle | Erreur |', '|---|---|---|---|---|'];
  for (const type of Object.keys(CONNECTION_LABEL)) {
    const cn = st.connections.find((x) => x.type === type);
    lines.push(`| ${CONNECTION_LABEL[type]} | ${cn?.external_id ?? '—'} | ${cn ? CONNECTION_STATE[cn.state] ?? cn.state : 'absente de l\'espace'} | ${cn?.last_checked_at ? formatDate(cn.last_checked_at, { year: true }) : '—'} | ${cn?.error_message?.replace(/\|/g, '/') ?? '—'} |`);
  }
  lines.push("Seuls Meta et GoHighLevel sont testés par l'espace ; les autres lignes se vérifient à la main pendant la recette.");
  return lines.join('\n');
}

/** Étape 8 : la semaine écoulée contre la précédente, depuis metrics_rollup. Aucune mesure → « — », jamais 0. */
async function weeklyBlock(db: D1Database, client: ClientRow): Promise<string> {
  const p = periodBounds(7);
  const [cur, prev] = await Promise.all([clientTotals(db, client.id, p.from, p.to), clientTotals(db, client.id, p.prevFrom, p.prevTo)]);
  const lines = [`## Chiffres de la semaine (${formatDate(p.from)} → ${formatDate(p.to)}) contre la précédente (${formatDate(p.prevFrom)} → ${formatDate(p.prevTo)})`];
  if (!cur) {
    lines.push('— Aucune donnée synchronisée sur la semaine : le point ne peut pas s\'appuyer sur des chiffres.');
    return lines.join('\n');
  }
  const dc = derived(cur);
  const dp = prev ? derived(prev) : null;
  const row = (label: string, a: string, b: string) => `| ${label} | ${a} | ${b} |`;
  const dash = '— (pas de données)';
  lines.push('| Mesure | Semaine | Semaine précédente |', '|---|---|---|');
  lines.push(row('Dépense', formatEuros(cur.spend_cents), prev ? formatEuros(prev.spend_cents) : dash));
  lines.push(row('Impressions', formatInt(cur.impressions), prev ? formatInt(prev.impressions) : dash));
  lines.push(row('CTR lien', formatPercent(dc.ctr, 2), dp ? formatPercent(dp.ctr, 2) : dash));
  lines.push(row('CPM', formatEuros(dc.cpm_cents), dp ? formatEuros(dp.cpm_cents) : dash));
  lines.push(row('Leads', formatInt(cur.leads), prev ? formatInt(prev.leads) : dash));
  lines.push(row('Coût par lead', formatEuros(dc.cost_per_lead_cents), dp ? formatEuros(dp.cost_per_lead_cents) : dash));
  lines.push(row('Rendez-vous pris', formatInt(cur.appointments_booked), prev ? formatInt(prev.appointments_booked) : dash));
  lines.push(row('Coût par rendez-vous', formatEuros(dc.cost_per_booked_cents), dp ? formatEuros(dp.cost_per_booked_cents) : dash));
  lines.push(row('Rendez-vous tenus', formatInt(cur.appointments_held), prev ? formatInt(prev.appointments_held) : dash));
  lines.push(`Montants en euros. Source : chiffres synchronisés de l'espace (Meta et CRM).${client.ad_account_currency !== 'EUR' ? ` Compte publicitaire en ${client.ad_account_currency}, converti en euros.` : ''}`);
  return lines.join('\n');
}

// ─── Écritures partagées ────────────────────────────────────────────────────────

/** Ligne d'étape existante ou créée vide (INSERT OR IGNORE), pour les UPDATE qui suivent. */
const ensureRow = (db: D1Database, clientId: string, step: string) =>
  db.prepare('INSERT OR IGNORE INTO delivery_steps (id, client_id, step) VALUES (?1, ?2, ?3)').bind(newId('dls'), clientId, step);

/** Une pièce amont a changé : les pièces aval déjà rédigées passent « à revoir ». */
function markDownstreamStale(db: D1Database, clientId: string, step: DeliveryStep, sk: (k: string) => string) {
  const later = DELIVERY_STEPS.slice(DELIVERY_STEPS.indexOf(step) + 1).filter((s) => !s.recurring).map((s) => sk(s.key));
  if (later.length === 0) return null;
  return db.prepare(
    `UPDATE delivery_steps SET stale = 1 WHERE client_id = ?1 AND content_md IS NOT NULL AND step IN (${later.map((_, i) => `?${i + 2}`).join(',')})`,
  ).bind(clientId, ...later);
}

function saveContent(db: D1Database, st: State, step: DeliveryStep, content: string, source: 'claude' | 'agence', now: string) {
  const row = st.byStep.get(step.key);
  const version = (row?.content_version ?? 0) + 1;
  const stmts: D1PreparedStatement[] = [
    ensureRow(db, st.client.id, st.sk(step.key)),
    db.prepare('INSERT INTO delivery_versions (id, client_id, step, version, content_md, source, instruction) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
      .bind(newId('dlv'), st.client.id, st.sk(step.key), version, content, source, source === 'claude' ? row?.instruction ?? null : null),
  ];
  const s8 = Boolean(step.recurring);
  stmts.push(db.prepare(
    `UPDATE delivery_steps SET content_md = ?1, content_version = ?2, content_source = ?3,
       status = ?4, validated_at = CASE WHEN ?4 = 'valide' THEN validated_at ELSE NULL END,
       stale = 0, updated_at = ?5,
       generated_at = CASE WHEN ?3 = 'claude' THEN ?5 ELSE generated_at END,
       queued_at = CASE WHEN ?3 = 'claude' THEN NULL ELSE queued_at END,
       instruction = CASE WHEN ?3 = 'claude' THEN NULL ELSE instruction END,
       last_error = CASE WHEN ?3 = 'claude' THEN NULL ELSE last_error END
     WHERE client_id = ?6 AND step = ?7`,
  ).bind(content, version, source, s8 ? 'en_cours' : 'a_valider', now, st.client.id, st.sk(step.key)));
  const stale = markDownstreamStale(db, st.client.id, step, st.sk);
  if (stale && content !== row?.content_md) stmts.push(stale);
  return stmts;
}

function readContent(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, 'Contenu vide.');
  if (v.length > MAX_CONTENT) throw new HttpError(400, 'Contenu trop long.');
  return v.replace(/\r\n/g, '\n');
}

const isHttps = (v: string) => { try { return new URL(v).protocol === 'https:'; } catch { return false; } };

// ─── Agence ─────────────────────────────────────────────────────────────────────

/** Lancer la chaîne : toutes les étapes 0 à 7 sans contenu passent en file de rédaction. */
delivery.post('/:clientId/delivery/launch', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const st = await loadState(db, c.get('client').id, c.req.query('verticale') ?? '');
  if (!st.gate.ok) throw new HttpError(409, `Delivery pas encore lançable. Manque : ${st.gate.missing.join(' · ')}.`);
  const now = nowIso();
  const todo = CHAIN_STEPS.filter((k) => !hasContent(st.byStep.get(k)) && !st.byStep.get(k)?.queued_at);
  if (todo.length) {
    await db.batch(todo.flatMap((k) => [
      ensureRow(db, st.client.id, st.sk(k)),
      db.prepare(`UPDATE delivery_steps SET queued_at = ?1, status = 'en_cours', last_error = NULL, updated_at = ?1 WHERE client_id = ?2 AND step = ?3`).bind(now, st.client.id, st.sk(k)),
    ]));
  }
  await audit(db, { clientId: st.client.id, actorId: user.id, actorEmail: user.email, action: 'delivery_lance', objectType: 'client', objectId: st.client.id, after: { steps: todo, vertical: st.vid || null } });
  return c.json({ queued: todo.length });
});

/** Remettre en rédaction toutes les pièces « à revoir ». */
delivery.post('/:clientId/delivery/regenerate-stale', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const st = await loadState(db, c.get('client').id, c.req.query('verticale') ?? '');
  if (!st.gate.ok) throw new HttpError(409, 'Conditions de lancement non remplies.');
  const now = nowIso();
  const scope = st.vid ? `step LIKE ?3` : `instr(step, '${SEP}') = 0`;
  const res = await db.prepare(`UPDATE delivery_steps SET queued_at = ?1, last_error = NULL, updated_at = ?1 WHERE client_id = ?2 AND stale = 1 AND queued_at IS NULL AND ${scope}`)
    .bind(now, st.client.id, ...(st.vid ? [`%${SEP}${st.vid}`] : [])).run();
  await audit(db, { clientId: st.client.id, actorId: user.id, actorEmail: user.email, action: 'delivery_reprise_aval', objectType: 'client', objectId: st.client.id });
  return c.json({ queued: res.meta.changes ?? 0 });
});

delivery.patch('/:clientId/delivery/:step', async (c) => {
  const step = stepOr404(c.req.param('step'));
  const db = c.env.DB;
  const user = c.get('user');
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Corps de requête invalide.');
  const st = await loadState(db, c.get('client').id, vidOf(c.req.param('step')));
  if (!st.gate.ok) throw new HttpError(409, 'Conditions de lancement non remplies (onboarding et infos de base).');
  const row = st.byStep.get(step.key);
  const now = nowIso();
  const SK = st.sk(step.key);
  const stmts: D1PreparedStatement[] = [ensureRow(db, st.client.id, SK)];
  const changes: Record<string, unknown> = {};

  if ('contentMd' in body) {
    const content = readContent(body.contentMd);
    if (content !== row?.content_md) {
      stmts.push(...saveContent(db, st, step, content, 'agence', now));
      changes.contentVersion = (row?.content_version ?? 0) + 1;
    }
  }
  if ('resultUrl' in body) {
    const v = body.resultUrl;
    let url: string | null;
    if (v === null || v === '') url = null;
    else if (typeof v === 'string' && isHttps(v.trim())) url = v.trim();
    else throw new HttpError(400, 'Le lien doit être une adresse https.');
    stmts.push(db.prepare('UPDATE delivery_steps SET result_url = ?1, updated_at = ?2 WHERE client_id = ?3 AND step = ?4').bind(url, now, st.client.id, SK));
    changes.resultUrl = url;
  }
  if ('notes' in body) {
    if (body.notes !== null && typeof body.notes !== 'string') throw new HttpError(400, 'Notes invalides.');
    const notes = (body.notes as string | null)?.trim() || null;
    if (notes && notes.length > 4000) throw new HttpError(400, 'Notes trop longues (4 000 caractères au plus).');
    stmts.push(db.prepare('UPDATE delivery_steps SET notes = ?1, updated_at = ?2 WHERE client_id = ?3 AND step = ?4').bind(notes, now, st.client.id, SK));
  }
  let mechanism = st.mechanism;
  if ('mechanism' in body) {
    if (step.key !== 's1c') throw new HttpError(400, "Le mécanisme se fixe à l'étape 1C.");
    const v = body.mechanism;
    if (v !== null && (typeof v !== 'string' || v.trim().length > 120)) throw new HttpError(400, 'Nom de mécanisme invalide.');
    const next = (v as string | null)?.trim() || null;
    if (next !== mechanism) {
      stmts.push(st.vertical
        ? db.prepare('UPDATE verticals SET mechanism = ?1, updated_at = ?2 WHERE id = ?3').bind(next, now, st.vertical.id)
        : db.prepare('UPDATE clients SET delivery_mechanism = ?1, updated_at = ?2 WHERE id = ?3').bind(next, now, st.client.id));
      // Les pièces qui citent le mécanisme passent « à revoir ».
      const keys = DELIVERY_STEPS.filter((s) => s.needsMechanism && !s.recurring).map((s) => st.sk(s.key));
      stmts.push(db.prepare(`UPDATE delivery_steps SET stale = 1 WHERE client_id = ?1 AND content_md IS NOT NULL AND step IN (${keys.map((_, i) => `?${i + 2}`).join(',')})`).bind(st.client.id, ...keys));
      changes.mechanism = next;
      mechanism = next;
    }
  }
  if ('integrations' in body) {
    if (step.key !== 's3') throw new HttpError(400, 'Les intégrations concernent la landing (étape 3).');
    const v = body.integrations as Record<string, unknown> | null;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'Intégrations invalides.');
    const next = parseIntegrations(row?.integrations_json);
    for (const k of ['vsl', 'calendrier'] as const) {
      if (!(k in v)) continue;
      const code = v[k];
      if (code === null || code === '') { next[k] = null; continue; }
      if (typeof code !== 'string' || code.length > MAX_EMBED) throw new HttpError(400, `Code d'intégration ${k === 'vsl' ? 'Wistia' : 'du calendrier'} invalide (20 000 caractères au plus).`);
      if (!/<(iframe|script|div|wistia-player)\b/i.test(code)) throw new HttpError(400, `Collez le code d'intégration complet ${k === 'vsl' ? 'de Wistia' : 'du calendrier GoHighLevel'} (balises iframe, script ou div).`);
      next[k] = code.trim();
    }
    stmts.push(db.prepare('UPDATE delivery_steps SET integrations_json = ?1, updated_at = ?2 WHERE client_id = ?3 AND step = ?4')
      .bind(JSON.stringify(next), now, st.client.id, SK));
    changes.integrations = { vsl: Boolean(next.vsl), calendrier: Boolean(next.calendrier) };
  }
  if (body.stale === false) {
    stmts.push(db.prepare('UPDATE delivery_steps SET stale = 0, updated_at = ?1 WHERE client_id = ?2 AND step = ?3').bind(now, st.client.id, SK));
    changes.stale = false;
  }
  if (body.regenerate === true) {
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim().slice(0, MAX_INSTRUCTION) || null : null;
    const earlierMissing = DELIVERY_STEPS.slice(0, DELIVERY_STEPS.indexOf(step)).some((s) => !s.recurring && !hasContent(st.byStep.get(s.key)) && !st.byStep.get(s.key)?.queued_at);
    if (earlierMissing) throw new HttpError(409, "Lancez d'abord le delivery : une étape précédente n'est ni rédigée ni en file.");
    stmts.push(db.prepare(`UPDATE delivery_steps SET queued_at = ?1, instruction = ?2, last_error = NULL,
        status = CASE WHEN content_md IS NULL THEN 'en_cours' ELSE status END, updated_at = ?1 WHERE client_id = ?3 AND step = ?4`)
      .bind(now, instruction, st.client.id, SK));
    changes.regenerate = { instruction };
  }

  if ('status' in body) {
    const status = body.status;
    if (status !== 'valide' && status !== 'a_valider') throw new HttpError(400, 'Statut invalide.');
    if (status === 'valide') {
      // On valide ce qui sera en base après les modifications ci-dessus.
      const content = 'contentMd' in body ? readContent(body.contentMd) : row?.content_md ?? null;
      const url = 'resultUrl' in body ? (changes.resultUrl as string | null) : row?.result_url ?? null;
      const stale = body.stale === false ? false : Boolean(row?.stale) && !('contentMd' in body && content !== row?.content_md);
      const blocker = validationBlocker(step, { hasContent: Boolean(content?.trim() || url), mechanism, stale, connections: st.connections });
      if (blocker) throw new HttpError(409, blocker);
      if (row?.queued_at && body.regenerate !== true) throw new HttpError(409, 'Claude est en train de reprendre cette pièce : attendez la nouvelle version.');
      stmts.push(db.prepare(`UPDATE delivery_steps SET status = 'valide', validated_at = ?1, updated_at = ?1 WHERE client_id = ?2 AND step = ?3`).bind(now, st.client.id, SK));
      if (step.deliverable) stmts.push(...await publishDeliverable(db, st.client.id, step, content, url, mechanism, now, st.vertical));
    } else {
      stmts.push(db.prepare(`UPDATE delivery_steps SET status = 'a_valider', validated_at = NULL, updated_at = ?1 WHERE client_id = ?2 AND step = ?3`).bind(now, st.client.id, SK));
    }
    changes.status = status;
  }

  await db.batch(stmts);
  await audit(db, {
    clientId: st.client.id, actorId: user.id, actorEmail: user.email, action: 'delivery_etape_modifiee', objectType: 'delivery_step', objectId: `${st.client.id}:${SK}`,
    before: row ? { status: row.status, contentVersion: row.content_version, mechanism: st.mechanism } : null,
    after: { step: step.key, ...changes },
  });
  const fresh = await loadState(db, st.client.id, st.vid);
  return c.json({ step: serializeStep(step, fresh), mechanism: fresh.mechanism });
});

/** Pièce client validée → livrable publié dans l'espace du client (créé, ou mis à jour avec une nouvelle version). */
async function publishDeliverable(db: D1Database, clientId: string, step: DeliveryStep, content: string | null, url: string | null, mechanism: string | null, now: string, vertical: VerticalRow | null = null) {
  const d = step.deliverable!;
  const key = vertical ? `${step.key}${SEP}${vertical.id}` : step.key;
  const existing = await first<{ id: string; content_md: string | null; external_url: string | null; version: number; visible_client: number }>(db,
    `SELECT id, content_md, external_url, version, visible_client FROM deliverables WHERE client_id = ?1 AND origin = 'genere' AND json_extract(generation_json, '$.delivery_step') = ?2`,
    clientId, key);
  const gen = JSON.stringify({ delivery_step: key, source: 'master-prompt', mechanism });
  if (!existing) {
    return [db.prepare(
      `INSERT INTO deliverables (id, client_id, type, phase, title, status, version, external_url, content_md, visible_client, published_at, origin, generation_json, vertical_id)
       VALUES (?1, ?2, ?3, ?4, ?5, 'valide', 1, ?6, ?7, 1, ?8, 'genere', ?9, ?10)`,
    ).bind(newId('dl'), clientId, d.type, d.phase, vertical ? `${vertical.name} — ${d.title}` : d.title, url, content, now, gen, vertical?.id ?? null)];
  }
  const changed = existing.content_md !== content || existing.external_url !== url;
  return [db.prepare(
    `UPDATE deliverables SET content_md = ?1, external_url = ?2, generation_json = ?3, visible_client = 1,
       status = ?4, version = ?5, published_at = ?6, updated_at = ?6 WHERE id = ?7`,
  ).bind(content, url, gen, changed && existing.visible_client ? 'mis_a_jour' : 'valide', changed ? existing.version + 1 : existing.version, now, existing.id)];
}

// ─── Génération automatique (tâche planifiée Claude Code) ───────────────────────

/**
 * Routes de la génération : authentifiées par la clé DELIVERY_ROBOT_TOKEN (secret du Worker, saisi par Romain),
 * hors Cloudflare Access (application Access « bypass » limitée à /api/robot). Elles lisent la file et les briefs,
 * et déposent du texte. Elles ne valident, ne publient et ne suppriment jamais rien.
 */
export const robot = new Hono<{ Bindings: Bindings }>();

async function sha256(s: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}
robot.use('*', async (c, next) => {
  const expected = c.env.DELIVERY_ROBOT_TOKEN;
  if (!expected || expected.length < 32) throw new HttpError(503, 'Génération automatique non configurée.');
  const got = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const [a, b] = await Promise.all([sha256(got), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) throw new HttpError(401, 'Clé invalide.');
  await next();
});

const ROBOT_ACTOR = { actorId: 'robot-delivery', actorEmail: 'generation-automatique' };

async function robotClient(c: Context<{ Bindings: Bindings }>) {
  const st = await loadState(c.env.DB, c.req.param('clientId')!, vidOf(c.req.param('step') ?? ''));
  if (c.env.ENVIRONMENT === 'production' && st.client.is_demo) throw notFound();
  if (!st.gate.ok) throw new HttpError(409, 'Conditions de lancement non remplies.');
  return st;
}

/** File : étapes demandées, dans l'ordre de la chaîne pour chaque client. */
robot.get('/delivery/queue', async (c) => {
  const demo = c.env.ENVIRONMENT === 'production' ? 'AND cl.is_demo = 0' : '';
  const rows = await all<{ client_id: string; name: string; step: string; queued_at: string; instruction: string | null; vname: string | null }>(c.env.DB,
    `SELECT ds.client_id, cl.name, ds.step, ds.queued_at, ds.instruction, v.name AS vname FROM delivery_steps ds JOIN clients cl ON cl.id = ds.client_id
     LEFT JOIN verticals v ON v.client_id = ds.client_id AND instr(ds.step, '${SEP}') > 0 AND v.id = substr(ds.step, instr(ds.step, '${SEP}') + 1)
     WHERE ds.queued_at IS NOT NULL ${demo} ORDER BY ds.client_id`);
  const order = (k: string) => DELIVERY_STEPS.findIndex((s) => s.key === splitStepKey(k).key);
  rows.sort((x, y) => x.client_id.localeCompare(y.client_id) || splitStepKey(x.step).vid.localeCompare(splitStepKey(y.step).vid) || order(x.step) - order(y.step));
  return c.json({
    items: rows.map((r) => ({
      clientId: r.client_id, clientName: r.vname ? `${r.name} — verticale « ${r.vname} »` : r.name, step: r.step,
      label: DELIVERY_STEP_BY_KEY.get(splitStepKey(r.step).key)?.label ?? r.step, vertical: r.vname,
      instruction: r.instruction, queuedAt: r.queued_at,
    })),
  });
});

robot.get('/clients/:clientId/delivery/:step/brief', async (c) => {
  const step = stepOr404(c.req.param('step'));
  const st = await robotClient(c);
  const missing = DELIVERY_STEPS.slice(0, DELIVERY_STEPS.indexOf(step)).filter((s) => !s.recurring && !hasContent(st.byStep.get(s.key)));
  if (!step.recurring && missing.length) throw new HttpError(409, `Rédigez d'abord : ${missing.map((s) => s.label).join(', ')}.`);
  const weekly = step.key === 's8' ? await weeklyBlock(c.env.DB, st.client) : null;
  return c.json({ masterPrompt: MASTER_PROMPT, brief: buildBrief(step, st, weekly) });
});

robot.put('/clients/:clientId/delivery/:step', async (c) => {
  const step = stepOr404(c.req.param('step'));
  const db = c.env.DB;
  const st = await robotClient(c);
  const body = await c.req.json().catch(() => null) as { contentMd?: unknown; mechanism?: unknown } | null;
  const content = readContent(body?.contentMd);
  const now = nowIso();
  const stmts = saveContent(db, st, step, content, 'claude', now);
  let mechanism = st.mechanism;
  if (step.key === 's1c' && !st.mechanism) {
    const m = typeof body?.mechanism === 'string' ? body.mechanism.trim() : '';
    if (!m || m.length > 120) throw new HttpError(400, 'Indiquez le nom de mécanisme recommandé (champ « mechanism », 120 caractères au plus).');
    stmts.push(st.vertical
      ? db.prepare('UPDATE verticals SET mechanism = ?1, updated_at = ?2 WHERE id = ?3').bind(m, now, st.vertical.id)
      : db.prepare('UPDATE clients SET delivery_mechanism = ?1, updated_at = ?2 WHERE id = ?3').bind(m, now, st.client.id));
    mechanism = m;
  }
  await db.batch(stmts);
  await audit(db, { clientId: st.client.id, ...ROBOT_ACTOR, action: 'delivery_piece_deposee', objectType: 'delivery_step', objectId: `${st.client.id}:${st.sk(step.key)}`,
    after: { step: step.key, version: (st.byStep.get(step.key)?.content_version ?? 0) + 1, mechanism } });
  return c.json({ ok: true, mechanism });
});

/** Échec signalé : l'étape sort de la file avec son message, l'agence relance. */
robot.post('/clients/:clientId/delivery/:step/error', async (c) => {
  const step = stepOr404(c.req.param('step'));
  const st = await robotClient(c);
  const body = await c.req.json().catch(() => null) as { message?: unknown } | null;
  const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 1000) : 'Échec sans message.';
  const now = nowIso();
  await c.env.DB.batch([
    ensureRow(c.env.DB, st.client.id, st.sk(step.key)),
    c.env.DB.prepare(`UPDATE delivery_steps SET queued_at = NULL, last_error = ?1,
        status = CASE WHEN content_md IS NULL THEN 'a_faire' ELSE status END, updated_at = ?2 WHERE client_id = ?3 AND step = ?4`)
      .bind(message, now, st.client.id, st.sk(step.key)),
  ]);
  await audit(c.env.DB, { clientId: st.client.id, ...ROBOT_ACTOR, action: 'delivery_echec', objectType: 'delivery_step', objectId: `${st.client.id}:${step.key}`, after: { message } });
  return c.json({ ok: true });
});
