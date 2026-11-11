import { Hono } from 'hono';
import {
  ALL_QUESTIONS, ONBOARDING_SECTIONS, QUESTION_BY_KEY, missingRequired, unitEconomicsFromAnswers, validateAnswer,
} from '@obsidian/domain';
import type { AppEnv, ClientRow } from '../env.ts';
import { requireAgency } from '../auth.ts';
import { scopeClient } from '../scope.ts';
import { all, audit, first, newId, nowIso, run } from '../db.ts';
import { HttpError, forbidden, notFound } from '../errors.ts';

/**
 * Onboarding (§7).
 * - Le client remplit et modifie tant que le formulaire n'est pas verrouillé.
 * - À l'envoi, tout passe en lecture seule. L'agence peut rouvrir UNE section précise, avec un message.
 * - Chaque modification garde son historique ; celles faites après la première soumission sont signalées à l'agence.
 * - L'agence lit, relance, rouvre : elle ne répond pas à la place du client.
 */
export const onboarding = new Hono<AppEnv>();
onboarding.use('/:clientId/onboarding', scopeClient);
onboarding.use('/:clientId/onboarding/*', scopeClient);

interface AnswerRow { id: string; question_key: string; answer: string | null; updated_at: string; status: string }
interface ReopenRow { id: string; section: string; question_key: string | null; message: string; created_at: string }
interface HistoryRow { answer_id: string; previous_answer: string | null; new_answer: string | null; created_at: string }

async function openReopenings(db: D1Database, clientId: string) {
  return all<ReopenRow>(db, 'SELECT id, section, question_key, message, created_at FROM onboarding_reopenings WHERE client_id = ?1 AND closed_at IS NULL ORDER BY created_at', clientId);
}

/** Sections modifiables par le client en ce moment. */
function editableSections(client: ClientRow & { onboarding_submitted_at?: string | null }, reopen: ReopenRow[]): string[] {
  if (!client.onboarding_locked) return ONBOARDING_SECTIONS.map((s) => s.key);
  return [...new Set(reopen.map((r) => r.section))];
}

async function loadClient(db: D1Database, id: string) {
  return (await first<ClientRow & { onboarding_submitted_at: string | null }>(db, 'SELECT * FROM clients WHERE id = ?1', id))!;
}

onboarding.get('/:clientId/onboarding', async (c) => {
  const db = c.env.DB;
  const client = await loadClient(db, c.get('client').id);
  const view = c.get('view');
  const [answers, reopen] = await Promise.all([
    all<AnswerRow>(db, 'SELECT id, question_key, answer, updated_at, status FROM onboarding_answers WHERE client_id = ?1', client.id),
    openReopenings(db, client.id),
  ]);

  // Vue agence : ce qui a changé après la première soumission (pour faire revoir les livrables).
  let changes: Record<string, { previous: string | null; at: string }> = {};
  if (view === 'agence' && client.onboarding_submitted_at) {
    const hist = await all<HistoryRow>(db,
      `SELECT answer_id, previous_answer, new_answer, created_at FROM onboarding_answer_history
       WHERE client_id = ?1 AND after_production_start = 1 ORDER BY created_at`, client.id);
    const byId = new Map(answers.map((a) => [a.id, a.question_key]));
    for (const h of hist) {
      const key = byId.get(h.answer_id);
      if (!key) continue;
      // On garde la valeur d'avant la PREMIÈRE modification post-soumission.
      if (!changes[key]) changes[key] = { previous: h.previous_answer, at: h.created_at };
      else changes[key].at = h.created_at;
    }
  }

  return c.json({
    locked: Boolean(client.onboarding_locked),
    submittedAt: client.onboarding_submitted_at,
    editableSections: view === 'client' && c.get('user').role === 'client' ? editableSections(client, reopen) : [],
    reopenings: reopen.map((r) => ({ id: r.id, section: r.section, questionKey: r.question_key, message: r.message, createdAt: r.created_at })),
    answers: Object.fromEntries(answers.map((a) => [a.question_key, { value: a.answer, updatedAt: a.updated_at }])),
    ...(view === 'agence' ? { changesAfterSubmit: changes } : {}),
  });
});

/** Sauvegarde automatique d'une réponse (un champ à la fois). Client uniquement. */
onboarding.put('/:clientId/onboarding/answers/:questionKey', async (c) => {
  const user = c.get('user');
  if (user.role !== 'client') throw forbidden("L'agence ne répond pas à la place du client : rouvrez une section pour demander un complément.");
  const db = c.env.DB;
  const client = await loadClient(db, c.get('client').id);
  const question = QUESTION_BY_KEY.get(c.req.param('questionKey'));
  if (!question) throw notFound();

  const reopen = await openReopenings(db, client.id);
  if (!editableSections(client, reopen).includes(question.section)) {
    throw forbidden('Le formulaire est envoyé : cette section est en lecture seule.');
  }
  const body = await c.req.json<{ value?: unknown }>().catch(() => ({} as { value?: unknown }));
  if (typeof body.value !== 'string') throw new HttpError(400, 'Réponse invalide.');
  const value = body.value;
  const err = validateAnswer(question, value);
  if (err) throw new HttpError(400, err);

  const existing = await first<AnswerRow>(db, 'SELECT id, question_key, answer, updated_at, status FROM onboarding_answers WHERE client_id = ?1 AND question_key = ?2', client.id, question.key);
  if (existing && existing.answer === value) return c.json({ ok: true, updatedAt: existing.updated_at });

  const now = nowIso();
  const id = existing?.id ?? newId('oa');
  if (existing) {
    await run(db, 'UPDATE onboarding_answers SET answer = ?1, question_text = ?2, author_user_id = ?3, updated_at = ?4 WHERE id = ?5 AND client_id = ?6',
      value, question.label, user.id, now, id, client.id);
  } else {
    await run(db, `INSERT INTO onboarding_answers (id, client_id, section, question_key, question_text, answer, author_user_id, status)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      id, client.id, question.section, question.key, question.label, value, user.id, client.onboarding_submitted_at ? 'soumis' : 'brouillon');
  }
  await run(db, `INSERT INTO onboarding_answer_history (id, client_id, answer_id, previous_answer, new_answer, author_user_id, after_production_start)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    newId('oh'), client.id, id, existing?.answer ?? null, value, user.id, client.onboarding_submitted_at ? 1 : 0);

  if (question.unitEconomics) await syncUnitEconomics(db, client);
  return c.json({ ok: true, updatedAt: now });
});

/** Envoi du formulaire (ou d'une section rouverte). Client uniquement. */
onboarding.post('/:clientId/onboarding/submit', async (c) => {
  const user = c.get('user');
  if (user.role !== 'client') throw forbidden();
  const db = c.env.DB;
  const client = await loadClient(db, c.get('client').id);
  const reopen = await openReopenings(db, client.id);
  const scope = editableSections(client, reopen);
  if (scope.length === 0) throw new HttpError(409, 'Le formulaire est déjà envoyé.');

  const rows = await all<AnswerRow>(db, 'SELECT id, question_key, answer, updated_at, status FROM onboarding_answers WHERE client_id = ?1', client.id);
  const answers = Object.fromEntries(rows.map((r) => [r.question_key, r.answer]));
  const missing = missingRequired(answers, scope);
  if (missing.length) {
    return c.json({ error: `${missing.length} question${missing.length > 1 ? 's' : ''} obligatoire${missing.length > 1 ? 's' : ''} sans réponse.`, missing: missing.map((m) => m.key) }, 400);
  }

  const now = nowIso();
  await run(db, `UPDATE clients SET onboarding_locked = 1, onboarding_submitted_at = COALESCE(onboarding_submitted_at, ?1), updated_at = ?1 WHERE id = ?2`, now, client.id);
  await run(db, `UPDATE onboarding_answers SET status = 'soumis', updated_at = updated_at WHERE client_id = ?1`, client.id);
  await run(db, 'UPDATE onboarding_reopenings SET closed_at = ?1, updated_at = ?1 WHERE client_id = ?2 AND closed_at IS NULL', now, client.id);
  // Pas d'email en v1 (§19) : la notification à l'agence passe par la console et le journal.
  await audit(db, {
    clientId: client.id, actorId: user.id, actorEmail: user.email,
    action: client.onboarding_submitted_at ? 'onboarding_complement_envoye' : 'onboarding_soumis', objectType: 'onboarding',
    after: { sections: scope },
  });
  return c.json({ ok: true });
});

/** Réouverture d'une section précise pour complément. Agence uniquement. */
onboarding.post('/:clientId/onboarding/reopen', async (c) => {
  requireAgency(c);
  const db = c.env.DB;
  const client = await loadClient(db, c.get('client').id);
  const user = c.get('user');
  const body = await c.req.json<{ section?: string; questionKey?: string | null; message?: string }>().catch(() => ({} as Record<string, never>));
  const section = ONBOARDING_SECTIONS.find((s) => s.key === body.section);
  if (!section) throw new HttpError(400, 'Section inconnue.');
  if (body.questionKey && QUESTION_BY_KEY.get(body.questionKey)?.section !== section.key) throw new HttpError(400, 'Question inconnue dans cette section.');
  const message = (body.message ?? '').trim();
  if (!message) throw new HttpError(400, 'Un message explicite est requis pour le client.');
  if (!client.onboarding_locked) throw new HttpError(409, "Le formulaire n'est pas encore envoyé : il est déjà modifiable.");

  const id = newId('or');
  await run(db, 'INSERT INTO onboarding_reopenings (id, client_id, section, question_key, message) VALUES (?1, ?2, ?3, ?4, ?5)',
    id, client.id, section.key, body.questionKey ?? null, message);
  await audit(db, { clientId: client.id, actorId: user.id, actorEmail: user.email, action: 'onboarding_section_rouverte', objectType: 'onboarding', objectId: id, after: { section: section.key, questionKey: body.questionKey ?? null, message } });
  return c.json({ ok: true, id });
});

/** Les chiffres unitaires alimentent clients.unit_economics_json (le plafond se calcule à partir de là, §14). */
async function syncUnitEconomics(db: D1Database, client: ClientRow) {
  const rows = await all<{ question_key: string; answer: string | null }>(db,
    `SELECT question_key, answer FROM onboarding_answers WHERE client_id = ?1 AND question_key IN (${ALL_QUESTIONS.filter((x) => x.unitEconomics).map((x) => `'${x.key}'`).join(',')})`, client.id);
  let current: Record<string, unknown> = {};
  try { current = JSON.parse(client.unit_economics_json || '{}'); } catch { current = {}; }
  const fromAnswers = unitEconomicsFromAnswers(Object.fromEntries(rows.map((r) => [r.question_key, r.answer])));
  // La part acceptable est fixée par l'agence : on la conserve.
  const next = { ...current, ...fromAnswers };
  await run(db, 'UPDATE clients SET unit_economics_json = ?1, updated_at = ?2 WHERE id = ?3', JSON.stringify(next), nowIso(), client.id);
}
