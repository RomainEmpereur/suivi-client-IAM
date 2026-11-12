import { Hono } from 'hono';
import { addDaysYmd, clientThresholds, derived, todayParis } from '@obsidian/domain';
import type { AppEnv, Bindings, ClientRow } from '../env.ts';
import { requireAgency } from '../auth.ts';
import { scopeClient } from '../scope.ts';
import { all, audit, first, newId, nowIso } from '../db.ts';
import { HttpError, notFound } from '../errors.ts';
import { clientTotals, dailySeries, entityTotals, lastSuccessfulSync, rangeBounds } from '../metrics.ts';
import { safeJson, serializeReco, type RecoRow } from '../serialize.ts';

/**
 * Analyse ponctuelle des campagnes (décision 0011).
 * - L'agence clique « Analyser mes campagnes » et choisit une période : la demande part en file.
 * - Claude (session dédiée, abonnement de l'agence) lit l'instantané des chiffres de l'espace et, en lecture seule,
 *   les publicités Meta ; il dépose une synthèse et au plus six recommandations, internes.
 * - L'agence relit, réécrit si besoin la version client, et publie. Rien n'est visible du client avant.
 */
export const analyses = new Hono<AppEnv>();
analyses.use('/:clientId/analyses', scopeClient);
analyses.use('/:clientId/analyses/*', scopeClient);
analyses.use('/:clientId/recommendations/*', scopeClient);

interface AnalysisRow {
  id: string; client_id: string; period_from: string; period_to: string; status: string; requested_by: string | null;
  requested_at: string; started_at: string | null; completed_at: string | null; data_json: string | null;
  summary_md: string | null; client_summary_md: string | null; error: string | null; visible_client: number; published_at: string | null;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const SEVERITIES = ['info', 'surveiller', 'corriger'] as const;
const MAX_RECOS = 6;

function serializeAnalysis(a: AnalysisRow, recos: RecoRow[], view: 'agence' | 'client') {
  const mine = recos.filter((r) => (r as RecoRow & { analysis_id?: string }).analysis_id === a.id);
  if (view === 'client') {
    return {
      id: a.id, from: a.period_from, to: a.period_to, completedAt: a.completed_at, publishedAt: a.published_at,
      summary: a.client_summary_md, recommendations: mine.filter((r) => r.visible_client).map((r) => serializeReco(r, 'client')),
    };
  }
  return {
    id: a.id, from: a.period_from, to: a.period_to, status: a.status, requestedAt: a.requested_at, startedAt: a.started_at,
    completedAt: a.completed_at, error: a.error, summary: a.summary_md, clientSummary: a.client_summary_md,
    published: Boolean(a.visible_client), publishedAt: a.published_at,
    recommendations: mine.map((r) => serializeReco(r, 'agence')),
  };
}

async function listFor(db: D1Database, clientId: string, view: 'agence' | 'client') {
  const filter = view === 'client' ? `AND visible_client = 1 AND status = 'terminee'` : '';
  const rows = await all<AnalysisRow>(db, `SELECT * FROM analyses WHERE client_id = ?1 ${filter} ORDER BY requested_at DESC LIMIT 20`, clientId);
  const recos = rows.length
    ? await all<RecoRow>(db, `SELECT * FROM recommendations WHERE client_id = ?1 AND analysis_id IN (${rows.map((_, i) => `?${i + 2}`).join(',')})
        ORDER BY CASE severity WHEN 'corriger' THEN 0 WHEN 'surveiller' THEN 1 ELSE 2 END, created_at`, clientId, ...rows.map((r) => r.id))
    : [];
  return rows.map((a) => serializeAnalysis(a, recos, view));
}

analyses.get('/:clientId/analyses', async (c) => {
  return c.json({ analyses: await listFor(c.env.DB, c.get('client').id, c.get('view')) });
});

/** Demander une analyse sur une période (agence). */
analyses.post('/:clientId/analyses', async (c) => {
  requireAgency(c);
  const db = c.env.DB;
  const client = c.get('client');
  const user = c.get('user');
  const body = await c.req.json<{ from?: string; to?: string }>().catch(() => ({} as { from?: string; to?: string }));
  if (!body.from || !body.to || !YMD.test(body.from) || !YMD.test(body.to) || body.from > body.to) throw new HttpError(400, 'Période invalide.');
  const yesterday = addDaysYmd(todayParis(), -1);
  if (body.to > yesterday) throw new HttpError(400, "La période doit s'arrêter au plus tard hier (journée complète).");
  if (body.from < addDaysYmd(body.to, -365)) throw new HttpError(400, 'Période trop longue (un an au plus).');
  const pending = await first<{ id: string }>(db, `SELECT id FROM analyses WHERE client_id = ?1 AND status IN ('en_attente','en_cours')`, client.id);
  if (pending) throw new HttpError(409, 'Une analyse est déjà en cours pour ce client.');
  const has = await clientTotals(db, client.id, body.from, body.to);
  if (!has) throw new HttpError(409, 'Aucun chiffre synchronisé sur cette période : rien à analyser.');
  const id = newId('an');
  await db.prepare('INSERT INTO analyses (id, client_id, period_from, period_to, requested_by) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(id, client.id, body.from, body.to, user.email).run();
  await audit(db, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'analyse_demandee', objectType: 'analysis', objectId: id, after: { from: body.from, to: body.to } });
  return c.json({ id }, 201);
});

/** Relecture et publication d'une analyse (agence). */
analyses.patch('/:clientId/analyses/:analysisId', async (c) => {
  requireAgency(c);
  const db = c.env.DB;
  const client = c.get('client');
  const user = c.get('user');
  const a = await first<AnalysisRow>(db, 'SELECT * FROM analyses WHERE id = ?1 AND client_id = ?2', c.req.param('analysisId'), client.id);
  if (!a) throw notFound();
  const body = await c.req.json<{ clientSummary?: string | null; publish?: boolean; unpublish?: boolean; cancel?: boolean }>().catch(() => ({} as Record<string, never>));
  const now = nowIso();
  if (body.cancel) {
    if (a.status === 'terminee') throw new HttpError(409, 'Analyse terminée : rien à annuler.');
    await db.prepare(`UPDATE analyses SET status = 'echec', error = 'Annulée par l''agence', updated_at = ?1 WHERE id = ?2`).bind(now, a.id).run();
    return c.json({ ok: true });
  }
  if (a.status !== 'terminee') throw new HttpError(409, "L'analyse n'est pas terminée.");
  const stmts: D1PreparedStatement[] = [];
  if ('clientSummary' in body) {
    const v = body.clientSummary;
    if (v !== null && (typeof v !== 'string' || v.length > 8000)) throw new HttpError(400, 'Synthèse client invalide.');
    stmts.push(db.prepare('UPDATE analyses SET client_summary_md = ?1, updated_at = ?2 WHERE id = ?3').bind(v?.trim() || null, now, a.id));
  }
  if (body.publish) {
    // Publication explicite : la synthèse et les recommandations retenues (non ignorées) deviennent visibles.
    stmts.push(db.prepare('UPDATE analyses SET visible_client = 1, published_at = ?1, updated_at = ?1 WHERE id = ?2').bind(now, a.id));
    stmts.push(db.prepare(`UPDATE recommendations SET visible_client = 1, published_at = COALESCE(published_at, ?1), updated_at = ?1
      WHERE analysis_id = ?2 AND state != 'ignoree'`).bind(now, a.id));
  }
  if (body.unpublish) {
    stmts.push(db.prepare('UPDATE analyses SET visible_client = 0, updated_at = ?1 WHERE id = ?2').bind(now, a.id));
    stmts.push(db.prepare('UPDATE recommendations SET visible_client = 0, updated_at = ?1 WHERE analysis_id = ?2').bind(now, a.id));
  }
  if (stmts.length) await db.batch(stmts);
  await audit(db, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: body.publish ? 'analyse_publiee' : body.unpublish ? 'analyse_retiree' : 'analyse_modifiee', objectType: 'analysis', objectId: a.id });
  return c.json({ ok: true });
});

/** Relecture d'une recommandation : version client, note interne, suivi (traitée / ignorée). Agence uniquement. */
analyses.patch('/:clientId/recommendations/:recoId', async (c) => {
  requireAgency(c);
  const db = c.env.DB;
  const client = c.get('client');
  const user = c.get('user');
  const r = await first<RecoRow>(db, 'SELECT * FROM recommendations WHERE id = ?1 AND client_id = ?2', c.req.param('recoId'), client.id);
  if (!r) throw notFound();
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const now = nowIso();
  const sets: string[] = [];
  const vals: unknown[] = [];
  const text = (k: string, max: number) => {
    const v = body[k];
    if (v !== null && (typeof v !== 'string' || v.length > max)) throw new HttpError(400, `Champ ${k} invalide.`);
    return (v as string | null)?.trim() || null;
  };
  if ('clientTitle' in body) { sets.push('client_title'); vals.push(text('clientTitle', 200)); }
  if ('clientBody' in body) { sets.push('client_body'); vals.push(text('clientBody', 2000)); }
  if ('internalNote' in body) { sets.push('internal_note'); vals.push(text('internalNote', 2000)); }
  if ('state' in body) {
    if (!['ouverte', 'traitee', 'ignoree'].includes(body.state as string)) throw new HttpError(400, 'État invalide.');
    sets.push('state'); vals.push(body.state);
    sets.push('state_changed_at'); vals.push(now);
    if (body.state === 'ignoree') { sets.push('visible_client'); vals.push(0); }
  }
  if (!sets.length) throw new HttpError(400, 'Rien à modifier.');
  await db.prepare(`UPDATE recommendations SET ${sets.map((s, i) => `${s} = ?${i + 1}`).join(', ')}, updated_at = ?${sets.length + 1} WHERE id = ?${sets.length + 2}`)
    .bind(...vals, now, r.id).run();
  await audit(db, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'recommandation_modifiee', objectType: 'recommendation', objectId: r.id, after: body });
  return c.json({ ok: true });
});

// ─── Génération (session dédiée, routes /api/robot, même clé que la delivery) ─────

/** Instantané des chiffres de la période (et de la précédente, de même longueur) transmis à l'analyse. */
export async function analysisSnapshot(db: D1Database, client: ClientRow, from: string, to: string) {
  const p = rangeBounds(from, to);
  const [cur, prev, daily, campaigns, campaignsPrev, ads, appts, sync, conns, answers] = await Promise.all([
    clientTotals(db, client.id, from, to),
    clientTotals(db, client.id, p.prevFrom, p.prevTo),
    dailySeries(db, client.id, from, to),
    entityTotals(db, client.id, 'campaign', from, to),
    entityTotals(db, client.id, 'campaign', p.prevFrom, p.prevTo),
    entityTotals(db, client.id, 'ad', from, to),
    all<{ status: string; n: number }>(db, `SELECT status, COUNT(*) AS n FROM appointments WHERE client_id = ?1 AND counts_toward_target = 1
      AND substr(scheduled_at, 1, 10) BETWEEN ?2 AND ?3 GROUP BY status`, client.id, from, to),
    lastSuccessfulSync(db, client.id),
    all<{ type: string; state: string; external_id: string | null }>(db, `SELECT type, state, external_id FROM connections WHERE client_id = ?1`, client.id),
    all<{ question_key: string; answer: string | null }>(db, `SELECT question_key, answer FROM onboarding_answers WHERE client_id = ?1 AND question_key IN ('q02','q21','q38','q42','q43')`, client.id),
  ]);
  const meta = conns.find((x) => x.type === 'meta');
  return {
    client: {
      name: client.name, offer: client.offer, currencyAdAccount: client.ad_account_currency, amountsIn: 'EUR (centimes)',
      thresholds: clientThresholds(client.thresholds_json, client.unit_economics_json), unitEconomics: safeJson(client.unit_economics_json),
      unmeasured: safeJson(client.unmeasured_json ?? '[]'), mechanism: client.delivery_mechanism ?? null,
      metaAdAccountId: meta?.external_id ?? null, connections: conns.map((x) => ({ type: x.type, state: x.state })),
      onboarding: Object.fromEntries(answers.map((a) => [a.question_key, a.answer])),
    },
    period: { from, to, previousFrom: p.prevFrom, previousTo: p.prevTo, lastSuccessfulSync: sync },
    totals: { current: cur, previous: prev, derivedCurrent: cur ? derived(cur) : null, derivedPrevious: prev ? derived(prev) : null },
    daily,
    campaigns: campaigns.map((x) => ({ ...x, derived: derived(x) })),
    campaignsPrevious: campaignsPrev,
    ads: ads.slice(0, 80).map((x) => ({ ...x, derived: derived(x) })),
    adsOmitted: Math.max(0, ads.length - 80),
    appointmentsByStatus: Object.fromEntries(appts.map((a) => [a.status, a.n])),
    notes: [
      'Montants en centimes d’euro. null = non mesuré (jamais 0).',
      'Les lignes « campagne:supprimees » regroupent la dépense des publicités supprimées que Meta ne détaille plus.',
      'Les lignes « campagne:<id> » au niveau publicité sont des imports par campagne (pas de détail par publicité).',
    ],
  };
}

export const analysesRobot = new Hono<{ Bindings: Bindings }>();

analysesRobot.get('/analyses/queue', async (c) => {
  const demo = c.env.ENVIRONMENT === 'production' ? 'AND cl.is_demo = 0' : '';
  const rows = await all<{ id: string; client_id: string; name: string; period_from: string; period_to: string; status: string; requested_at: string }>(c.env.DB,
    `SELECT a.id, a.client_id, cl.name, a.period_from, a.period_to, a.status, a.requested_at FROM analyses a JOIN clients cl ON cl.id = a.client_id
     WHERE a.status IN ('en_attente','en_cours') ${demo} ORDER BY a.requested_at`);
  return c.json({ items: rows.map((r) => ({ analysisId: r.id, clientId: r.client_id, clientName: r.name, from: r.period_from, to: r.period_to, status: r.status, requestedAt: r.requested_at })) });
});

async function robotAnalysis(c: { env: Bindings; req: { param: (k: string) => string | undefined } }) {
  const a = await first<AnalysisRow>(c.env.DB, 'SELECT * FROM analyses WHERE id = ?1 AND client_id = ?2', c.req.param('analysisId')!, c.req.param('clientId')!);
  if (!a) throw notFound();
  const client = (await first<ClientRow>(c.env.DB, 'SELECT * FROM clients WHERE id = ?1', a.client_id))!;
  if (c.env.ENVIRONMENT === 'production' && client.is_demo) throw notFound();
  return { a, client };
}

/** Brief : instantané des chiffres (figé au premier appel) + consignes et format de réponse. */
analysesRobot.get('/clients/:clientId/analyses/:analysisId/brief', async (c) => {
  const { a, client } = await robotAnalysis(c);
  if (a.status === 'terminee' || a.status === 'echec') throw new HttpError(409, 'Analyse déjà close.');
  let data = a.data_json;
  if (!data) {
    data = JSON.stringify(await analysisSnapshot(c.env.DB, client, a.period_from, a.period_to));
    await c.env.DB.prepare(`UPDATE analyses SET data_json = ?1, status = 'en_cours', started_at = ?2, updated_at = ?2 WHERE id = ?3`).bind(data, nowIso(), a.id).run();
  }
  const previous = await all<{ title: string; severity: string; state: string; date: string }>(c.env.DB,
    `SELECT title, severity, state, date FROM recommendations WHERE client_id = ?1 AND (analysis_id IS NULL OR analysis_id != ?2) ORDER BY created_at DESC LIMIT 12`, client.id, a.id);
  return c.json({ data: JSON.parse(data), previousRecommendations: previous, instructions: ANALYSIS_INSTRUCTIONS });
});

const ANALYSIS_INSTRUCTIONS = `Analyse les campagnes du client sur la période, à partir de « data » (instantané de l'espace : Meta + CRM) et, en lecture seule,
des publicités elles-mêmes dans Meta (compte data.client.metaAdAccountId : textes, visuels, statut, diffusion) et de sa page de destination.
Règles :
- Aucun chiffre qui ne figure pas dans data ou dans ce que tu as lu dans Meta. Un indicateur null est « non mesuré », jamais 0.
- Compare à la période précédente et aux seuils (data.client.thresholds) ; le plafond de coût par rendez-vous vient de l'économie unitaire.
- Lis le funnel de bout en bout : impressions → clics → vues de landing → leads → rendez-vous pris → tenus → ventes. Situe la fuite principale.
- Au plus ${MAX_RECOS} recommandations, une seule action chacune, la plus utile d'abord. Titre = l'action. Corps = 2 à 4 phrases : les chiffres, le seuil ou l'écart, le geste exact à faire (dans Meta, sur la landing, dans le CRM). Aucune action n'est faite par toi : tu ne modifies rien dans Meta.
- Tiens compte des recommandations précédentes (previousRecommendations) : ne répète pas ce qui a été traité ; signale ce qui reste ouvert.
- Pour chaque recommandation, une version client : même contenu, langage client, sans jargon interne ni nom de règle.
Réponse attendue (PUT, JSON) :
{ "summaryMd": "synthèse interne en markdown (10 à 20 lignes : ce qui marche, ce qui fuit, priorités)",
  "clientSummaryMd": "synthèse en langage client (5 à 10 lignes)",
  "recommendations": [ { "severity": "info|surveiller|corriger", "title": "...", "body": "...", "clientTitle": "...", "clientBody": "...",
     "metrics": { "nom_indicateur": valeur, ... } } ] }`;

analysesRobot.put('/clients/:clientId/analyses/:analysisId', async (c) => {
  const { a, client } = await robotAnalysis(c);
  if (a.status === 'terminee' || a.status === 'echec') throw new HttpError(409, 'Analyse déjà close.');
  if (!a.data_json) throw new HttpError(409, "Lisez d'abord le brief.");
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) throw new HttpError(400, 'Corps invalide.');
  const str = (v: unknown, max: number, name: string, required = true) => {
    if (v == null || v === '') { if (required) throw new HttpError(400, `${name} manquant.`); return null; }
    if (typeof v !== 'string' || v.length > max) throw new HttpError(400, `${name} invalide.`);
    return v.trim();
  };
  const summary = str(body.summaryMd, 20000, 'summaryMd');
  const clientSummary = str(body.clientSummaryMd, 8000, 'clientSummaryMd', false);
  const recos = body.recommendations;
  if (!Array.isArray(recos) || recos.length === 0 || recos.length > MAX_RECOS) throw new HttpError(400, `Entre 1 et ${MAX_RECOS} recommandations.`);
  const now = nowIso();
  const date = todayParis();
  const stmts: D1PreparedStatement[] = [];
  for (const r of recos as Record<string, unknown>[]) {
    if (!SEVERITIES.includes(r.severity as never)) throw new HttpError(400, 'Gravité invalide.');
    const metrics = r.metrics && typeof r.metrics === 'object' ? JSON.stringify(r.metrics).slice(0, 4000) : '{}';
    stmts.push(c.env.DB.prepare(
      `INSERT INTO recommendations (id, client_id, date, severity, rule_key, title, body, client_title, client_body, metrics_json, analysis_id)
       VALUES (?1, ?2, ?3, ?4, 'analyse', ?5, ?6, ?7, ?8, ?9, ?10)`,
    ).bind(newId('rc'), client.id, date, r.severity, str(r.title, 200, 'title'), str(r.body, 2000, 'body'),
      str(r.clientTitle, 200, 'clientTitle', false), str(r.clientBody, 2000, 'clientBody', false), metrics, a.id));
  }
  stmts.push(c.env.DB.prepare(`UPDATE analyses SET status = 'terminee', summary_md = ?1, client_summary_md = ?2, completed_at = ?3, error = NULL, updated_at = ?3 WHERE id = ?4`)
    .bind(summary, clientSummary, now, a.id));
  // Publication automatique (décision 0014) : case cochée pour ce client → synthèse et recommandations visibles aussitôt.
  const autoPublish = Boolean(client.auto_publish_recos);
  if (autoPublish) {
    stmts.push(c.env.DB.prepare('UPDATE analyses SET visible_client = 1, published_at = ?1 WHERE id = ?2').bind(now, a.id));
    stmts.push(c.env.DB.prepare(`UPDATE recommendations SET visible_client = 1, published_at = ?1 WHERE analysis_id = ?2 AND state != 'ignoree'`).bind(now, a.id));
  }
  await c.env.DB.batch(stmts);
  await audit(c.env.DB, { clientId: client.id, actorId: 'robot-analyse', actorEmail: 'generation-automatique', action: autoPublish ? 'analyse_deposee_publiee' : 'analyse_deposee', objectType: 'analysis', objectId: a.id, after: { recommendations: recos.length, autoPublish } });
  return c.json({ ok: true });
});

analysesRobot.post('/clients/:clientId/analyses/:analysisId/error', async (c) => {
  const { a, client } = await robotAnalysis(c);
  const body = await c.req.json<{ message?: unknown }>().catch(() => null);
  const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 1000) : 'Échec sans message.';
  await c.env.DB.prepare(`UPDATE analyses SET status = 'echec', error = ?1, updated_at = ?2 WHERE id = ?3`).bind(message, nowIso(), a.id).run();
  await audit(c.env.DB, { clientId: client.id, actorId: 'robot-analyse', actorEmail: 'generation-automatique', action: 'analyse_echec', objectType: 'analysis', objectId: a.id, after: { message } });
  return c.json({ ok: true });
});
