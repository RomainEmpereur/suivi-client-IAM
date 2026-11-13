import { Hono, type Context } from 'hono';
import {
  DELIVERY_STEP_BY_KEY, MASTER_PROMPT, OPTIMISATION_STEPS, OPTIMISATION_STEP_LABEL, TOTAL_FIELDS, compareOptimisation, optimisationWindows, todayParis,
  type OptimisationStep, type Totals,
} from '@obsidian/domain';
import type { AppEnv, Bindings } from '../env.ts';
import { requireAgency } from '../auth.ts';
import { scopeClient } from '../scope.ts';
import { all, audit, first, newId, nowIso } from '../db.ts';
import { HttpError, notFound } from '../errors.ts';
import {
  QUEUE_EXTENSIONS, ROBOT_ACTOR, buildBrief, ensureRow, hasContent, loadState, publishDeliverable, readContent, robot, weeklyBlock,
  type State, type StepRow, type VerticalRow,
} from './delivery.ts';

/**
 * Optimisations (décision 0025) : reprise ciblée de pièces déjà en ligne (vague d'ads, formulaire, landing, séquences, structure).
 * - L'agence pose un constat et une hypothèse, choisit les pièces ; Claude les réécrit via la même file que le delivery
 *   (clé « s4~<id> », le prompt de la tâche planifiée ne change pas).
 * - L'agence relit et valide chaque pièce, puis indique la date de mise en ligne. L'espace mesure 14 jours avant / 14 jours après.
 * - Verdict de l'agence : on garde (les pièces deviennent la version de référence du delivery et le livrable du client est mis à jour,
 *   sans marquer les pièces aval « à revoir ») ou on revient à la version précédente.
 * - Visible du client dès que les pièces sont validées (« prête »), avec la mesure et le verdict.
 */
export const optimisations = new Hono<AppEnv>();
optimisations.use('/:clientId/optimisations', scopeClient);
optimisations.use('/:clientId/optimisations/*', scopeClient);

interface OptRow {
  id: string; client_id: string; vertical_id: string | null; title: string; constat: string; hypothese: string; consigne: string | null;
  source: string; source_ref: string | null; status: string; launched_on: string | null; verdict: string | null; verdict_note: string | null;
  verdict_at: string | null; created_at: string; updated_at: string;
}
interface PieceRow {
  id: string; optimisation_id: string; client_id: string; step: OptimisationStep; status: string; content_md: string | null; content_version: number;
  content_source: string | null; instruction: string | null; queued_at: string | null; generated_at: string | null; validated_at: string | null;
  last_error: string | null; updated_at: string;
}

const CLIENT_VISIBLE = ['prete', 'en_ligne', 'terminee'];
const OPT_SEP = '~';
const isStep = (v: unknown): v is OptimisationStep => typeof v === 'string' && (OPTIMISATION_STEPS as readonly string[]).includes(v);
const stepLabel = (k: OptimisationStep) => DELIVERY_STEP_BY_KEY.get(k)!.label;

function text(body: Record<string, unknown>, k: string, label: string, max: number, required: boolean): string | null {
  const v = typeof body[k] === 'string' ? (body[k] as string).trim() : '';
  if (required && !v) throw new HttpError(400, `${label} requis.`);
  if (v.length > max) throw new HttpError(400, `${label} : ${max} caractères au plus.`);
  return v || null;
}

const SUM_COLS = TOTAL_FIELDS.map((f) => `SUM(${f}) AS ${f}`).join(', ');
async function windowTotals(db: D1Database, clientId: string, from: string, to: string) {
  const row = await first<Totals & { n: number }>(db,
    `SELECT COUNT(*) AS n, ${SUM_COLS} FROM metrics_rollup WHERE client_id = ?1 AND period_type = 'day' AND level = 'client' AND period_start BETWEEN ?2 AND ?3`,
    clientId, from, to);
  if (!row?.n) return { totals: null, days: 0 };
  const { n, ...totals } = row;
  return { totals: totals as Totals, days: n };
}

async function measure(db: D1Database, o: OptRow) {
  if (!o.launched_on) return null;
  const w = optimisationWindows(o.launched_on, todayParis());
  const before = await windowTotals(db, o.client_id, w.before.from, w.before.to);
  const after = w.after ? await windowTotals(db, o.client_id, w.after.from, w.after.to) : { totals: null, days: 0 };
  return {
    before: { ...w.before, syncedDays: before.days },
    after: w.after ? { ...w.after, syncedDays: after.days } : null,
    elapsedDays: w.elapsedDays, complete: w.complete, completeOn: w.completeOn,
    metrics: compareOptimisation(before.totals, after.totals),
  };
}

async function serialize(db: D1Database, o: OptRow, pieces: PieceRow[], vertical: { id: string; name: string } | null, agency: boolean) {
  return {
    id: o.id, title: o.title, constat: o.constat, hypothese: o.hypothese, consigne: agency ? o.consigne : null,
    source: o.source, status: o.status, launchedOn: o.launched_on, verdict: o.verdict, verdictNote: o.verdict_note, verdictAt: o.verdict_at,
    createdAt: o.created_at, updatedAt: o.updated_at, vertical, visibleClient: CLIENT_VISIBLE.includes(o.status),
    pieces: pieces.map((p) => ({
      step: p.step, label: stepLabel(p.step), purpose: OPTIMISATION_STEP_LABEL[p.step], status: p.status,
      contentMd: agency || p.status === 'validee' ? p.content_md : null, contentVersion: p.content_version, contentSource: agency ? p.content_source : null,
      queued: Boolean(p.queued_at), lastError: agency ? p.last_error : null, instruction: agency ? p.instruction : null,
      generatedAt: p.generated_at, validatedAt: p.validated_at,
    })),
    measure: await measure(db, o),
  };
}

async function loadOpt(db: D1Database, clientId: string, id: string) {
  const o = await first<OptRow>(db, 'SELECT * FROM optimisations WHERE id = ?1 AND client_id = ?2', id, clientId);
  if (!o) throw notFound();
  const pieces = await all<PieceRow>(db, 'SELECT * FROM optimisation_pieces WHERE optimisation_id = ?1', o.id);
  pieces.sort((a, b) => OPTIMISATION_STEPS.indexOf(a.step) - OPTIMISATION_STEPS.indexOf(b.step));
  return { o, pieces };
}

optimisations.get('/:clientId/optimisations', async (c) => {
  const db = c.env.DB;
  const client = c.get('client');
  const agency = c.get('user').role === 'agence';
  const rows = await all<OptRow>(db,
    `SELECT * FROM optimisations WHERE client_id = ?1 ${agency ? '' : `AND status IN (${CLIENT_VISIBLE.map((s) => `'${s}'`).join(',')})`} ORDER BY created_at DESC`, client.id);
  const pieces = rows.length ? await all<PieceRow>(db, 'SELECT * FROM optimisation_pieces WHERE client_id = ?1', client.id) : [];
  const verticals = await all<{ id: string; name: string; status: string }>(db, 'SELECT id, name, status FROM verticals WHERE client_id = ?1 ORDER BY created_at', client.id);
  const vname = new Map(verticals.map((v) => [v.id, v.name]));
  const items = [];
  for (const o of rows) {
    const ps = pieces.filter((p) => p.optimisation_id === o.id).sort((a, b) => OPTIMISATION_STEPS.indexOf(a.step) - OPTIMISATION_STEPS.indexOf(b.step));
    items.push(await serialize(db, o, ps, o.vertical_id ? { id: o.vertical_id, name: vname.get(o.vertical_id) ?? '' } : null, agency));
  }
  // Pièces disponibles pour une nouvelle optimisation (agence) : celles déjà rédigées dans la chaîne visée.
  let available: Record<string, OptimisationStep[]> | null = null;
  if (agency) {
    const steps = await all<{ step: string }>(db, `SELECT step FROM delivery_steps WHERE client_id = ?1 AND (content_md IS NOT NULL OR result_url IS NOT NULL)`, client.id);
    available = {};
    for (const s of steps) {
      const [key, vid = ''] = s.step.split('@');
      if (isStep(key)) (available[vid] ??= []).push(key);
    }
    for (const k of Object.keys(available)) available[k].sort((a, b) => OPTIMISATION_STEPS.indexOf(a) - OPTIMISATION_STEPS.indexOf(b));
  }
  return c.json({
    items,
    steps: OPTIMISATION_STEPS.map((k) => ({ key: k, label: stepLabel(k), purpose: OPTIMISATION_STEP_LABEL[k] })),
    verticals: agency ? verticals.filter((v) => v.status === 'active').map((v) => ({ id: v.id, name: v.name })) : [],
    available,
    generationConfigured: Boolean(c.env.DELIVERY_ROBOT_TOKEN),
  });
});

optimisations.post('/:clientId/optimisations', async (c) => {
  requireAgency(c);
  const db = c.env.DB;
  const client = c.get('client');
  const user = c.get('user');
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Corps de requête invalide.');
  const title = text(body, 'title', 'Titre', 160, true)!;
  const constat = text(body, 'constat', 'Constat', 3000, true)!;
  const hypothese = text(body, 'hypothese', 'Hypothèse', 2000, true)!;
  const consigne = text(body, 'consigne', 'Consigne', 2000, false);
  const steps = Array.isArray(body.steps) ? [...new Set(body.steps)] : [];
  if (!steps.length || !steps.every(isStep)) throw new HttpError(400, 'Choisissez au moins une pièce à reprendre.');
  const source = body.source === 'analyse' || body.source === 'point_hebdo' ? body.source : 'manuelle';
  const sourceRef = typeof body.sourceRef === 'string' ? body.sourceRef.slice(0, 64) : null;
  const vid = typeof body.verticalId === 'string' ? body.verticalId : '';
  const st = await loadState(db, client.id, vid);
  if (vid && st.vertical?.status !== 'active') throw new HttpError(409, 'Verticale archivée.');
  if (!st.gate.ok) throw new HttpError(409, 'Conditions de lancement du delivery non remplies.');
  const missing = (steps as OptimisationStep[]).filter((k) => !hasContent(st.byStep.get(k)));
  if (missing.length) throw new HttpError(409, `Pièce pas encore rédigée dans le delivery : ${missing.map(stepLabel).join(', ')}.`);
  const queue = body.queue !== false;
  const id = newId('op');
  const now = nowIso();
  await db.batch([
    db.prepare('INSERT INTO optimisations (id, client_id, vertical_id, title, constat, hypothese, consigne, source, source_ref, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)')
      .bind(id, client.id, vid || null, title, constat, hypothese, consigne, source, sourceRef, user.email),
    ...(steps as OptimisationStep[]).map((k) => db.prepare(
      'INSERT INTO optimisation_pieces (id, optimisation_id, client_id, step, status, queued_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
    ).bind(newId('opp'), id, client.id, k, queue ? 'en_file' : 'a_rediger', queue ? now : null, now)),
  ]);
  await audit(db, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'optimisation_creation', objectType: 'optimisation', objectId: id, after: { title, steps, vertical: vid || null, queue } });
  return c.json({ ok: true, id }, 201);
});

optimisations.patch('/:clientId/optimisations/:id', async (c) => {
  requireAgency(c);
  const db = c.env.DB;
  const client = c.get('client');
  const user = c.get('user');
  const { o, pieces } = await loadOpt(db, client.id, c.req.param('id'));
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Corps de requête invalide.');
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  const changes: Record<string, unknown> = {};

  const fields: [string, string, string, number, boolean][] = [
    ['title', 'title', 'Titre', 160, true], ['constat', 'constat', 'Constat', 3000, true],
    ['hypothese', 'hypothese', 'Hypothèse', 2000, true], ['consigne', 'consigne', 'Consigne', 2000, false],
  ];
  for (const [k, col, label, max, req] of fields) {
    if (!(k in body)) continue;
    const v = text(body, k, label, max, req);
    stmts.push(db.prepare(`UPDATE optimisations SET ${col} = ?1, updated_at = ?2 WHERE id = ?3`).bind(v, now, o.id));
    changes[k] = v;
  }

  if ('launchedOn' in body) {
    const d = body.launchedOn;
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) throw new HttpError(400, 'Date de mise en ligne invalide (AAAA-MM-JJ).');
    if (!['prete', 'en_ligne'].includes(o.status)) throw new HttpError(409, "Validez d'abord toutes les pièces de l'optimisation.");
    stmts.push(db.prepare(`UPDATE optimisations SET launched_on = ?1, status = 'en_ligne', updated_at = ?2 WHERE id = ?3`).bind(d, now, o.id));
    changes.launchedOn = d;
  }

  if ('verdict' in body) {
    const v = body.verdict;
    if (v !== 'garder' && v !== 'revenir') throw new HttpError(400, 'Verdict invalide.');
    if (o.status !== 'en_ligne') throw new HttpError(409, "Le verdict se donne une fois l'optimisation en ligne.");
    const note = text(body, 'verdictNote', 'Commentaire', 2000, false);
    stmts.push(db.prepare(`UPDATE optimisations SET verdict = ?1, verdict_note = ?2, verdict_at = ?3, status = 'terminee', updated_at = ?3 WHERE id = ?4`).bind(v, note, now, o.id));
    if (v === 'garder') stmts.push(...await applyPieces(db, o, pieces, now));
    changes.verdict = v;
  }

  if (body.abandon === true) {
    if (o.status === 'terminee') throw new HttpError(409, 'Optimisation déjà terminée.');
    stmts.push(
      db.prepare(`UPDATE optimisations SET status = 'abandonnee', updated_at = ?1 WHERE id = ?2`).bind(now, o.id),
      db.prepare(`UPDATE optimisation_pieces SET queued_at = NULL, status = CASE WHEN status = 'en_file' THEN (CASE WHEN content_md IS NULL THEN 'a_rediger' ELSE 'a_relire' END) ELSE status END, updated_at = ?1 WHERE optimisation_id = ?2`).bind(now, o.id),
    );
    changes.abandon = true;
  }

  if (!stmts.length) throw new HttpError(400, 'Rien à modifier.');
  await db.batch(stmts);
  await audit(db, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'optimisation_modifiee', objectType: 'optimisation', objectId: o.id, before: { status: o.status }, after: changes });
  return c.json({ ok: true });
});

/** Verdict « on garde » : chaque pièce devient la version de référence de l'étape, et le livrable du client est mis à jour. Rien n'est marqué « à revoir ». */
async function applyPieces(db: D1Database, o: OptRow, pieces: PieceRow[], now: string) {
  const st = await loadState(db, o.client_id, o.vertical_id ?? '');
  const stmts: D1PreparedStatement[] = [];
  for (const p of pieces) {
    if (p.status !== 'validee' || !p.content_md) continue;
    const step = DELIVERY_STEP_BY_KEY.get(p.step)!;
    const row = st.byStep.get(p.step);
    const version = (row?.content_version ?? 0) + 1;
    const key = st.sk(p.step);
    stmts.push(
      ensureRow(db, o.client_id, key),
      db.prepare('INSERT INTO delivery_versions (id, client_id, step, version, content_md, source, instruction) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
        .bind(newId('dlv'), o.client_id, key, version, p.content_md, 'agence', `Optimisation « ${o.title} » gardée`),
      db.prepare(`UPDATE delivery_steps SET content_md = ?1, content_version = ?2, content_source = 'agence', status = 'valide', validated_at = ?3,
          stale = 0, updated_at = ?3 WHERE client_id = ?4 AND step = ?5`).bind(p.content_md, version, now, o.client_id, key),
    );
    if (step.deliverable) stmts.push(...await publishDeliverable(db, o.client_id, step, p.content_md, row?.result_url ?? null, st.mechanism, now, st.vertical));
  }
  return stmts;
}

optimisations.patch('/:clientId/optimisations/:id/pieces/:step', async (c) => {
  requireAgency(c);
  const db = c.env.DB;
  const client = c.get('client');
  const user = c.get('user');
  const { o, pieces } = await loadOpt(db, client.id, c.req.param('id'));
  const p = pieces.find((x) => x.step === c.req.param('step'));
  if (!p) throw notFound();
  if (o.status === 'terminee' || o.status === 'abandonnee') throw new HttpError(409, 'Optimisation close.');
  if (o.status === 'en_ligne') throw new HttpError(409, 'Optimisation déjà en ligne : créez-en une nouvelle pour changer une pièce.');
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Corps de requête invalide.');
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  let status = p.status;
  let content = p.content_md;

  if ('contentMd' in body) {
    const next = readContent(body.contentMd);
    if (next !== p.content_md) {
      if (p.queued_at) throw new HttpError(409, 'Claude est en train de reprendre cette pièce : attendez la nouvelle version.');
      stmts.push(db.prepare(`UPDATE optimisation_pieces SET content_md = ?1, content_version = content_version + 1, content_source = 'agence',
          status = 'a_relire', validated_at = NULL, updated_at = ?2 WHERE id = ?3`).bind(next, now, p.id));
      status = 'a_relire'; content = next;
    }
  }
  if (body.regenerate === true) {
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim().slice(0, 2000) || null : null;
    stmts.push(db.prepare(`UPDATE optimisation_pieces SET queued_at = ?1, instruction = ?2, status = 'en_file', validated_at = NULL, last_error = NULL, updated_at = ?1 WHERE id = ?3`)
      .bind(now, instruction, p.id));
    status = 'en_file';
  }
  if (body.status === 'validee') {
    if (status === 'en_file' || p.queued_at) throw new HttpError(409, 'Claude est en train de reprendre cette pièce : attendez la nouvelle version.');
    if (!content?.trim()) throw new HttpError(409, 'Pièce vide : rien à valider.');
    stmts.push(db.prepare(`UPDATE optimisation_pieces SET status = 'validee', validated_at = ?1, updated_at = ?1 WHERE id = ?2`).bind(now, p.id));
    status = 'validee';
  } else if (body.status === 'a_relire') {
    if (p.status !== 'validee') throw new HttpError(409, 'Pièce non validée.');
    stmts.push(db.prepare(`UPDATE optimisation_pieces SET status = 'a_relire', validated_at = NULL, updated_at = ?1 WHERE id = ?2`).bind(now, p.id));
    status = 'a_relire';
  } else if ('status' in body) throw new HttpError(400, 'Statut invalide.');
  if (!stmts.length) throw new HttpError(400, 'Rien à modifier.');

  // Toutes les pièces validées → l'optimisation est prête (et visible du client) ; sinon elle revient en préparation.
  const allValid = pieces.every((x) => (x.id === p.id ? status : x.status) === 'validee');
  const next = allValid ? 'prete' : 'en_preparation';
  if (next !== o.status) stmts.push(db.prepare('UPDATE optimisations SET status = ?1, updated_at = ?2 WHERE id = ?3').bind(next, now, o.id));
  await db.batch(stmts);
  await audit(db, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'optimisation_piece_modifiee', objectType: 'optimisation', objectId: `${o.id}:${p.step}`, after: { status, optimisation: next } });
  return c.json({ ok: true, status: next });
});

// ─── Robot : même file, même URL que le delivery, clé « <étape>~<id> » ─────────────────────────

function optInstruction(o: OptRow, p: PieceRow, all: PieceRow[]) {
  const others = all.filter((x) => x.step !== p.step).map((x) => stepLabel(x.step));
  const lines = [
    `Optimisation « ${o.title} » : reprise ciblée de cette pièce, déjà en ligne, pour améliorer les résultats.`,
    `Constat : ${o.constat}`,
    `Hypothèse à tester : ${o.hypothese}`,
  ];
  if (o.consigne) lines.push(`Consigne de l'agence : ${o.consigne}`);
  if (p.instruction) lines.push(`Retour de l'agence sur ta proposition précédente (prioritaire) : ${p.instruction}`);
  if (others.length) lines.push(`Pièces reprises dans la même optimisation : ${others.join(', ')}.`);
  lines.push(
    "Pars de la version reproduite ci-dessous. Ne change que ce qui sert l'hypothèse ; garde l'avatar, le mécanisme nommé, la promesse et le CTA unique, " +
    "sauf si l'hypothèse porte précisément dessus. Pour une nouvelle vague de publicités, rends des publicités nouvelles (nouveaux hooks et angles), pas une copie de la vague en ligne. " +
    'Aucun chiffre inventé : les chiffres de la semaine ci-dessous sont les seuls mesurés. Les règles du master prompt restent valables.',
    "Termine par une section « Ce qui change dans cette optimisation » : chaque changement, relié à l'hypothèse, puis l'indicateur à surveiller (coût par lead, coût par rendez-vous ou taux de réservation).",
  );
  return lines.join('\n');
}

function parseKey(raw: string) {
  const i = raw.indexOf(OPT_SEP);
  const step = raw.slice(0, i);
  if (i < 0 || !isStep(step)) throw notFound();
  return { step, optId: raw.slice(i + 1) };
}

async function robotPiece(c: Context<{ Bindings: Bindings }>) {
  const { step, optId } = parseKey(c.req.param('step')!);
  const db = c.env.DB;
  const o = await first<OptRow>(db, 'SELECT * FROM optimisations WHERE id = ?1 AND client_id = ?2', optId, c.req.param('clientId')!);
  if (!o) throw notFound();
  const pieces = await all<PieceRow>(db, 'SELECT * FROM optimisation_pieces WHERE optimisation_id = ?1', o.id);
  const p = pieces.find((x) => x.step === step);
  if (!p) throw notFound();
  const st = await loadState(db, o.client_id, o.vertical_id ?? '');
  if (c.env.ENVIRONMENT === 'production' && st.client.is_demo) throw notFound();
  if (o.status === 'abandonnee' || o.status === 'terminee') throw new HttpError(409, 'Optimisation close.');
  return { o, p, pieces, st };
}

robot.get('/clients/:clientId/delivery/:step{[^/]+~[^/]+}/brief', async (c) => {
  const { o, p, pieces, st } = await robotPiece(c);
  const step = DELIVERY_STEP_BY_KEY.get(p.step)!;
  const base = st.byStep.get(p.step);
  const byStep = new Map(st.byStep);
  byStep.set(p.step, { ...(base ?? {}), instruction: optInstruction(o, p, pieces), content_md: p.content_md ?? base?.content_md ?? null } as StepRow);
  const weekly = await weeklyBlock(c.env.DB, st.client);
  const brief = buildBrief(step, { ...st, byStep } as State, weekly)
    .replace(/^# (.*)$/m, `# $1 — Optimisation « ${o.title.replace(/\$/g, '$$$$')} »`);
  return c.json({ masterPrompt: MASTER_PROMPT, brief });
});

robot.put('/clients/:clientId/delivery/:step{[^/]+~[^/]+}', async (c) => {
  const { o, p } = await robotPiece(c);
  const body = await c.req.json().catch(() => null) as { contentMd?: unknown } | null;
  const content = readContent(body?.contentMd);
  const now = nowIso();
  await c.env.DB.prepare(`UPDATE optimisation_pieces SET content_md = ?1, content_version = content_version + 1, content_source = 'claude', status = 'a_relire',
      queued_at = NULL, instruction = NULL, last_error = NULL, generated_at = ?2, validated_at = NULL, updated_at = ?2 WHERE id = ?3`).bind(content, now, p.id).run();
  if (o.status === 'prete') await c.env.DB.prepare(`UPDATE optimisations SET status = 'en_preparation', updated_at = ?1 WHERE id = ?2`).bind(now, o.id).run();
  await audit(c.env.DB, { clientId: o.client_id, ...ROBOT_ACTOR, action: 'optimisation_piece_deposee', objectType: 'optimisation', objectId: `${o.id}:${p.step}`, after: { version: p.content_version + 1 } });
  return c.json({ ok: true });
});

robot.post('/clients/:clientId/delivery/:step{[^/]+~[^/]+}/error', async (c) => {
  const { o, p } = await robotPiece(c);
  const body = await c.req.json().catch(() => null) as { message?: unknown } | null;
  const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 1000) : 'Échec sans message.';
  await c.env.DB.prepare(`UPDATE optimisation_pieces SET queued_at = NULL, last_error = ?1, status = CASE WHEN content_md IS NULL THEN 'a_rediger' ELSE 'a_relire' END, updated_at = ?2 WHERE id = ?3`)
    .bind(message, nowIso(), p.id).run();
  await audit(c.env.DB, { clientId: o.client_id, ...ROBOT_ACTOR, action: 'optimisation_echec', objectType: 'optimisation', objectId: `${o.id}:${p.step}`, after: { message } });
  return c.json({ ok: true });
});

QUEUE_EXTENSIONS.push(async (env) => {
  const demo = env.ENVIRONMENT === 'production' ? 'AND cl.is_demo = 0' : '';
  const rows = await all<{ client_id: string; name: string; step: OptimisationStep; queued_at: string; opt_id: string; title: string; vname: string | null }>(env.DB,
    `SELECT p.client_id, cl.name, p.step, p.queued_at, o.id AS opt_id, o.title, v.name AS vname FROM optimisation_pieces p
     JOIN optimisations o ON o.id = p.optimisation_id JOIN clients cl ON cl.id = p.client_id LEFT JOIN verticals v ON v.id = o.vertical_id
     WHERE p.queued_at IS NOT NULL AND o.status IN ('en_preparation','prete') ${demo} ORDER BY p.client_id, p.queued_at`);
  rows.sort((a, b) => a.client_id.localeCompare(b.client_id) || a.opt_id.localeCompare(b.opt_id) || OPTIMISATION_STEPS.indexOf(a.step) - OPTIMISATION_STEPS.indexOf(b.step));
  return rows.map((r) => ({
    clientId: r.client_id, clientName: `${r.name}${r.vname ? ` — verticale « ${r.vname} »` : ''} — optimisation « ${r.title} »`,
    step: `${r.step}${OPT_SEP}${r.opt_id}`, label: `${stepLabel(r.step)} (optimisation)`, vertical: r.vname,
    instruction: 'Optimisation ciblée : le brief contient le constat, l\'hypothèse et la version en ligne à reprendre.', queuedAt: r.queued_at,
  }));
});

export type { VerticalRow };
