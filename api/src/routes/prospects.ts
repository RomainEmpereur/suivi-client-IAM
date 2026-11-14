import { Hono, type Context } from 'hono';
import {
  DEFAULT_MARGIN, DEFAULT_R1_TEMPLATE, DEFAULT_TUNNEL_CONTEXT, PROSPECT_DOC_LABEL, PROSPECT_DOC_TYPES, PROSPECT_FIGURES, PROSPECT_FIGURE_LABEL, PROSPECT_PROMPTS,
  PROSPECT_STAGES, DEFAULT_PROPOSAL_OFFER, DEFAULT_PROPOSAL_TEMPLATE, PROPOSAL_AI_FIELDS, autofillFields, proposalHtml, renderProposal, type ProposalOffer, checkVerbatims, trameCompleteness, collectVerbatims, figureFromField, maxCostPerAppointment, qualificationChecks, refreshAnalyse,
  type Figures, type ProspectDocType, type ProspectFigure, type ProspectStage, type TemplateBlock,
} from '@obsidian/domain';
import type { AppEnv, Bindings } from '../env.ts';
import { requireAgency } from '../auth.ts';
import { all, audit, first, newId, nowIso } from '../db.ts';
import { HttpError, notFound } from '../errors.ts';
import { QUEUE_EXTENSIONS, ROBOT_ACTOR, robot } from './delivery.ts';

/**
 * Module Prospects (section 29, décision 0027) : du R1 au R2, vue agence uniquement — aucun client ni prospect ne s'y connecte.
 * - Les rédactions (analyse, plan, script du Loom, pitch R2) passent par la tâche Claude planifiée, via la même file que le delivery
 *   (clé « pr~<type> », client = identifiant du prospect) : rien n'est produit sans un clic, rien n'est envoyé au prospect.
 * - Calculs et vérification des verbatims faits par le code. Une étape ne s'ouvre que lorsque la précédente est validée.
 * - Aucune réponse du R1 n'est copiée dans l'onboarding d'un client.
 */
export const prospects = new Hono<AppEnv>();
prospects.use('/prospects', async (c, next) => { requireAgency(c); await next(); });
prospects.use('/prospects/*', async (c, next) => { requireAgency(c); await next(); });
prospects.use('/prospects-reglages', async (c, next) => { requireAgency(c); await next(); });
prospects.use('/prospects-reglages/*', async (c, next) => { requireAgency(c); await next(); });

interface ProspectRow {
  id: string; name: string; software: string | null; website: string | null; email: string | null; phone: string | null; source: string;
  stage: ProspectStage; verdict: string | null; force_continue: number; main_objection: string | null; market_research: string | null;
  case_study_id: string | null; loom_url: string | null; loom_sent_on: string | null; offer_text: string | null; offer_price: string | null;
  outcome_reason: string | null; signed_amount_cents: number | null; client_id: string | null; last_action_at: string; created_at: string; updated_at: string;
}
interface CallRow {
  id: string; prospect_id: string; type: 'r1' | 'r2'; scheduled_at: string | null; status: string; template_version: number | null;
  notes_json: string | null; transcript: string | null; transcript_origin: string | null; recording_url: string | null; updated_at: string;
}
interface DocRow {
  id: string; prospect_id: string; type: ProspectDocType; version: number; status: 'en_file' | 'brouillon' | 'valide' | 'erreur';
  content_json: string | null; instruction: string | null; model: string | null; generated_at: string | null; validated_at: string | null;
  edited_by_hand: number; last_error: string | null; created_at: string;
  gdoc_status: 'demande' | 'cree' | 'erreur' | null; gdoc_url: string | null; gdoc_error: string | null; gdoc_requested_at: string | null;
}
interface FigureRow { key: ProspectFigure; value: number | null; origin: 'trame' | 'transcription' | 'manuel' }
interface CaseStudyRow { id: string; client: string; target: string | null; vertical: string | null; figures: string | null; url: string | null; sort: number }

const STAGE_ORDER = (s: ProspectStage) => PROSPECT_STAGES.indexOf(s);
const OPEN_STAGES: ProspectStage[] = ['r1_a_prevoir', 'r1_fait', 'analyse_validee', 'plan_valide', 'loom_envoye', 'r2_planifie', 'a_relancer'];
const parseJson = <T>(s: string | null | undefined, fallback: T): T => { try { return s ? JSON.parse(s) as T : fallback; } catch { return fallback; } };
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) || null : null);

/** Client de l'espace dont le GoHighLevel porte les R1 de l'agence (réglage, décision 0028). */
async function ghlClientId(db: D1Database) {
  const r = await first<{ value: string | null }>(db, `SELECT value FROM agency_settings WHERE key = 'prospects_ghl_client_id'`);
  return r?.value || null;
}

/** Rendez-vous GoHighLevel à venir (synchro quotidienne, lecture seule), sans fiche prospect. Depuis le début du jour (Paris). */
async function upcomingAppointments(db: D1Database) {
  const clientId = await ghlClientId(db);
  if (!clientId) return { clientId: null, clientName: null, syncedAt: null, items: [] };
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 2 * 3600_000).toISOString();
  const [client, items] = await Promise.all([
    first<{ name: string; synced: string | null }>(db, `SELECT name, (SELECT MAX(finished_at) FROM sync_runs WHERE client_id = ?1 AND source = 'ghl') AS synced FROM clients WHERE id = ?1`, clientId),
    all<{ id: string; contact_name: string | null; scheduled_at: string; booked_at: string; status: string; source: string | null; stage: string | null }>(db,
      `SELECT a.id, a.contact_name, a.scheduled_at, a.booked_at, a.status,
              (SELECT l.source FROM crm_leads l WHERE l.client_id = a.client_id AND l.contact_id = a.ghl_contact_id ORDER BY l.entered_at DESC LIMIT 1) AS source,
              (SELECT l.stage_name FROM crm_leads l WHERE l.client_id = a.client_id AND l.contact_id = a.ghl_contact_id ORDER BY l.entered_at DESC LIMIT 1) AS stage
         FROM appointments a
        WHERE a.client_id = ?1 AND a.scheduled_at >= ?2 AND a.status != 'annule'
          AND NOT EXISTS (SELECT 1 FROM prospects p WHERE p.appointment_id = a.id)
        ORDER BY a.scheduled_at LIMIT 50`, clientId, since),
  ]);
  return {
    clientId, clientName: client?.name ?? null, syncedAt: client?.synced ?? null,
    items: items.map((a) => ({ id: a.id, name: a.contact_name, scheduledAt: a.scheduled_at, bookedAt: a.booked_at, status: a.status, source: a.source, stage: a.stage })),
  };
}

const sourceFromGhl = (s: string | null) => (s && /facebook|instagram|meta|\bfb\b|\big\b/i.test(s) ? 'publicite' : s && /recommand|parrain|referral/i.test(s) ? 'recommandation' : 'autre');

async function margin(db: D1Database) {
  const r = await first<{ value: string }>(db, `SELECT value FROM agency_settings WHERE key = 'prospects_marge_acceptable'`);
  const n = Number(r?.value);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : DEFAULT_MARGIN;
}

/** Contexte du tunnel de vente des SaaS (décision 0032) : réglage de l'agence, sinon le texte par défaut. */
async function tunnelContext(db: D1Database) {
  const r = await first<{ value: string | null }>(db, `SELECT value FROM agency_settings WHERE key = 'prospects_contexte_tunnel'`);
  return r?.value?.trim() || DEFAULT_TUNNEL_CONTEXT;
}

/** Proposition commerciale (décision 0034) : modèle, offre (prix saisis par Romain, insérés par le code) et dossier Drive. */
async function proposalSettings(db: D1Database) {
  const rows = await all<{ key: string; value: string | null }>(db,
    `SELECT key, value FROM agency_settings WHERE key IN ('prospects_proposition_modele','prospects_proposition_offre','prospects_drive_dossier')`);
  const get = (k: string) => rows.find((r) => r.key === k)?.value?.trim() || null;
  const offer = { ...DEFAULT_PROPOSAL_OFFER, ...parseJson<Partial<ProposalOffer>>(get('prospects_proposition_offre'), {}) };
  return { template: get('prospects_proposition_modele') ?? DEFAULT_PROPOSAL_TEMPLATE, templateIsDefault: !get('prospects_proposition_modele'), offer, folderId: get('prospects_drive_dossier') };
}
const driveFolderId = (v: string) => v.match(/folders\/([A-Za-z0-9_-]{10,})/)?.[1] ?? (/^[A-Za-z0-9_-]{10,}$/.test(v) ? v : null);
const parisDay = () => new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', year: 'numeric' });
function proposalMarkdown(st: Loaded, cfg: Awaited<ReturnType<typeof proposalSettings>>, sections: Record<string, unknown>) {
  const ai = Object.fromEntries(PROPOSAL_AI_FIELDS.map((k) => [k, typeof sections[k] === 'string' ? (sections[k] as string) : null]));
  return renderProposal(cfg.template, {
    ...ai, ENTREPRISE: st.p.software || st.p.name, PROSPECT: st.p.name, DATE: parisDay(),
    PRIX_MISE_EN_PLACE: cfg.offer.setup, PRIX_RESULTAT: cfg.offer.success, CONDITION_RESULTAT: cfg.offer.condition,
  });
}

/** Trame active (version 1 = trame par défaut, créée à la première lecture). */
async function activeTemplate(db: D1Database): Promise<{ version: number; blocks: TemplateBlock[] }> {
  const r = await first<{ version: number; blocks_json: string }>(db, `SELECT version, blocks_json FROM call_templates WHERE type = 'r1' AND active = 1 ORDER BY version DESC LIMIT 1`);
  if (r) return { version: r.version, blocks: parseJson(r.blocks_json, DEFAULT_R1_TEMPLATE) };
  await db.prepare(`INSERT OR IGNORE INTO call_templates (id, type, version, blocks_json, active) VALUES (?1, 'r1', 1, ?2, 1)`).bind(newId('tpl'), JSON.stringify(DEFAULT_R1_TEMPLATE)).run();
  return { version: 1, blocks: DEFAULT_R1_TEMPLATE };
}
async function templateVersion(db: D1Database, version: number | null) {
  if (!version) return activeTemplate(db);
  const r = await first<{ version: number; blocks_json: string }>(db, `SELECT version, blocks_json FROM call_templates WHERE type = 'r1' AND version = ?1`, version);
  return r ? { version: r.version, blocks: parseJson(r.blocks_json, DEFAULT_R1_TEMPLATE) } : activeTemplate(db);
}

async function load(db: D1Database, id: string) {
  const p = await first<ProspectRow>(db, 'SELECT * FROM prospects WHERE id = ?1', id);
  if (!p) throw notFound();
  const [figs, calls, docs] = await Promise.all([
    all<FigureRow>(db, 'SELECT key, value, origin FROM prospect_figures WHERE prospect_id = ?1', id),
    all<CallRow>(db, 'SELECT * FROM prospect_calls WHERE prospect_id = ?1', id),
    all<DocRow>(db, 'SELECT * FROM prospect_documents WHERE prospect_id = ?1 ORDER BY version DESC', id),
  ]);
  const figures: Figures = Object.fromEntries(figs.map((f) => [f.key, f.value]));
  const r1 = calls.find((x) => x.type === 'r1') ?? null;
  const r2 = calls.find((x) => x.type === 'r2') ?? null;
  const latest = (t: ProspectDocType) => docs.find((d) => d.type === t) ?? null;
  const validated = (t: ProspectDocType) => docs.find((d) => d.type === t && d.status === 'valide') ?? null;
  return { p, figs, figures, r1, r2, docs, latest, validated, margin: await margin(db) };
}
type Loaded = Awaited<ReturnType<typeof load>>;

/** Vente en démo, telle que notée dans la trame du R1. */
const sellsInDemo = (st: Loaded) => {
  const raw = parseJson<Record<string, unknown>>(st.r1?.notes_json, {}).vente_demo;
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : null;
  return v === 'oui' ? true : v === 'non' ? false : null;
};

/** Verbatims d'un document vérifiés contre la transcription du R1 et les notes de la trame. */
function verbatimCheck(st: Loaded, content: unknown) {
  // Les champs déduits de la transcription par Claude ne servent jamais de source : une citation inventée ne se « confirme » pas elle-même.
  const notes = parseJson<Record<string, unknown>>(st.r1?.notes_json, {});
  const deduced = (notes._origines && typeof notes._origines === 'object' ? notes._origines : {}) as Record<string, string>;
  const typed = Object.entries(notes).filter(([k, v]) => typeof v === 'string' && deduced[k] !== 'transcription').map(([, v]) => v as string);
  const sources = [st.r1?.transcript ?? '', typed.join('\n')];
  return checkVerbatims(collectVerbatims(content), sources);
}

/** Écarts entre les chiffres saisis (trame, à la main) et ceux de l'analyse (transcription). */
function figureGaps(st: Loaded, analyse: DocRow | null) {
  const chiffres = parseJson<Record<string, unknown>>(analyse?.content_json, {}).chiffres as Record<string, unknown> | undefined;
  if (!chiffres) return [];
  return st.figs.filter((f) => f.origin !== 'transcription' && typeof chiffres[f.key] === 'number' && f.value !== null && Math.abs((chiffres[f.key] as number) - f.value) > 1e-9)
    .map((f) => ({ key: f.key, saisi: f.value, transcription: chiffres[f.key] as number, origin: f.origin }));
}

/** Ce qui bloque la génération d'un document (null = possible). */
async function completeness(db: D1Database, st: Loaded) {
  const tpl = await templateVersion(db, st.r1?.template_version ?? null);
  const figures = Object.fromEntries(PROSPECT_FIGURES.map((k) => [k, { value: st.figures[k] ?? null, origin: st.figs.find((f) => f.key === k)?.origin ?? null }]));
  return trameCompleteness(tpl.blocks, parseJson<Record<string, unknown>>(st.r1?.notes_json, {}), figures);
}

function generationBlocker(st: Loaded, type: ProspectDocType): string | null {
  const disq = st.p.verdict === 'disqualifie' && !st.p.force_continue;
  if (type === 'analyse') return st.r1?.transcript?.trim() || st.r1?.notes_json ? null : 'Collez la transcription du R1 (ou remplissez la trame) avant de lancer l\'analyse.';
  if (!st.validated('analyse')) return "Validez d'abord l'analyse post-R1.";
  if (disq) return 'Prospect disqualifié : seule la sortie courtoise est proposée (vous pouvez forcer la suite).';
  if (type === 'recherche') return null;
  // Le plan s'appuie sur la recherche marché (décision 0032) : générée et validée, ou collée par Romain.
  if (type === 'plan') return st.validated('recherche') || st.p.market_research?.trim() ? null : "Générez et validez d'abord la recherche marché (ou collez la vôtre).";
  if (!st.validated('plan')) return "Validez d'abord le mini plan d'action.";
  return null;
}

function serializeDoc(st: Loaded, d: DocRow | null) {
  if (!d) return null;
  const content = parseJson<unknown>(d.content_json, null);
  const checks = d.type === 'analyse' && content ? verbatimCheck(st, content) : d.type === 'pitch_r2' && content ? verbatimCheck(st, content) : [];
  return {
    id: d.id, type: d.type, version: d.version, status: d.status, content, instruction: d.instruction, generatedAt: d.generated_at, validatedAt: d.validated_at,
    editedByHand: Boolean(d.edited_by_hand), lastError: d.last_error, createdAt: d.created_at,
    verbatims: checks, verbatimsMissing: checks.filter((x) => !x.found).length,
    gdoc: d.type === 'proposition' ? { status: d.gdoc_status, url: d.gdoc_url, error: d.gdoc_error, requestedAt: d.gdoc_requested_at } : null,
  };
}

function flags(p: ProspectRow, r1: CallRow | null, r2: CallRow | null, hasValidated: (t: ProspectDocType) => boolean, now = Date.now()) {
  const out: string[] = [];
  if (r1?.status === 'tenu' && !hasValidated('analyse')) {
    const t = Date.parse(r1.scheduled_at ?? r1.updated_at);
    if (Number.isFinite(t) && now - t > 24 * 3600_000) out.push('R1 tenu sans analyse depuis plus de 24 h');
  }
  if (r2?.scheduled_at && r2.status === 'prevu' && !hasValidated('pitch_r2')) {
    const t = Date.parse(r2.scheduled_at);
    if (Number.isFinite(t) && t - now < 48 * 3600_000 && t > now - 3600_000) out.push('R2 dans moins de 48 h sans pitch validé');
  }
  return out;
}

async function serializeFull(db: D1Database, st: Loaded) {
  const tpl = await templateVersion(db, st.r1?.template_version ?? null);
  const cost = maxCostPerAppointment(st.figures, st.margin);
  const caseStudies = await all<CaseStudyRow>(db, 'SELECT * FROM case_studies ORDER BY sort, client');
  const client = st.p.client_id ? await first<{ id: string; name: string }>(db, 'SELECT id, name FROM clients WHERE id = ?1', st.p.client_id) : null;
  const docs = Object.fromEntries(PROSPECT_DOC_TYPES.map((t) => [t, {
    latest: serializeDoc(st, st.latest(t)), validated: serializeDoc(st, st.validated(t)), blocker: generationBlocker(st, t),
    history: st.docs.filter((d) => d.type === t).map((d) => ({ version: d.version, status: d.status, generatedAt: d.generated_at, validatedAt: d.validated_at })),
  }]));
  return {
    prospect: serializeProspect(st.p), client,
    figures: Object.fromEntries(PROSPECT_FIGURES.map((k) => [k, { value: st.figures[k] ?? null, origin: st.figs.find((f) => f.key === k)?.origin ?? null }])),
    cost, margin: st.margin, qualification: qualificationChecks(st.figures, sellsInDemo(st), st.margin),
    gaps: figureGaps(st, st.validated('analyse') ?? st.latest('analyse')),
    r1: st.r1 ? serializeCall(st.r1) : null, r2: st.r2 ? serializeCall(st.r2) : null,
    template: tpl, docs, caseStudies: caseStudies.map(serializeCase), completeness: await completeness(db, st),
    flags: flags(st.p, st.r1, st.r2, (t) => Boolean(st.validated(t))),
  };
}

const serializeProspect = (p: ProspectRow) => ({
  id: p.id, name: p.name, software: p.software, website: p.website, email: p.email, phone: p.phone, source: p.source, stage: p.stage,
  verdict: p.verdict, forceContinue: Boolean(p.force_continue), mainObjection: p.main_objection, marketResearch: p.market_research,
  caseStudyId: p.case_study_id, loomUrl: p.loom_url, loomSentOn: p.loom_sent_on, offerText: p.offer_text, offerPrice: p.offer_price,
  outcomeReason: p.outcome_reason, signedAmountCents: p.signed_amount_cents, clientId: p.client_id, lastActionAt: p.last_action_at, createdAt: p.created_at,
});
const serializeCall = (c: CallRow) => ({
  type: c.type, scheduledAt: c.scheduled_at, status: c.status, templateVersion: c.template_version, notes: parseJson<Record<string, unknown>>(c.notes_json, {}),
  transcript: c.transcript, transcriptOrigin: c.transcript_origin, recordingUrl: c.recording_url, updatedAt: c.updated_at,
});
const serializeCase = (c: CaseStudyRow) => ({ id: c.id, client: c.client, target: c.target, vertical: c.vertical, figures: c.figures, url: c.url, sort: c.sort });

const touch = (db: D1Database, id: string, now: string, stage?: ProspectStage) =>
  db.prepare(`UPDATE prospects SET last_action_at = ?1, updated_at = ?1${stage ? ', stage = ?3' : ''} WHERE id = ?2`).bind(now, id, ...(stage ? [stage] : []));
/** Avance l'étape, jamais en arrière (sauf issue finale). */
const advance = (current: ProspectStage, next: ProspectStage) => (STAGE_ORDER(next) > STAGE_ORDER(current) && !['signe', 'perdu'].includes(current) ? next : undefined);

// ─── Liste et indicateurs ─────────────────────────────────────────────────────

prospects.get('/prospects', async (c) => {
  const db = c.env.DB;
  const [rows, calls, docs] = await Promise.all([
    c.req.query('clientId')
      ? all<ProspectRow>(db, 'SELECT * FROM prospects WHERE client_id = ?1 ORDER BY last_action_at DESC', c.req.query('clientId'))
      : all<ProspectRow>(db, 'SELECT * FROM prospects ORDER BY last_action_at DESC'),
    all<CallRow>(db, 'SELECT id, prospect_id, type, scheduled_at, status, updated_at FROM prospect_calls'),
    all<{ prospect_id: string; type: ProspectDocType }>(db, `SELECT DISTINCT prospect_id, type FROM prospect_documents WHERE status = 'valide'`),
  ]);
  const now = Date.now();
  const items = rows.map((p) => {
    const r1 = calls.find((x) => x.prospect_id === p.id && x.type === 'r1') ?? null;
    const r2 = calls.find((x) => x.prospect_id === p.id && x.type === 'r2') ?? null;
    const has = (t: ProspectDocType) => docs.some((d) => d.prospect_id === p.id && d.type === t);
    return {
      ...serializeProspect(p), r1At: r1?.scheduled_at ?? null, r1Status: r1?.status ?? null, r2At: r2?.scheduled_at ?? null, r2Status: r2?.status ?? null,
      daysIdle: Math.floor((now - Date.parse(p.last_action_at)) / 86_400_000), flags: flags(p, r1, r2, has, now),
    };
  });
  // Tri par prochaine action : alertes d'abord, puis prospects ouverts par date du prochain rendez-vous, puis les clos.
  const nextDate = (i: (typeof items)[number]) => (i.r2At && i.r2Status === 'prevu' ? i.r2At : i.r1Status === 'prevu' ? i.r1At : null) ?? '9999';
  items.sort((a, b) => (b.flags.length ? 1 : 0) - (a.flags.length ? 1 : 0)
    || Number(OPEN_STAGES.includes(b.stage)) - Number(OPEN_STAGES.includes(a.stage))
    || nextDate(a).localeCompare(nextDate(b)) || b.daysIdle - a.daysIdle);
  // Trois chiffres d'agence.
  const since = new Date(now - 30 * 86_400_000).toISOString();
  const r1Held = calls.filter((x) => x.type === 'r1' && x.status === 'tenu');
  const r1Held30 = r1Held.filter((x) => (x.scheduled_at ?? x.updated_at) >= since).length;
  const withR2 = r1Held.filter((x) => calls.some((y) => y.prospect_id === x.prospect_id && y.type === 'r2')).length;
  const r2Held = calls.filter((x) => x.type === 'r2' && x.status === 'tenu');
  const signedAfterR2 = r2Held.filter((x) => rows.find((p) => p.id === x.prospect_id)?.stage === 'signe').length;
  return c.json({
    items,
    upcoming: c.req.query('clientId') ? null : await upcomingAppointments(db),
    kpis: {
      r1Held30,
      r1ToR2: r1Held.length ? withR2 / r1Held.length : null, r1HeldTotal: r1Held.length, r2Total: withR2,
      signAfterR2: r2Held.length ? signedAfterR2 / r2Held.length : null, r2HeldTotal: r2Held.length, signedTotal: signedAfterR2,
    },
  });
});

prospects.post('/prospects', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const b = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  // Depuis un rendez-vous GoHighLevel synchronisé : nom, date du R1 et source repris du rendez-vous (aucune écriture dans GHL).
  let appt: { id: string; contact_name: string | null; scheduled_at: string; source: string | null } | null = null;
  if (b?.appointmentId) {
    const ghlClient = await ghlClientId(db);
    appt = ghlClient ? await first(db, `SELECT a.id, a.contact_name, a.scheduled_at,
        (SELECT l.source FROM crm_leads l WHERE l.client_id = a.client_id AND l.contact_id = a.ghl_contact_id ORDER BY l.entered_at DESC LIMIT 1) AS source
      FROM appointments a WHERE a.id = ?1 AND a.client_id = ?2`, String(b.appointmentId), ghlClient) : null;
    if (!appt) throw new HttpError(404, 'Rendez-vous introuvable.');
    if (await first(db, 'SELECT id FROM prospects WHERE appointment_id = ?1', appt.id)) throw new HttpError(409, 'Une fiche existe déjà pour ce rendez-vous.');
  }
  const name = str(b?.name, 160) ?? (appt?.contact_name ? appt.contact_name.slice(0, 160) : null);
  if (!name) throw new HttpError(400, 'Nom du prospect requis.');
  const source = ['publicite', 'recommandation', 'autre'].includes(String(b?.source)) ? String(b!.source) : appt ? sourceFromGhl(appt.source) : 'publicite';
  const r1At = str(b?.r1At, 40) ?? appt?.scheduled_at ?? null;
  if (r1At && Number.isNaN(Date.parse(r1At))) throw new HttpError(400, 'Date du R1 invalide.');
  const tpl = await activeTemplate(db);
  const id = newId('pr');
  await db.batch([
    db.prepare(`INSERT INTO prospects (id, name, software, website, email, phone, source, appointment_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
      .bind(id, name, str(b?.software, 160), str(b?.website, 300), str(b?.email, 200), str(b?.phone, 40), source, appt?.id ?? null),
    db.prepare(`INSERT INTO prospect_calls (id, prospect_id, type, scheduled_at, template_version) VALUES (?1, ?2, 'r1', ?3, ?4)`).bind(newId('pc'), id, r1At, tpl.version),
  ]);
  await audit(db, { clientId: null, actorId: user.id, actorEmail: user.email, action: 'prospect_creation', objectType: 'prospect', objectId: id });
  return c.json({ ok: true, id }, 201);
});

prospects.get('/prospects/:id', async (c) => {
  const st = await load(c.env.DB, c.req.param('id'));
  return c.json(await serializeFull(c.env.DB, st));
});

prospects.patch('/prospects/:id', async (c) => {
  const db = c.env.DB;
  const st = await load(db, c.req.param('id'));
  const b = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') throw new HttpError(400, 'Corps de requête invalide.');
  const cols: Record<string, unknown> = {};
  const text: [string, string, number][] = [['name', 'name', 160], ['software', 'software', 160], ['website', 'website', 300], ['email', 'email', 200],
    ['phone', 'phone', 40], ['marketResearch', 'market_research', 30_000], ['loomUrl', 'loom_url', 500], ['loomSentOn', 'loom_sent_on', 40],
    ['offerText', 'offer_text', 4000], ['offerPrice', 'offer_price', 200]];
  for (const [k, col, max] of text) if (k in b) cols[col] = str(b[k], max);
  if ('name' in b && !cols.name) throw new HttpError(400, 'Nom du prospect requis.');
  if ('source' in b) { if (!['publicite', 'recommandation', 'autre'].includes(String(b.source))) throw new HttpError(400, 'Source invalide.'); cols.source = b.source; }
  if ('caseStudyId' in b) cols.case_study_id = str(b.caseStudyId, 64);
  if ('forceContinue' in b) cols.force_continue = b.forceContinue ? 1 : 0;
  if ('clientId' in b) {
    const cid = str(b.clientId, 64);
    if (cid && !(await first(db, 'SELECT id FROM clients WHERE id = ?1', cid))) throw new HttpError(400, 'Client introuvable.');
    cols.client_id = cid;
  }
  const keys = Object.keys(cols);
  if (!keys.length) throw new HttpError(400, 'Rien à modifier.');
  const now = nowIso();
  let stage: ProspectStage | undefined;
  const loomUrl = 'loom_url' in cols ? cols.loom_url : st.p.loom_url;
  const loomSent = 'loom_sent_on' in cols ? cols.loom_sent_on : st.p.loom_sent_on;
  if (loomUrl && loomSent) stage = advance(st.p.stage, 'loom_envoye');
  await db.batch([
    db.prepare(`UPDATE prospects SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(', ')} WHERE id = ?${keys.length + 1}`).bind(...keys.map((k) => cols[k]), st.p.id),
    touch(db, st.p.id, now, stage),
  ]);
  return c.json({ ok: true });
});

prospects.delete('/prospects/:id', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const st = await load(db, c.req.param('id'));
  // Transcriptions et documents partent avec la fiche (ON DELETE CASCADE), section 16.
  await db.prepare('DELETE FROM prospects WHERE id = ?1').bind(st.p.id).run();
  await audit(db, { clientId: null, actorId: user.id, actorEmail: user.email, action: 'prospect_suppression', objectType: 'prospect', objectId: st.p.id });
  return c.json({ ok: true });
});

/** Chiffres corrigés à la main. */
prospects.put('/prospects/:id/figures', async (c) => {
  const db = c.env.DB;
  const st = await load(db, c.req.param('id'));
  const b = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') throw new HttpError(400, 'Corps de requête invalide.');
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  for (const [k, v] of Object.entries(b)) {
    if (!(PROSPECT_FIGURES as readonly string[]).includes(k)) throw new HttpError(400, `Chiffre inconnu : ${k}.`);
    if (v === null || v === '') { stmts.push(db.prepare('DELETE FROM prospect_figures WHERE prospect_id = ?1 AND key = ?2').bind(st.p.id, k)); continue; }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${PROSPECT_FIGURE_LABEL[k as ProspectFigure].label} : nombre invalide.`);
    if (k === 'taux_closing' && n > 1) throw new HttpError(400, 'Taux de closing : ratio entre 0 et 1 (0,3 pour 30 %).');
    stmts.push(db.prepare(`INSERT INTO prospect_figures (prospect_id, key, value, origin, updated_at) VALUES (?1, ?2, ?3, 'manuel', ?4)
      ON CONFLICT (prospect_id, key) DO UPDATE SET value = excluded.value, origin = 'manuel', updated_at = excluded.updated_at`).bind(st.p.id, k, n, now));
  }
  stmts.push(touch(db, st.p.id, now));
  await db.batch(stmts);
  return c.json({ ok: true });
});

/** R1 ou R2 : date, statut, notes de la trame (enregistrées à chaque frappe), transcription. */
prospects.patch('/prospects/:id/calls/:type', async (c) => {
  const db = c.env.DB;
  const type = c.req.param('type');
  if (type !== 'r1' && type !== 'r2') throw notFound();
  const st = await load(db, c.req.param('id'));
  const b = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') throw new HttpError(400, 'Corps de requête invalide.');
  const now = nowIso();
  const call = type === 'r1' ? st.r1 : st.r2;
  const stmts: D1PreparedStatement[] = [];
  const callId = call?.id ?? newId('pc');
  const tpl = type === 'r1' ? await templateVersion(db, call?.template_version ?? null) : null;
  if (!call) stmts.push(db.prepare(`INSERT INTO prospect_calls (id, prospect_id, type, template_version) VALUES (?1, ?2, ?3, ?4)`).bind(callId, st.p.id, type, tpl?.version ?? null));
  const set: Record<string, unknown> = {};
  if ('scheduledAt' in b) {
    const v = str(b.scheduledAt, 40);
    if (v && Number.isNaN(Date.parse(v))) throw new HttpError(400, 'Date invalide.');
    set.scheduled_at = v;
  }
  if ('status' in b) {
    if (!['prevu', 'tenu', 'absent', 'annule'].includes(String(b.status))) throw new HttpError(400, 'Statut invalide.');
    set.status = b.status;
  }
  if ('transcript' in b) {
    const t = typeof b.transcript === 'string' ? b.transcript : '';
    if (t.length > 400_000) throw new HttpError(400, 'Transcription trop longue (400 000 caractères au plus).');
    set.transcript = t.trim() || null;
    set.transcript_origin = t.trim() ? 'collee' : null;
  }
  if ('recordingUrl' in b) set.recording_url = str(b.recordingUrl, 500);
  let notes: Record<string, unknown> | null = null;
  if ('notes' in b) {
    if (!b.notes || typeof b.notes !== 'object' || Array.isArray(b.notes)) throw new HttpError(400, 'Notes invalides.');
    const prev = parseJson<Record<string, unknown>>(call?.notes_json, {});
    const incoming = Object.fromEntries(Object.entries(b.notes as Record<string, unknown>).filter(([k]) => k !== '_origines' && k !== '_verbatims'));
    notes = { ...prev, ...incoming };
    // Un champ retouché par Romain n'est plus « déduit de la transcription ».
    for (const meta of ['_origines', '_verbatims'] as const) {
      if (prev[meta] && typeof prev[meta] === 'object') {
        const m = { ...(prev[meta] as Record<string, unknown>) };
        for (const k of Object.keys(incoming)) delete m[k];
        notes[meta] = m;
      }
    }
    const json = JSON.stringify(notes);
    if (json.length > 60_000) throw new HttpError(400, 'Notes trop longues.');
    set.notes_json = json;
  }
  const keys = Object.keys(set);
  if (keys.length) stmts.push(db.prepare(`UPDATE prospect_calls SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(', ')}, updated_at = ?${keys.length + 1} WHERE id = ?${keys.length + 2}`)
    .bind(...keys.map((k) => set[k]), now, callId));

  // Les réponses chiffrées de la trame alimentent les chiffres du prospect (origine « trame »), sauf correction à la main.
  if (notes && tpl) {
    for (const f of tpl.blocks.flatMap((bl) => bl.fields)) {
      if (!f.figure || !(f.key in (b.notes as Record<string, unknown>))) continue;
      const v = figureFromField(f, notes[f.key]);
      const cur = st.figs.find((x) => x.key === f.figure);
      if (cur?.origin === 'manuel') continue;
      stmts.push(v === null
        ? db.prepare(`DELETE FROM prospect_figures WHERE prospect_id = ?1 AND key = ?2 AND origin = 'trame'`).bind(st.p.id, f.figure)
        : db.prepare(`INSERT INTO prospect_figures (prospect_id, key, value, origin, updated_at) VALUES (?1, ?2, ?3, 'trame', ?4)
            ON CONFLICT (prospect_id, key) DO UPDATE SET value = excluded.value, origin = 'trame', updated_at = excluded.updated_at`).bind(st.p.id, f.figure, v, now));
    }
    // La date du R2 notée en fin de R1 planifie le R2.
    const r2At = str((b.notes as Record<string, unknown>).date_r2, 40);
    if (type === 'r1' && r2At && !Number.isNaN(Date.parse(r2At))) {
      if (st.r2) stmts.push(db.prepare('UPDATE prospect_calls SET scheduled_at = ?1, updated_at = ?2 WHERE id = ?3').bind(r2At, now, st.r2.id));
      else stmts.push(db.prepare(`INSERT INTO prospect_calls (id, prospect_id, type, scheduled_at) VALUES (?1, ?2, 'r2', ?3)`).bind(newId('pc'), st.p.id, r2At));
    }
  }
  let stage: ProspectStage | undefined;
  if (type === 'r1' && set.status === 'tenu') stage = advance(st.p.stage, 'r1_fait');
  if (type === 'r2' && set.scheduled_at) stage = advance(st.p.stage, 'r2_planifie');
  stmts.push(touch(db, st.p.id, now, stage));
  await db.batch(stmts);
  return c.json({ ok: true });
});

// ─── Documents ────────────────────────────────────────────────────────────────

const docType = (v: string): ProspectDocType => { if (!(PROSPECT_DOC_TYPES as readonly string[]).includes(v)) throw notFound(); return v as ProspectDocType; };

/** Demande de rédaction : une nouvelle version part en file ; la version validée précédente n'est jamais écrasée. */
prospects.post('/prospects/:id/documents/:type/generate', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const type = docType(c.req.param('type'));
  const st = await load(db, c.req.param('id'));
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const blocker = generationBlocker(st, type);
  if (blocker) throw new HttpError(409, blocker);
  const latest = st.latest(type);
  if (latest?.status === 'en_file') throw new HttpError(409, 'Déjà en rédaction : Claude la rédige au prochain passage.');
  if (latest?.edited_by_hand && latest.status === 'brouillon' && b.confirm !== true) {
    throw new HttpError(409, 'La dernière version a été modifiée à la main : confirmez pour la faire réécrire.');
  }
  const now = nowIso();
  await db.batch([
    db.prepare(`INSERT INTO prospect_documents (id, prospect_id, type, version, status, instruction) VALUES (?1, ?2, ?3, ?4, 'en_file', ?5)`)
      .bind(newId('pd'), st.p.id, type, (latest?.version ?? 0) + 1, str(b.instruction, 2000)),
    touch(db, st.p.id, now),
  ]);
  await audit(db, { clientId: null, actorId: user.id, actorEmail: user.email, action: 'prospect_generation_demandee', objectType: 'prospect', objectId: `${st.p.id}:${type}` });
  return c.json({ ok: true });
});

/** Retirer de la file une rédaction pas encore commencée (décision 0032). La version validée n'est pas touchée. */
prospects.post('/prospects/:id/documents/:type/cancel', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const type = docType(c.req.param('type'));
  const st = await load(db, c.req.param('id'));
  const doc = st.latest(type);
  if (!doc || doc.status !== 'en_file') throw new HttpError(409, 'Aucune rédaction en file pour ce document.');
  await db.prepare(`DELETE FROM prospect_documents WHERE id = ?1 AND status = 'en_file'`).bind(doc.id).run();
  await audit(db, { clientId: null, actorId: user.id, actorEmail: user.email, action: 'prospect_generation_annulee', objectType: 'prospect', objectId: `${st.p.id}:${type}` });
  return c.json({ ok: true });
});

/**
 * « Mettre à jour » l'analyse (décision 0031) : reprend la trame et les chiffres saisis depuis, sans passer par Claude.
 * Un brouillon est mis à jour sur place ; une version validée donne une nouvelle version en brouillon, à valider.
 */
prospects.post('/prospects/:id/documents/analyse/refresh', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const st = await load(db, c.req.param('id'));
  const doc = st.latest('analyse');
  if (!doc || doc.status === 'en_file' || doc.status === 'erreur' || !doc.content_json) throw new HttpError(409, "Aucune analyse rédigée à mettre à jour.");
  const tpl = await templateVersion(db, st.r1?.template_version ?? null);
  const { content, changed } = refreshAnalyse(parseJson<Record<string, unknown>>(doc.content_json, {}), {
    figures: st.figures, notes: parseJson<Record<string, unknown>>(st.r1?.notes_json, {}), blocks: tpl.blocks, margin: st.margin, sellsInDemo: sellsInDemo(st),
  });
  if (!changed.length) return c.json({ ok: true, changed, version: doc.version });
  const now = nowIso();
  const json = JSON.stringify(content);
  let version = doc.version;
  if (doc.status === 'valide') {
    version = doc.version + 1;
    await db.prepare(`INSERT INTO prospect_documents (id, prospect_id, type, version, status, content_json, model, generated_at, edited_by_hand)
      VALUES (?1, ?2, 'analyse', ?3, 'brouillon', ?4, 'mise à jour depuis la fiche', ?5, ?6)`).bind(newId('pd'), st.p.id, version, json, now, doc.edited_by_hand).run();
  } else {
    await db.prepare(`UPDATE prospect_documents SET content_json = ?1, updated_at = ?2 WHERE id = ?3`).bind(json, now, doc.id).run();
  }
  await touch(db, st.p.id, now).run();
  await audit(db, { clientId: null, actorId: user.id, actorEmail: user.email, action: 'prospect_analyse_mise_a_jour', objectType: 'prospect', objectId: `${st.p.id}:analyse`, after: { version, changed } });
  return c.json({ ok: true, changed, version });
});

/** Modifier le contenu de la dernière version (brouillon), ou la valider. */
prospects.patch('/prospects/:id/documents/:type', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const type = docType(c.req.param('type'));
  const st = await load(db, c.req.param('id'));
  const doc = st.latest(type);
  if (!doc || doc.status === 'en_file') throw new HttpError(409, 'Aucune version à modifier.');
  const b = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') throw new HttpError(400, 'Corps de requête invalide.');
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  let content = parseJson<unknown>(doc.content_json, null);
  if ('content' in b) {
    if (doc.status === 'valide') throw new HttpError(409, 'Version validée : relancez une rédaction pour la changer.');
    if (!b.content || typeof b.content !== 'object') throw new HttpError(400, 'Contenu invalide.');
    const json = JSON.stringify(b.content);
    if (json.length > 200_000) throw new HttpError(400, 'Contenu trop long.');
    content = b.content;
    stmts.push(db.prepare(`UPDATE prospect_documents SET content_json = ?1, edited_by_hand = 1, updated_at = ?2 WHERE id = ?3`).bind(json, now, doc.id));
  }
  let stage: ProspectStage | undefined;
  if (b.status === 'valide') {
    if (doc.status !== 'brouillon') throw new HttpError(409, 'Seul un brouillon se valide.');
    if (!content) throw new HttpError(409, 'Document vide.');
    if (type === 'proposition' && String((content as { markdown?: unknown }).markdown ?? '').includes('[à compléter]')) {
      throw new HttpError(409, 'La proposition contient encore « [à compléter] » : complétez-la (Modifier) avant de la valider.');
    }
    if (type === 'analyse' || type === 'pitch_r2') {
      const missing = verbatimCheck(st, content).filter((x) => !x.found);
      if (missing.length) throw new HttpError(409, `${missing.length} citation(s) introuvable(s) dans la transcription : corrigez-les ou retirez-les avant de valider.`);
    }
    // Vérification de la fiche : un élément manquant passe en « à confirmer en R2 », mais seulement si Romain le confirme.
    if (type === 'analyse' && b.confirmMissing !== true) {
      const gaps = (await completeness(db, st)).filter((x) => x.status === 'manquant' && x.key !== 'date_r2' && x.key !== 'issue_r1');
      if (gaps.length) throw new HttpError(409, `Fiche incomplète : ${gaps.map((x) => x.label).join(', ')}. Complétez la trame ou confirmez qu'ils passent en « à confirmer en R2 ».`);
    }
    stmts.push(db.prepare(`UPDATE prospect_documents SET status = 'valide', validated_at = ?1, updated_at = ?1 WHERE id = ?2`).bind(now, doc.id));
    if (type === 'analyse') {
      const a = content as { verdict?: { valeur?: string }; objections?: { objection?: string }[] };
      const verdict = ['qualifie', 'a_creuser', 'disqualifie'].includes(String(a.verdict?.valeur)) ? String(a.verdict!.valeur) : null;
      stmts.push(db.prepare('UPDATE prospects SET verdict = ?1, main_objection = ?2 WHERE id = ?3').bind(verdict, a.objections?.[0]?.objection?.slice(0, 500) ?? null, st.p.id));
      stage = advance(st.p.stage, 'analyse_validee');
    }
    if (type === 'plan') {
      const cs = (content as { casClient?: { id?: string } }).casClient?.id;
      if (cs && !st.p.case_study_id && await first(db, 'SELECT id FROM case_studies WHERE id = ?1', cs)) stmts.push(db.prepare('UPDATE prospects SET case_study_id = ?1 WHERE id = ?2').bind(cs, st.p.id));
      stage = advance(st.p.stage, 'plan_valide');
    }
  } else if ('status' in b) throw new HttpError(400, 'Statut invalide.');
  if (!stmts.length) throw new HttpError(400, 'Rien à modifier.');
  stmts.push(touch(db, st.p.id, now, stage));
  await db.batch(stmts);
  await audit(db, { clientId: null, actorId: user.id, actorEmail: user.email, action: 'prospect_document_modifie', objectType: 'prospect', objectId: `${st.p.id}:${type}`, after: { status: b.status ?? null, edited: 'content' in b } });
  return c.json({ ok: true });
});

/** Demande du Google Doc de la proposition validée : créé par la tâche planifiée au prochain passage (décision 0034). */
prospects.post('/prospects/:id/documents/proposition/gdoc', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const st = await load(db, c.req.param('id'));
  const doc = st.validated('proposition');
  if (!doc) throw new HttpError(409, "Validez d'abord la proposition commerciale.");
  if (doc.gdoc_status === 'demande') throw new HttpError(409, 'Google Doc déjà demandé : il sera créé au prochain passage.');
  if (!(await proposalSettings(db)).folderId) throw new HttpError(409, 'Renseignez le dossier Google Drive des propositions dans Prospects → Réglages.');
  const now = nowIso();
  await db.batch([
    db.prepare(`UPDATE prospect_documents SET gdoc_status = 'demande', gdoc_error = NULL, gdoc_requested_at = ?1, updated_at = ?1 WHERE id = ?2`).bind(now, doc.id),
    touch(db, st.p.id, now),
  ]);
  await audit(db, { clientId: null, actorId: user.id, actorEmail: user.email, action: 'prospect_proposition_gdoc_demande', objectType: 'prospect', objectId: st.p.id, after: { version: doc.version } });
  return c.json({ ok: true });
});

/** Issue après le R2 (ou plus tôt) : signé, perdu, à relancer. */
prospects.post('/prospects/:id/outcome', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const st = await load(db, c.req.param('id'));
  const b = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const outcome = String(b?.outcome);
  if (!['signe', 'perdu', 'a_relancer'].includes(outcome)) throw new HttpError(400, 'Issue invalide.');
  const amount = b?.amountCents == null || b.amountCents === '' ? null : Math.round(Number(b.amountCents));
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw new HttpError(400, 'Montant invalide.');
  const now = nowIso();
  await db.batch([
    db.prepare(`UPDATE prospects SET stage = ?1, outcome_reason = ?2, signed_amount_cents = ?3, last_action_at = ?4, updated_at = ?4 WHERE id = ?5`)
      .bind(outcome, str(b?.reason, 1000), outcome === 'signe' ? amount : null, now, st.p.id),
    ...(st.r2 && st.r2.status === 'prevu' && outcome !== 'a_relancer' ? [db.prepare(`UPDATE prospect_calls SET status = 'tenu', updated_at = ?1 WHERE id = ?2`).bind(now, st.r2.id)] : []),
  ]);
  await audit(db, { clientId: st.p.client_id, actorId: user.id, actorEmail: user.email, action: 'prospect_issue', objectType: 'prospect', objectId: st.p.id, after: { outcome, amount } });
  return c.json({ ok: true });
});

// ─── Réglages : trame, cas clients, marge ─────────────────────────────────────

prospects.get('/prospects-reglages', async (c) => {
  const db = c.env.DB;
  const [tpl, cases, m, versions] = await Promise.all([
    activeTemplate(db), all<CaseStudyRow>(db, 'SELECT * FROM case_studies ORDER BY sort, client'), margin(db),
    all<{ version: number; created_at: string }>(db, `SELECT version, created_at FROM call_templates WHERE type = 'r1' ORDER BY version DESC`),
  ]);
  const clients = await all<{ id: string; name: string }>(db, `SELECT id, name FROM clients ORDER BY name`);
  const tc = await first<{ value: string | null }>(db, `SELECT value FROM agency_settings WHERE key = 'prospects_contexte_tunnel'`);
  return c.json({ template: tpl, templateVersions: versions, caseStudies: cases.map(serializeCase), margin: m, ghlClientId: await ghlClientId(db), clients,
    tunnelContext: tc?.value?.trim() || DEFAULT_TUNNEL_CONTEXT, tunnelContextIsDefault: !tc?.value?.trim(), proposal: await proposalSettings(db) });
});

prospects.put('/prospects-reglages', async (c) => {
  const db = c.env.DB;
  const b = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') throw new HttpError(400, 'Corps de requête invalide.');
  const stmts: D1PreparedStatement[] = [];
  const now = nowIso();
  if ('margin' in b) {
    const n = Number(b.margin);
    if (!Number.isFinite(n) || n <= 0 || n > 1) throw new HttpError(400, 'Marge acceptable : entre 0 et 1 (0,25 pour 25 %).');
    stmts.push(db.prepare(`INSERT INTO agency_settings (key, value, updated_at) VALUES ('prospects_marge_acceptable', ?1, ?2)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(String(n), now));
  }
  if ('tunnelContext' in b) {
    const v = b.tunnelContext == null ? '' : String(b.tunnelContext).trim();
    if (v.length > 8000) throw new HttpError(400, 'Contexte du tunnel trop long (8 000 caractères au plus).');
    stmts.push(db.prepare(`INSERT INTO agency_settings (key, value, updated_at) VALUES ('prospects_contexte_tunnel', ?1, ?2)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(v || null, now));
  }
  const setKey = (key: string, value: string | null) => stmts.push(db.prepare(`INSERT INTO agency_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(key, value, now));
  if ('proposalTemplate' in b) {
    const v = b.proposalTemplate == null ? '' : String(b.proposalTemplate).trim();
    if (v.length > 20_000) throw new HttpError(400, 'Modèle de proposition trop long (20 000 caractères au plus).');
    setKey('prospects_proposition_modele', v || null);
  }
  if ('proposalOffer' in b) {
    const o = (b.proposalOffer ?? {}) as Record<string, unknown>;
    const offer = { setup: str(o.setup, 80), success: str(o.success, 80), condition: str(o.condition, 300) };
    if (!offer.setup || !offer.success || !offer.condition) throw new HttpError(400, "Offre : les deux montants et la condition sont requis.");
    setKey('prospects_proposition_offre', JSON.stringify(offer));
  }
  if ('driveFolder' in b) {
    const raw = b.driveFolder == null ? '' : String(b.driveFolder).trim();
    const id = raw ? driveFolderId(raw) : null;
    if (raw && !id) throw new HttpError(400, 'Dossier Drive : collez le lien du dossier ou son identifiant.');
    setKey('prospects_drive_dossier', id);
  }
  if ('ghlClientId' in b) {
    const v = b.ghlClientId ? String(b.ghlClientId) : null;
    if (v && !(await first(db, 'SELECT id FROM clients WHERE id = ?1', v))) throw new HttpError(400, 'Client inconnu.');
    stmts.push(db.prepare(`INSERT INTO agency_settings (key, value, updated_at) VALUES ('prospects_ghl_client_id', ?1, ?2)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(v, now));
  }
  if ('caseStudies' in b) {
    if (!Array.isArray(b.caseStudies) || b.caseStudies.length > 50) throw new HttpError(400, 'Cas clients invalides.');
    const keep: string[] = [];
    b.caseStudies.forEach((x: unknown, i: number) => {
      const o = x as Record<string, unknown>;
      const client = str(o.client, 120);
      if (!client) throw new HttpError(400, 'Chaque cas client a un nom.');
      const id = typeof o.id === 'string' && /^cs_[a-z0-9_]{1,40}$/.test(o.id) ? o.id : newId('cs');
      keep.push(id);
      stmts.push(db.prepare(`INSERT INTO case_studies (id, client, target, vertical, figures, url, sort, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT (id) DO UPDATE SET client = excluded.client, target = excluded.target, vertical = excluded.vertical, figures = excluded.figures,
          url = excluded.url, sort = excluded.sort, updated_at = excluded.updated_at`)
        .bind(id, client, str(o.target, 400), null, str(o.figures, 2000), str(o.url, 500), i, now));
    });
    stmts.push(db.prepare(`DELETE FROM case_studies WHERE id NOT IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(keep)));
  }
  if ('template' in b) {
    const blocks = b.template as TemplateBlock[];
    if (!Array.isArray(blocks) || !blocks.length || blocks.some((x) => !x || typeof x.title !== 'string' || !Array.isArray(x.questions) || !Array.isArray(x.fields))) {
      throw new HttpError(400, 'Trame invalide.');
    }
    const cur = await activeTemplate(db);
    stmts.push(
      db.prepare(`UPDATE call_templates SET active = 0 WHERE type = 'r1'`),
      db.prepare(`INSERT INTO call_templates (id, type, version, blocks_json, active) VALUES (?1, 'r1', ?2, ?3, 1)`).bind(newId('tpl'), cur.version + 1, JSON.stringify(blocks)),
    );
  }
  if (!stmts.length) throw new HttpError(400, 'Rien à modifier.');
  await db.batch(stmts);
  return c.json({ ok: true });
});

// ─── Robot : même file et mêmes URL que le delivery, client = prospect, clé « pr~<type> » ─────────

const PR_CLIENT = ':clientId{pr_[A-Za-z0-9]+}';
const PR_STEP = ':step{pr~[a-z_0-9]+}';

async function robotDoc(c: Context<{ Bindings: Bindings }>) {
  const type = docType(String(c.req.param('step')).slice(3));
  const st = await load(c.env.DB, c.req.param('clientId')!);
  const doc = st.latest(type);
  if (!doc || doc.status !== 'en_file') throw new HttpError(409, 'Aucune rédaction demandée pour ce document.');
  return { st, type, doc };
}

function formatFigure(k: ProspectFigure, v: number | null | undefined) {
  if (v === null || v === undefined) return 'à confirmer en R2';
  const u = PROSPECT_FIGURE_LABEL[k].unit;
  return u === 'pct' ? `${Math.round(v * 1000) / 10} %` : u === 'eur' ? `${v} €` : u === 'eur_jour' ? `${v} €/jour` : u === 'mois' ? `${v} mois` : String(v);
}

async function buildBrief(db: D1Database, st: Loaded, type: ProspectDocType, doc: DocRow) {
  const out: string[] = [];
  const p = st.p;
  out.push(`# Prospect ${p.name} — ${PROSPECT_DOC_LABEL[type]}`, '');
  if (doc.instruction) out.push("## Consigne de Romain (prioritaire)", doc.instruction, '');
  const prev = st.docs.find((d) => d.type === type && d.version < doc.version && d.content_json);
  if (doc.instruction && prev) out.push('## Version précédente à reprendre', '```json', prev.content_json!, '```', '');
  out.push('## Le prospect', `- Nom : ${p.name}`, `- Logiciel : ${p.software ?? 'à confirmer en R2'}`, `- Site : ${p.website ?? 'non renseigné'}`, `- Source : ${p.source}`, '');
  const cost = maxCostPerAppointment(st.figures, st.margin);
  out.push('## Chiffres du prospect (la trame et les corrections de Romain priment)', '| Chiffre | Valeur | Origine |', '|---|---|---|');
  for (const k of PROSPECT_FIGURES) out.push(`| ${PROSPECT_FIGURE_LABEL[k].label} | ${formatFigure(k, st.figures[k])} | ${st.figs.find((f) => f.key === k)?.origin ?? '—'} |`);
  out.push('', '## Coût maximum d\'un rendez-vous (calculé par le code — à reprendre tel quel)');
  out.push(cost.value === null
    ? `Non calculable : il manque ${cost.missing.map((k) => PROSPECT_FIGURE_LABEL[k].label.toLowerCase()).join(', ')} (à confirmer en R2).`
    : `${cost.value} € = ticket mensuel ${cost.ticket} € × durée de vie ${cost.life} mois × marge acceptable ${Math.round(cost.margin * 100)} % × taux de closing ${Math.round(cost.closing! * 1000) / 10} %.`);
  out.push('', '## Contrôles de qualification calculés par le code');
  for (const q of qualificationChecks(st.figures, sellsInDemo(st), st.margin)) out.push(`- ${q.label} : ${q.ok === null ? 'à confirmer' : q.ok ? 'oui' : 'non'} (${q.detail})`);
  out.push('');
  const tpl = await templateVersion(db, st.r1?.template_version ?? null);
  const notes = parseJson<Record<string, unknown>>(st.r1?.notes_json, {});
  out.push('## Notes prises dans la trame du R1');
  for (const bl of tpl.blocks) {
    const lines = bl.fields.filter((f) => notes[f.key] !== undefined && notes[f.key] !== '').map((f) => `- ${f.label} : ${String(notes[f.key])}`);
    if (lines.length) out.push(`### ${bl.title}`, ...lines);
  }
  if (typeof notes._libre === 'string' && notes._libre.trim()) out.push('### Notes libres', notes._libre.trim());
  out.push('');
  if (type === 'analyse') {
    const deduced = (notes._origines ?? {}) as Record<string, string>;
    out.push('## Champs de la trame à compléter depuis la transcription (objet `trame`)',
      'Pour chaque clé : `{"valeur": …, "verbatim": "citation exacte"}` si c\'est dit dans la transcription, sinon `{"valeur": null, "verbatim": null}`. Un champ déjà saisi par Romain n\'est jamais remplacé.');
    for (const f of autofillFields(tpl.blocks)) {
      const v = notes[f.key];
      const state = v !== undefined && v !== null && String(v).trim() !== '' && deduced[f.key] !== 'transcription' ? 'déjà saisi par Romain' : 'à compléter';
      out.push(`- \`${f.key}\` — ${f.label}${f.options ? ` (une valeur parmi : ${f.options.map((o) => `« ${o} »`).join(', ')})` : ''} : ${state}`);
    }
    out.push('');
  }
  const analyse = st.validated('analyse');
  const plan = st.validated('plan');
  if (type === 'analyse') {
    out.push('## Transcription du R1', st.r1?.transcript?.trim() || '(pas de transcription : travailler à partir des notes de la trame uniquement)', '');
  } else {
    if (analyse) out.push('## Analyse post-R1 validée', '```json', analyse.content_json ?? '{}', '```', '');
    const recherche = st.validated('recherche');
    if (type !== 'recherche' && recherche) out.push('## Recherche marché validée', '```json', recherche.content_json ?? '{}', '```', '');
    if (type !== 'recherche') out.push("## Contexte du tunnel de vente d'Obsidian Partners pour les SaaS (la méthode à appliquer au marché du prospect)", await tunnelContext(db), '');
    if ((type === 'script_loom' || type === 'pitch_r2' || type === 'proposition') && plan) out.push("## Mini plan d'action validé", '```json', plan.content_json ?? '{}', '```', '');
  }
  if (type === 'proposition') {
    const cfg = await proposalSettings(db);
    const pitch = st.validated('pitch_r2');
    if (pitch) out.push('## Pitch R2 validé', '```json', pitch.content_json ?? '{}', '```', '');
    out.push('## Modèle de la proposition (fixe : tu ne rédiges que les champs SITUATION, OBJECTIFS, DEJA_ESSAYE, PLAN, CAS_CLIENT, PROCHAINES_ETAPES)', '```markdown', cfg.template.trim(), '```', '');
    out.push(`## Offre (insérée par le code, à ne jamais réécrire ni commenter) : mise en place ${cfg.offer.setup} ; ${cfg.offer.success} ${cfg.offer.condition}.`, '');
  }
  if (type === 'plan' || type === 'pitch_r2' || type === 'proposition') {
    const cases = await all<CaseStudyRow>(db, 'SELECT * FROM case_studies ORDER BY sort, client');
    out.push('## Cas clients disponibles (uniquement ceux-ci, avec leurs chiffres officiels ; une case vide reste vide)');
    for (const cs of cases) out.push(`- id \`${cs.id}\` — ${cs.client}${cs.target ? ` · cible / verticale (les personnes visées par les publicités) : ${cs.target}` : ''} · chiffres officiels : ${cs.figures?.trim() || '(non renseignés)'}`);
    out.push('');
  }
  if (type === 'plan') out.push('## Compléments de recherche (collés par Romain)', p.market_research?.trim() || '(aucun)', '');
  if (type === 'recherche') out.push('## Ce que tu cherches', `Site du prospect : ${p.website ?? "à trouver à partir du nom du logiciel"}. Marchés et concurrents : ceux de l'analyse validée ci-dessus. Notes de Romain à prendre en compte : ${p.market_research?.trim() || 'aucune'}.`, '');
  if (type === 'pitch_r2') {
    const guides = await all<{ title: string; kind: string; url: string | null }>(db, 'SELECT title, kind, url FROM guides WHERE client_id IS NULL AND published = 1 ORDER BY sort_order');
    out.push('## Ressources à envoyer avant le R2 (bibliothèque de guides)');
    out.push(guides.length ? guides.map((g) => `- ${g.title} (${g.kind})${g.url ? ` — ${g.url}` : ''}`).join('\n') : '(aucune ressource publiée)');
    if (st.r2?.notes_json) out.push('', '## Notes du R2', st.r2.notes_json);
    out.push('', `## Objection principale relevée : ${p.main_objection ?? 'non renseignée'}`, '');
  }
  if (type === 'script_loom') out.push(`## Lien du Loom : à placer par Romain ([LIEN LOOM])`, '');
  out.push('## Ce que tu rends', 'Le dépôt se fait comme pour le delivery : un JSON {"contentMd": "…"} dont contentMd contient **uniquement** le bloc ```json``` décrit dans le prompt.');
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Lit le bloc JSON déposé par le robot. */
function parseDeposit(type: ProspectDocType, raw: unknown) {
  if (typeof raw !== 'string' || !raw.trim()) throw new HttpError(400, 'Contenu vide.');
  if (raw.length > 200_000) throw new HttpError(400, 'Contenu trop long.');
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  let obj: unknown;
  try { obj = JSON.parse((m ? m[1] : raw).trim()); } catch { throw new HttpError(400, 'JSON invalide : rendez uniquement le bloc ```json``` du schéma demandé.'); }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new HttpError(400, 'JSON invalide : un objet est attendu.');
  const required: Record<ProspectDocType, string[]> = {
    analyse: ['fiche', 'forces', 'declencheur', 'objections', 'verdict'],
    recherche: ['site', 'concurrents', 'langageCible', 'synthese'],
    plan: ['verticale', 'angles', 'actionsSansAgence'],
    script_loom: ['passages', 'messageEmail', 'messageSms'],
    pitch_r2: ['recap', 'plan', 'objections', 'questionCloture', 'pointsACreuser'],
    proposition: ['sections'],
  };
  const missing = required[type].filter((k) => !(k in (obj as object)));
  if (missing.length) throw new HttpError(400, `JSON incomplet : il manque ${missing.join(', ')}.`);
  return obj as Record<string, unknown>;
}

// ─── Google Doc de la proposition (décision 0034) : routes dédiées, déclarées avant les routes génériques ───
async function gdocDoc(c: Context<{ Bindings: Bindings }>) {
  const st = await load(c.env.DB, c.req.param('clientId')!);
  const doc = st.validated('proposition');
  if (!doc || doc.gdoc_status !== 'demande') throw new HttpError(409, 'Aucun Google Doc demandé pour ce prospect.');
  return { st, doc };
}
robot.get(`/clients/${PR_CLIENT}/delivery/pr~gdoc/brief`, async (c) => {
  const { st, doc } = await gdocDoc(c);
  const cfg = await proposalSettings(c.env.DB);
  const markdown = String(parseJson<{ markdown?: string }>(doc.content_json, {}).markdown ?? '');
  const title = `Proposition commerciale — ${st.p.software || st.p.name} — ${parisDay()}`;
  const html = proposalHtml(markdown, title);
  return c.json({
    masterPrompt: [
      '# Créer le Google Doc de la proposition commerciale',
      "Seule écriture autorisée pour cet élément : créer UN Google Doc dans le dossier indiqué. Ne modifie ni ne supprime aucun fichier existant, ne partage rien.",
      `1. Outil Google Drive « create_file » : title = « ${title} », parentId = « ${cfg.folderId} », contentMimeType = « text/html », textContent = le champ « html » de cette réponse, tel quel (Drive le convertit en Google Doc).`,
      '2. Dépose le lien du document créé (https://docs.google.com/document/d/<id>/edit) : PUT sur la même adresse que le delivery, avec {"contentMd": "<lien>"}.',
      '3. Échec (dossier introuvable, droits, erreur Drive) : POST …/error avec le message exact.',
    ].join('\n'),
    brief: `Prospect : ${st.p.name}. Titre : ${title}. Dossier : ${cfg.folderId}. Version validée : v${doc.version}.`,
    title, folderId: cfg.folderId, html,
  });
});
robot.put(`/clients/${PR_CLIENT}/delivery/pr~gdoc`, async (c) => {
  const { st, doc } = await gdocDoc(c);
  const body = await c.req.json().catch(() => null) as { contentMd?: unknown; url?: unknown } | null;
  const raw = String(body?.url ?? body?.contentMd ?? '').trim();
  const id = raw.match(/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]{10,})/)?.[1];
  if (!id) throw new HttpError(400, 'Lien de Google Doc invalide (https://docs.google.com/document/d/…).');
  const now = nowIso();
  await c.env.DB.prepare(`UPDATE prospect_documents SET gdoc_status = 'cree', gdoc_url = ?1, gdoc_error = NULL, updated_at = ?2 WHERE id = ?3`)
    .bind(`https://docs.google.com/document/d/${id}/edit`, now, doc.id).run();
  await audit(c.env.DB, { clientId: null, ...ROBOT_ACTOR, action: 'prospect_proposition_gdoc_cree', objectType: 'prospect', objectId: st.p.id, after: { id } });
  return c.json({ ok: true });
});
robot.post(`/clients/${PR_CLIENT}/delivery/pr~gdoc/error`, async (c) => {
  const { st, doc } = await gdocDoc(c);
  const body = await c.req.json().catch(() => null) as { message?: unknown } | null;
  const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 1000) : 'Échec sans message.';
  await c.env.DB.prepare(`UPDATE prospect_documents SET gdoc_status = 'erreur', gdoc_error = ?1, updated_at = ?2 WHERE id = ?3`).bind(message, nowIso(), doc.id).run();
  await audit(c.env.DB, { clientId: null, ...ROBOT_ACTOR, action: 'prospect_proposition_gdoc_echec', objectType: 'prospect', objectId: st.p.id, after: { message } });
  return c.json({ ok: true });
});

robot.get(`/clients/${PR_CLIENT}/delivery/${PR_STEP}/brief`, async (c) => {
  const { st, type, doc } = await robotDoc(c);
  return c.json({ masterPrompt: PROSPECT_PROMPTS[type], brief: await buildBrief(c.env.DB, st, type, doc) });
});

robot.put(`/clients/${PR_CLIENT}/delivery/${PR_STEP}`, async (c) => {
  const db = c.env.DB;
  const { st, type, doc } = await robotDoc(c);
  const body = await c.req.json().catch(() => null) as { contentMd?: unknown } | null;
  const content = parseDeposit(type, body?.contentMd);
  if (type === 'proposition') {
    if (!content.sections || typeof content.sections !== 'object') throw new HttpError(400, 'JSON invalide : « sections » doit être un objet.');
    content.markdown = proposalMarkdown(st, await proposalSettings(db), content.sections as Record<string, unknown>);
  }
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [
    db.prepare(`UPDATE prospect_documents SET content_json = ?1, status = 'brouillon', model = 'claude (tâche planifiée)', generated_at = ?2, last_error = NULL, updated_at = ?2 WHERE id = ?3`)
      .bind(JSON.stringify(content), now, doc.id),
  ];
  // Chiffres dits dans la transcription : repris seulement là où ni la trame ni Romain n'ont rien saisi.
  if (type === 'analyse' && content.chiffres && typeof content.chiffres === 'object') {
    for (const k of PROSPECT_FIGURES) {
      const v = (content.chiffres as Record<string, unknown>)[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (k === 'taux_closing' && v > 1)) continue;
      if (st.figs.some((f) => f.key === k && f.origin !== 'transcription')) continue;
      stmts.push(db.prepare(`INSERT INTO prospect_figures (prospect_id, key, value, origin, updated_at) VALUES (?1, ?2, ?3, 'transcription', ?4)
        ON CONFLICT (prospect_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE prospect_figures.origin = 'transcription'`).bind(st.p.id, k, v, now));
    }
  }
  // Trame complétée depuis la transcription : seulement les champs vides (ou déjà déduits), seulement si la citation est dans la transcription.
  let filled: string[] = [];
  if (type === 'analyse' && st.r1 && content.trame && typeof content.trame === 'object') {
    const tpl = await templateVersion(db, st.r1.template_version ?? null);
    const notes = parseJson<Record<string, unknown>>(st.r1.notes_json, {});
    const origins = { ...((notes._origines ?? {}) as Record<string, string>) };
    const verbs = { ...((notes._verbatims ?? {}) as Record<string, string>) };
    const transcript = st.r1.transcript ?? '';
    for (const f of autofillFields(tpl.blocks)) {
      const e = (content.trame as Record<string, unknown>)[f.key] as { valeur?: unknown; verbatim?: unknown } | undefined;
      let v = typeof e?.valeur === 'string' ? e.valeur.trim().slice(0, 2000) : '';
      const q = typeof e?.verbatim === 'string' ? e.verbatim.trim() : '';
      if (!v || !q || !transcript) continue;
      const cur = notes[f.key];
      if (cur !== undefined && cur !== null && String(cur).trim() !== '' && origins[f.key] !== 'transcription') continue;
      if (f.type === 'choice') {
        const opt = f.options?.find((o) => o.toLowerCase() === v.toLowerCase());
        if (!opt) continue;
        v = opt;
      }
      if (!checkVerbatims([q], [transcript])[0]?.found) continue;
      notes[f.key] = v; origins[f.key] = 'transcription'; verbs[f.key] = q; filled.push(f.key);
    }
    if (filled.length) {
      notes._origines = origins; notes._verbatims = verbs;
      stmts.push(db.prepare('UPDATE prospect_calls SET notes_json = ?1, updated_at = ?2 WHERE id = ?3').bind(JSON.stringify(notes), now, st.r1.id));
    }
  }
  await db.batch(stmts);
  await audit(db, { clientId: null, ...ROBOT_ACTOR, action: 'prospect_document_depose', objectType: 'prospect', objectId: `${st.p.id}:${type}`, after: { version: doc.version, trameCompletee: filled } });
  return c.json({ ok: true });
});

robot.post(`/clients/${PR_CLIENT}/delivery/${PR_STEP}/error`, async (c) => {
  const { st, type, doc } = await robotDoc(c);
  const body = await c.req.json().catch(() => null) as { message?: unknown } | null;
  const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 1000) : 'Échec sans message.';
  await c.env.DB.prepare(`UPDATE prospect_documents SET status = 'erreur', last_error = ?1, updated_at = ?2 WHERE id = ?3`).bind(message, nowIso(), doc.id).run();
  await audit(c.env.DB, { clientId: null, ...ROBOT_ACTOR, action: 'prospect_document_echec', objectType: 'prospect', objectId: `${st.p.id}:${type}`, after: { message } });
  return c.json({ ok: true });
});

QUEUE_EXTENSIONS.push(async (env) => {
  const rows = await all<{ prospect_id: string; name: string; type: ProspectDocType; created_at: string; instruction: string | null }>(env.DB,
    `SELECT d.prospect_id, p.name, d.type, d.created_at, d.instruction FROM prospect_documents d JOIN prospects p ON p.id = d.prospect_id
     WHERE d.status = 'en_file' ORDER BY d.created_at`);
  const gdocs = await all<{ prospect_id: string; name: string; gdoc_requested_at: string }>(env.DB,
    `SELECT d.prospect_id, p.name, d.gdoc_requested_at FROM prospect_documents d JOIN prospects p ON p.id = d.prospect_id
     WHERE d.gdoc_status = 'demande' AND d.status = 'valide' ORDER BY d.gdoc_requested_at`);
  return [...gdocs.map((r) => ({
    clientId: r.prospect_id, clientName: `Prospect — ${r.name}`, step: 'pr~gdoc', label: 'Google Doc de la proposition commerciale (prospect)',
    vertical: null, queuedAt: r.gdoc_requested_at,
    instruction: "Module Prospects : le « masterPrompt » du brief décrit la seule action à faire, créer le Google Doc de la proposition dans le dossier indiqué ; dépose son lien dans contentMd.",
  })), ...rows.map((r) => ({
    clientId: r.prospect_id, clientName: `Prospect — ${r.name}`, step: `pr~${r.type}`, label: `${PROSPECT_DOC_LABEL[r.type]} (prospect)`,
    vertical: null, queuedAt: r.created_at,
    instruction: `Module Prospects : le « masterPrompt » du brief est le prompt de ce document ; rends uniquement le bloc JSON demandé dans contentMd.${r.instruction ? ` Consigne de Romain : ${r.instruction}` : ''}`,
  }))];
});
