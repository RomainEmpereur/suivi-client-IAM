import { Hono } from 'hono';
import {
  ALL_QUESTIONS, DELIVERY_STEPS, DELIVERY_STEP_BY_KEY, MASTER_PROMPT, ONBOARDING_SECTIONS, deliveryGate, derived,
  formatDate, formatEuros, formatInt, formatPercent, isAnswered, stepAvailability, stepInstructions, type DeliveryStep,
} from '@obsidian/domain';
import type { AppEnv, ClientRow } from '../env.ts';
import { requireAgency } from '../auth.ts';
import { scopeClient } from '../scope.ts';
import { all, audit, first, newId, nowIso, run } from '../db.ts';
import { HttpError, notFound } from '../errors.ts';
import { clientTotals, periodBounds } from '../metrics.ts';

/**
 * Delivery piloté par l'espace (décision 0008). Agence uniquement, en vue agence.
 * La rédaction se fait dans le projet Claude de delivery (master prompt en instructions) ;
 * l'espace vérifie les conditions de lancement, enchaîne les étapes, prépare le brief à coller,
 * et garde le lien du résultat et la validation. Rien n'est envoyé à un service externe.
 */
export const delivery = new Hono<AppEnv>();
delivery.use('/:clientId/delivery', scopeClient);
delivery.use('/:clientId/delivery/*', scopeClient);
delivery.use('/:clientId/delivery', async (c, next) => { requireAgency(c); await next(); });
delivery.use('/:clientId/delivery/*', async (c, next) => { requireAgency(c); await next(); });

/** Master prompt complet, à coller dans les instructions du projet Claude. */
export const deliveryAgency = new Hono<AppEnv>();
deliveryAgency.get('/delivery/master-prompt', (c) => { requireAgency(c); return c.json({ text: MASTER_PROMPT }); });

interface StepRow {
  id: string; client_id: string; step: string; status: 'a_faire' | 'en_cours' | 'a_valider' | 'valide';
  result_url: string | null; notes: string | null; validated_at: string | null; updated_at: string;
}
const STATUSES = ['a_faire', 'en_cours', 'a_valider', 'valide'] as const;

async function loadState(db: D1Database, clientId: string) {
  const client = (await first<ClientRow>(db, 'SELECT * FROM clients WHERE id = ?1', clientId))!;
  const [answerRows, stepRows] = await Promise.all([
    all<{ question_key: string; answer: string | null }>(db, 'SELECT question_key, answer FROM onboarding_answers WHERE client_id = ?1', clientId),
    all<StepRow>(db, 'SELECT * FROM delivery_steps WHERE client_id = ?1', clientId),
  ]);
  const answers = Object.fromEntries(answerRows.map((a) => [a.question_key, a.answer]));
  const gate = deliveryGate(client.onboarding_submitted_at ?? null, answers);
  const byStep = new Map(stepRows.map((r) => [r.step, r]));
  const validated = new Set(stepRows.filter((r) => r.status === 'valide').map((r) => r.step));
  const mechanism = client.delivery_mechanism ?? null;
  const avail = (key: string) => stepAvailability(key, { gateOk: gate.ok, mechanism, validated });
  return { client, answers, gate, byStep, validated, mechanism, avail };
}

function serializeStep(s: DeliveryStep, row: StepRow | undefined, a: { available: boolean; reason: string | null }) {
  return {
    key: s.key, label: s.label, recurring: Boolean(s.recurring), needsMechanism: s.needsMechanism,
    deliverable: s.deliverable ? s.deliverable.title : null,
    status: row?.status ?? 'a_faire', resultUrl: row?.result_url ?? null, notes: row?.notes ?? null,
    validatedAt: row?.validated_at ?? null, updatedAt: row?.updated_at ?? null,
    available: a.available, lockedReason: a.reason,
  };
}

delivery.get('/:clientId/delivery', async (c) => {
  const st = await loadState(c.env.DB, c.get('client').id);
  return c.json({
    gate: st.gate,
    mechanism: st.mechanism,
    driveFolderUrl: st.client.drive_folder_url ?? null,
    steps: DELIVERY_STEPS.map((s) => serializeStep(s, st.byStep.get(s.key), st.avail(s.key))),
  });
});

function stepOr404(key: string) {
  const s = DELIVERY_STEP_BY_KEY.get(key);
  if (!s) throw notFound();
  return s;
}

/** Brief à coller dans le projet Claude : consignes de l'étape + dossier client + livrables validés en amont. */
delivery.get('/:clientId/delivery/:step/brief', async (c) => {
  const step = stepOr404(c.req.param('step'));
  const db = c.env.DB;
  const st = await loadState(db, c.get('client').id);
  const a = st.avail(step.key);
  if (!a.available) throw new HttpError(409, a.reason ?? 'Étape non disponible.');
  const weekly = step.key === 's8' ? await weeklyBlock(db, st.client) : null;
  return c.json({ text: buildBrief(step, st, weekly) });
});

function buildBrief(step: DeliveryStep, st: Awaited<ReturnType<typeof loadState>>, weekly: string | null): string {
  const { client } = st;
  const out: string[] = [];
  out.push(`# ${client.name} — Étape ${step.label}`);
  out.push('');
  out.push(`Applique le master prompt de delivery (instructions du projet) au client ${client.name}, pour l'étape ${step.label} uniquement. ` +
    "Livre la pièce pour validation ; ne passe pas à l'étape suivante. Consomme les livrables validés ci-dessous, ne les réinvente pas.");
  out.push('');
  if (st.mechanism) {
    out.push(`**Mécanisme nommé choisi par le client (verrouillé) : ${st.mechanism}**`);
    out.push('');
  }

  const prior = DELIVERY_STEPS.slice(0, DELIVERY_STEPS.indexOf(step)).filter((s) => st.validated.has(s.key));
  out.push('## Livrables validés en amont');
  if (prior.length === 0) out.push('Aucun : c\'est la première étape.');
  for (const s of prior) {
    const r = st.byStep.get(s.key)!;
    out.push(`- ${s.label} : ${r.result_url ?? 'lien non renseigné'}${r.notes ? ` — ${r.notes.replace(/\s+/g, ' ')}` : ''}`);
  }
  out.push('');

  out.push('## Dossier client');
  const site = st.answers.q02;
  out.push(`- Site : ${site?.trim() || 'non renseigné'}`);
  out.push(client.drive_folder_url
    ? `- Ressources (logo, captures, témoignages, cas client) : dossier Drive ${client.drive_folder_url}`
    : '- Ressources : aucun dossier fourni. Avancer sans, et lister à la fin ce qui manquerait pour renforcer la pièce.');
  out.push(`- Onboarding envoyé le ${formatDate(client.onboarding_submitted_at ?? null, { year: true })}`);
  out.push('');

  if (weekly) { out.push(weekly); out.push(''); }

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
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
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

const isHttps = (v: string) => { try { return new URL(v).protocol === 'https:'; } catch { return false; } };

delivery.patch('/:clientId/delivery/:step', async (c) => {
  const step = stepOr404(c.req.param('step'));
  const db = c.env.DB;
  const user = c.get('user');
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Corps de requête invalide.');
  const st = await loadState(db, c.get('client').id);
  const row = st.byStep.get(step.key);
  const before = row ?? null;

  let status = row?.status ?? 'a_faire';
  let resultUrl = row?.result_url ?? null;
  let notes = row?.notes ?? null;
  let mechanism = st.mechanism;

  if ('resultUrl' in body) {
    const v = body.resultUrl;
    if (v === null || v === '') resultUrl = null;
    else if (typeof v === 'string' && isHttps(v.trim())) resultUrl = v.trim();
    else throw new HttpError(400, 'Le lien du résultat doit être une adresse https.');
  }
  if ('notes' in body) {
    if (body.notes !== null && typeof body.notes !== 'string') throw new HttpError(400, 'Notes invalides.');
    notes = (body.notes as string | null)?.trim() || null;
    if (notes && notes.length > 4000) throw new HttpError(400, 'Notes trop longues (4 000 caractères au plus).');
  }
  if ('mechanism' in body) {
    if (step.key !== 's1c') throw new HttpError(400, "Le mécanisme se choisit à l'étape 1C.");
    const v = body.mechanism;
    if (v !== null && (typeof v !== 'string' || v.trim().length > 120)) throw new HttpError(400, 'Nom de mécanisme invalide.');
    const next = (v as string | null)?.trim() || null;
    if (next !== mechanism) {
      const downstream = DELIVERY_STEPS.filter((s) => s.needsMechanism && (st.byStep.get(s.key)?.status ?? 'a_faire') !== 'a_faire');
      if (downstream.length) throw new HttpError(409, `Le mécanisme est verrouillé : « ${downstream[0].label} » a déjà démarré.`);
      mechanism = next;
    }
  }
  if ('status' in body) {
    if (!STATUSES.includes(body.status as never)) throw new HttpError(400, 'Statut invalide.');
    status = body.status as StepRow['status'];
  }

  // Démarrer ou faire avancer une étape exige qu'elle soit disponible.
  if (status !== 'a_faire' && status !== (row?.status ?? 'a_faire')) {
    const a = st.avail(step.key);
    if (!a.available) throw new HttpError(409, a.reason ?? 'Étape non disponible.');
  }
  if (status === 'valide') {
    if (step.recurring) throw new HttpError(400, 'Le point hebdomadaire est récurrent : il ne se valide pas.');
    if (!resultUrl) throw new HttpError(400, 'Renseignez le lien du document validé avant de valider.');
    if (step.key === 's1c' && !mechanism) throw new HttpError(400, 'Renseignez le nom du mécanisme choisi par le client avant de valider la page client.');
  }
  // Revenir sur une étape validée : seulement si la suivante n'a pas démarré.
  if (row?.status === 'valide' && status !== 'valide') {
    const i = DELIVERY_STEPS.indexOf(step);
    const next = DELIVERY_STEPS[i + 1];
    if (next && (st.byStep.get(next.key)?.status ?? 'a_faire') !== 'a_faire') {
      throw new HttpError(409, `Revenez d'abord sur « ${next.label} », qui a déjà démarré.`);
    }
  }

  const now = nowIso();
  const validatedAt = status === 'valide' ? (row?.status === 'valide' ? row.validated_at : now) : null;
  const id = row?.id ?? newId('dls');
  const stmts: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO delivery_steps (id, client_id, step, status, result_url, notes, validated_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT (client_id, step) DO UPDATE SET status = excluded.status, result_url = excluded.result_url,
         notes = excluded.notes, validated_at = excluded.validated_at, updated_at = excluded.updated_at`,
    ).bind(id, st.client.id, step.key, status, resultUrl, notes, validatedAt, now),
  ];
  if (mechanism !== st.mechanism) {
    stmts.push(db.prepare('UPDATE clients SET delivery_mechanism = ?1, updated_at = ?2 WHERE id = ?3').bind(mechanism, now, st.client.id));
  }

  // Pièce client validée → fiche livrable (non publiée) tenue à jour avec le lien.
  if (status === 'valide' && step.deliverable) {
    const existing = await first<{ id: string; external_url: string | null }>(db,
      `SELECT id, external_url FROM deliverables WHERE client_id = ?1 AND origin = 'genere' AND json_extract(generation_json, '$.delivery_step') = ?2`,
      st.client.id, step.key);
    const gen = JSON.stringify({ delivery_step: step.key, source: 'master-prompt', mechanism });
    if (!existing) {
      stmts.push(db.prepare(
        `INSERT INTO deliverables (id, client_id, type, phase, title, status, external_url, visible_client, origin, generation_json)
         VALUES (?1, ?2, ?3, ?4, ?5, 'brouillon', ?6, 0, 'genere', ?7)`,
      ).bind(newId('dl'), st.client.id, step.deliverable.type, step.deliverable.phase, step.deliverable.title, resultUrl, gen));
    } else if (existing.external_url !== resultUrl) {
      stmts.push(db.prepare('UPDATE deliverables SET external_url = ?1, generation_json = ?2, updated_at = ?3 WHERE id = ?4')
        .bind(resultUrl, gen, now, existing.id));
    }
  }
  await db.batch(stmts);

  await audit(db, {
    clientId: st.client.id, actorId: user.id, actorEmail: user.email, action: 'delivery_etape_modifiee', objectType: 'delivery_step', objectId: id,
    before: before && { status: before.status, resultUrl: before.result_url, mechanism: st.mechanism },
    after: { step: step.key, status, resultUrl, mechanism },
  });

  const fresh = await loadState(db, st.client.id);
  return c.json({ step: serializeStep(step, fresh.byStep.get(step.key), fresh.avail(step.key)), mechanism: fresh.mechanism });
});

/** Publier au client la fiche livrable d'une étape validée (le client la voit « à relire »). */
delivery.post('/:clientId/delivery/:step/publish', async (c) => {
  const step = stepOr404(c.req.param('step'));
  if (!step.deliverable) throw new HttpError(400, 'Cette étape produit un document interne : rien à publier au client.');
  const db = c.env.DB;
  const user = c.get('user');
  const clientId = c.get('client').id;
  const row = await first<StepRow>(db, 'SELECT * FROM delivery_steps WHERE client_id = ?1 AND step = ?2', clientId, step.key);
  if (row?.status !== 'valide') throw new HttpError(409, "Validez l'étape avant de publier.");
  const d = await first<{ id: string; visible_client: number }>(db,
    `SELECT id, visible_client FROM deliverables WHERE client_id = ?1 AND origin = 'genere' AND json_extract(generation_json, '$.delivery_step') = ?2`,
    clientId, step.key);
  if (!d) throw notFound();
  if (!d.visible_client) {
    const now = nowIso();
    await run(db, `UPDATE deliverables SET visible_client = 1, status = 'a_relire', published_at = ?1, updated_at = ?1 WHERE id = ?2`, now, d.id);
    await audit(db, { clientId, actorId: user.id, actorEmail: user.email, action: 'livrable_publie', objectType: 'deliverable', objectId: d.id });
  }
  return c.json({ ok: true });
});

