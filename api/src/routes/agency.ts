import { Hono } from 'hono';
import { CHAIN_STEPS, DEFAULT_THRESHOLDS, computeAppointmentCounter, deliveryGate, safeDiv, type AppointmentLike } from '@obsidian/domain';
import type { AppEnv, ClientRow } from '../env.ts';
import { requireAgency } from '../auth.ts';
import { all, audit, first, newId, nowIso } from '../db.ts';
import { latestAlerts, storeAllAlerts } from '../alerts.ts';
import { HttpError, notFound } from '../errors.ts';
import { clientTotals, periodBounds } from '../metrics.ts';
import { currentPhaseProgress, overdueClientTasks } from './clients.ts';

export const agency = new Hono<AppEnv>();
agency.use('*', async (c, next) => { requireAgency(c); await next(); });

/** Console multi-clients (§12) : une ligne par client, triée par ce qui demande une action. */
agency.get('/console', async (c) => {
  const db = c.env.DB;
  const demoFilter = c.env.ENVIRONMENT === 'production' ? 'WHERE is_demo = 0' : '';
  const list = await all<ClientRow>(db, `SELECT * FROM clients ${demoFilter} ORDER BY name`);
  const p7 = periodBounds(7);
  const p30 = periodBounds(30);
  const today = new Date();

  const rows = await Promise.all(list.map(async (cl) => {
    const [t7, t30, appts, conns, recos, fb, overdue, phase] = await Promise.all([
      clientTotals(db, cl.id, p7.from, p7.to),
      clientTotals(db, cl.id, p30.from, p30.to),
      all<AppointmentLike>(db, 'SELECT scheduled_at, status, counts_toward_target FROM appointments WHERE client_id = ?1', cl.id),
      all<{ type: string; state: string }>(db, 'SELECT type, state FROM connections WHERE client_id = ?1', cl.id),
      all<{ n: number }>(db, `SELECT COUNT(*) AS n FROM recommendations WHERE client_id = ?1 AND state = 'ouverte'`, cl.id),
      all<{ n: number }>(db, `SELECT COUNT(*) AS n FROM feedback WHERE client_id = ?1 AND status != 'resolu'`, cl.id),
      overdueClientTasks(db, cl.id),
      currentPhaseProgress(db, cl.id),
    ]);
    const reopened = await all<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM onboarding_reopenings WHERE client_id = ?1 AND closed_at IS NULL', cl.id);
    const counter = computeAppointmentCounter(cl, appts, today);
    const broken = conns.filter((x) => x.state === 'casse').map((x) => x.type);
    const spend7 = t7?.spend_cents ?? null;
    const booked7 = t7?.appointments_booked ?? null;
    const daysSinceStart = cl.start_date ? Math.floor((today.getTime() - Date.parse(`${cl.start_date}T00:00:00Z`)) / 86_400_000) : null;
    const blockingLate = overdue.some((t) => t.blocking && Date.parse(`${t.due_date}T00:00:00Z`) < today.getTime() - 5 * 86_400_000);
    const redReasons: string[] = [];
    if (broken.length) redReasons.push('Connexion cassée');
    if (spend7 && spend7 > 0 && booked7 === 0) redReasons.push('Aucun rendez-vous depuis 7 jours, dépense en cours');
    if (blockingLate) redReasons.push('Tâche client bloquante en retard de plus de 5 jours');
    return {
      id: cl.id, name: cl.name, offer: cl.offer, status: cl.status, isDemo: Boolean(cl.is_demo),
      phase: cl.campaigns_launched_at ? 'Campagnes lancées' : phase?.label ?? null,
      daysSinceStart,
      counter: counter.started || cl.campaigns_launched_at ? { validated: counter.validated, target: counter.target, onPace: counter.onPace, daysRemaining: counter.daysRemaining } : null,
      spend7_cents: spend7,
      costPerBooked7_cents: t7 ? safeDiv(t7.spend_cents, t7.appointments_booked) : null,
      spend30_cents: t30?.spend_cents ?? null,
      booked30: t30?.appointments_booked ?? null,
      connections: conns,
      openRecos: recos[0]?.n ?? 0,
      openFeedback: fb[0]?.n ?? 0,
      overdueClientTasks: overdue.length,
      onboarding: cl.onboarding_submitted_at
        ? (reopened[0]?.n ? 'complement_demande' : 'envoye')
        : 'a_remplir',
      onboardingSubmittedAt: cl.onboarding_submitted_at ?? null,
      red: redReasons.length > 0,
      redReasons,
    };
  }));

  rows.sort((a, b) => Number(b.red) - Number(a.red)
    || (b.openFeedback + b.overdueClientTasks + b.openRecos) - (a.openFeedback + a.overdueClientTasks + a.openRecos));

  // Retours récurrents (§11) : thèmes des 7 derniers jours et retours encore ouverts, tous clients confondus.
  const ids = list.map((x) => x.id);
  const themes = ids.length ? await all<{ category: string; recent: number; open: number; clients: string }>(db,
    `SELECT f.category, SUM(f.created_at >= ?1) AS recent, SUM(f.status != 'resolu') AS open, GROUP_CONCAT(DISTINCT c.name) AS clients
     FROM feedback f JOIN clients c ON c.id = f.client_id WHERE f.client_id IN (${ids.map((_, i) => `?${i + 2}`).join(',')})
     GROUP BY f.category ORDER BY recent DESC, open DESC`, new Date(Date.now() - 7 * 86_400_000).toISOString(), ...ids) : [];
  // Boîte de réception (décision 0015) : tous les retours non résolus, les plus graves et les plus anciens d'abord.
  const inbox = ids.length ? await all<{ id: string; client_id: string; client_name: string; category: string; severity: string; status: string; body: string; attachments_json: string; created_at: string }>(db,
    `SELECT f.id, f.client_id, c.name AS client_name, f.category, f.severity, f.status, substr(f.body, 1, 240) AS body, f.attachments_json, f.created_at
     FROM feedback f JOIN clients c ON c.id = f.client_id WHERE f.status != 'resolu' AND f.client_id IN (${ids.map((_, i) => `?${i + 1}`).join(',')})
     ORDER BY CASE f.severity WHEN 'haute' THEN 0 WHEN 'normale' THEN 1 ELSE 2 END, (f.status = 'nouveau') DESC, f.created_at LIMIT 50`, ...ids) : [];
  const spend30 = rows.reduce((s, r) => s + (r.spend30_cents ?? 0), 0);
  const booked30 = rows.reduce((s, r) => s + (r.booked30 ?? 0), 0);
  return c.json({
    summary: {
      spend30_cents: rows.some((r) => r.spend30_cents !== null) ? spend30 : null,
      avgCostPerBooked30_cents: safeDiv(spend30, booked30),
      clientsBehindPace: rows.filter((r) => r.counter && !r.counter.onPace).length,
    },
    rows,
    feedbackInbox: inbox.map((f) => {
      let n = 0; try { n = (JSON.parse(f.attachments_json || '[]') as unknown[]).length; } catch { n = 0; }
      return { id: f.id, clientId: f.client_id, clientName: f.client_name, category: f.category, severity: f.severity, status: f.status, excerpt: f.body, attachments: n, createdAt: f.created_at };
    }),
    feedbackThemes: themes.filter((t) => t.recent > 0 || t.open > 0).map((t) => ({ category: t.category, recent: t.recent, open: t.open, clients: (t.clients ?? '').split(',').filter(Boolean) })),
  });
});

// ─── Guides (§11, §12 Édition) : communs ou épinglés pour un client ; brouillon / publié ─────

interface GuideRow { id: string; client_id: string | null; title: string; kind: string; url: string | null; body_md: string | null; sort_order: number; published: number; updated_at: string }
const serializeGuideAgency = (g: GuideRow & { r2_key?: string | null }) => ({
  hasFile: Boolean(g.r2_key),
  id: g.id, clientId: g.client_id, title: g.title, kind: g.kind, url: g.url, bodyMd: g.body_md, sortOrder: g.sort_order,
  published: Boolean(g.published), updatedAt: g.updated_at,
});

agency.get('/guides', async (c) => {
  const rows = await all<GuideRow>(c.env.DB, 'SELECT * FROM guides ORDER BY client_id IS NOT NULL, sort_order, title');
  return c.json({ guides: rows.map(serializeGuideAgency) });
});

function guideInput(b: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || 'title' in b) {
    const t = typeof b.title === 'string' ? b.title.trim() : '';
    if (!t || t.length > 120) throw new HttpError(400, 'Titre requis (120 caractères au plus).');
    out.title = t;
  }
  if ('bodyMd' in b) {
    if (b.bodyMd !== null && (typeof b.bodyMd !== 'string' || b.bodyMd.length > 100_000)) throw new HttpError(400, 'Contenu invalide.');
    out.body_md = (b.bodyMd as string | null)?.trim() || null;
  }
  if ('url' in b) {
    const u = typeof b.url === 'string' ? b.url.trim() : '';
    if (u) { try { if (new URL(u).protocol !== 'https:') throw 0; } catch { throw new HttpError(400, 'Lien invalide (https).'); } }
    out.url = u || null;
  }
  if ('kind' in b) {
    if (!['page', 'pdf', 'video'].includes(b.kind as string)) throw new HttpError(400, 'Type invalide.');
    out.kind = b.kind;
  }
  if ('sortOrder' in b) {
    if (!Number.isInteger(b.sortOrder)) throw new HttpError(400, 'Ordre invalide.');
    out.sort_order = b.sortOrder;
  }
  if ('clientId' in b) out.client_id = b.clientId || null;
  if ('published' in b) out.published = b.published ? 1 : 0;
  return out;
}

agency.post('/guides', async (c) => {
  const user = c.get('user');
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const v = guideInput(b, false);
  if (v.client_id && !(await first(c.env.DB, 'SELECT id FROM clients WHERE id = ?1', v.client_id))) throw new HttpError(400, 'Client inconnu.');
  const id = newId('gd');
  await c.env.DB.prepare('INSERT INTO guides (id, client_id, title, kind, url, body_md, sort_order, published) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)')
    .bind(id, v.client_id ?? null, v.title, v.kind ?? 'page', v.url ?? null, v.body_md ?? null, v.sort_order ?? 100).run();
  await audit(c.env.DB, { clientId: (v.client_id as string) ?? null, actorId: user.id, actorEmail: user.email, action: 'guide_cree', objectType: 'guide', objectId: id, after: { title: v.title } });
  return c.json({ id }, 201);
});

agency.patch('/guides/:id', async (c) => {
  const user = c.get('user');
  const g = await first<GuideRow>(c.env.DB, 'SELECT * FROM guides WHERE id = ?1', c.req.param('id'));
  if (!g) throw notFound();
  const v = guideInput(await c.req.json<Record<string, unknown>>().catch(() => ({})), true);
  if (v.client_id && !(await first(c.env.DB, 'SELECT id FROM clients WHERE id = ?1', v.client_id))) throw new HttpError(400, 'Client inconnu.');
  const keys = Object.keys(v);
  if (!keys.length) throw new HttpError(400, 'Rien à modifier.');
  await c.env.DB.prepare(`UPDATE guides SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(', ')}, updated_at = ?${keys.length + 1} WHERE id = ?${keys.length + 2}`)
    .bind(...keys.map((k) => v[k]), nowIso(), g.id).run();
  await audit(c.env.DB, { clientId: g.client_id, actorId: user.id, actorEmail: user.email, action: 'published' in v ? (v.published ? 'guide_publie' : 'guide_depublie') : 'guide_modifie', objectType: 'guide', objectId: g.id, before: { published: g.published }, after: { keys } });
  return c.json({ ok: true });
});

agency.delete('/guides/:id', async (c) => {
  const user = c.get('user');
  const g = await first<GuideRow>(c.env.DB, 'SELECT * FROM guides WHERE id = ?1', c.req.param('id'));
  if (!g) throw notFound();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE tasks SET guide_id = NULL WHERE guide_id = ?1').bind(g.id),
    c.env.DB.prepare('UPDATE connections SET guide_id = NULL WHERE guide_id = ?1').bind(g.id),
    c.env.DB.prepare('DELETE FROM guides WHERE id = ?1').bind(g.id),
  ]);
  await audit(c.env.DB, { clientId: g.client_id, actorId: user.id, actorEmail: user.email, action: 'guide_supprime', objectType: 'guide', objectId: g.id, before: { title: g.title } });
  return c.json({ ok: true });
});

// ─── Fichier PDF d'un guide (R2) ─────────────────────────────────────────────

const MAX_PDF = 30 * 1024 * 1024;

agency.put('/guides/:id/file', async (c) => {
  const user = c.get('user');
  if (!c.env.FILES) throw new HttpError(503, "Stockage de fichiers non activé (R2).");
  const g = await first<GuideRow & { r2_key: string | null }>(c.env.DB, 'SELECT * FROM guides WHERE id = ?1', c.req.param('id'));
  if (!g) throw notFound();
  const type = (c.req.header('Content-Type') ?? '').split(';')[0].trim();
  if (type !== 'application/pdf') throw new HttpError(400, 'Seuls les fichiers PDF sont acceptés.');
  const len = Number(c.req.header('Content-Length') ?? 0);
  if (len > MAX_PDF) throw new HttpError(413, 'Fichier trop lourd (30 Mo au plus).');
  const buf = await c.req.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > MAX_PDF) throw new HttpError(buf.byteLength ? 413 : 400, buf.byteLength ? 'Fichier trop lourd (30 Mo au plus).' : 'Fichier vide.');
  if (new TextDecoder().decode(new Uint8Array(buf.slice(0, 5))) !== '%PDF-') throw new HttpError(400, "Ce fichier n'est pas un PDF.");
  const name = (c.req.header('X-File-Name') ?? 'guide.pdf').replace(/[^\w.\- ]+/g, '_').slice(0, 100);
  const key = `guides/${g.id}/${Date.now()}.pdf`;
  await c.env.FILES.put(key, buf, { httpMetadata: { contentType: 'application/pdf', contentDisposition: `inline; filename="${name}"` } });
  await c.env.DB.prepare('UPDATE guides SET r2_key = ?1, updated_at = ?2 WHERE id = ?3').bind(key, nowIso(), g.id).run();
  if (g.r2_key) await c.env.FILES.delete(g.r2_key).catch(() => {});
  await audit(c.env.DB, { clientId: g.client_id, actorId: user.id, actorEmail: user.email, action: 'guide_pdf_depose', objectType: 'guide', objectId: g.id, after: { bytes: buf.byteLength } });
  return c.json({ ok: true, bytes: buf.byteLength });
});

agency.delete('/guides/:id/file', async (c) => {
  const user = c.get('user');
  const g = await first<GuideRow & { r2_key: string | null }>(c.env.DB, 'SELECT * FROM guides WHERE id = ?1', c.req.param('id'));
  if (!g) throw notFound();
  if (g.r2_key && c.env.FILES) await c.env.FILES.delete(g.r2_key).catch(() => {});
  await c.env.DB.prepare('UPDATE guides SET r2_key = NULL, updated_at = ?1 WHERE id = ?2').bind(nowIso(), g.id).run();
  await audit(c.env.DB, { clientId: g.client_id, actorId: user.id, actorEmail: user.email, action: 'guide_pdf_retire', objectType: 'guide', objectId: g.id });
  return c.json({ ok: true });
});

// ─── Alertes quotidiennes (décision 0014) ───────────────────────────────────────

agency.get('/alerts', async (c) => {
  const alerts = await latestAlerts(c.env.DB);
  const last = await first<{ at: string | null }>(c.env.DB, `SELECT MAX(created_at) AS at FROM alerts WHERE run_date IS NOT NULL`);
  return c.json({ alerts, computedAt: last?.at ?? null });
});

agency.post('/alerts/run', async (c) => {
  const r = await storeAllAlerts(c.env.DB, c.env.ENVIRONMENT === 'production');
  const user = c.get('user');
  await audit(c.env.DB, { clientId: null, actorId: user.id, actorEmail: user.email, action: 'alertes_calcul', objectType: 'alerts', after: r });
  return c.json({ ok: true, ...r });
});

// ─── Édition des clients (§12, décision 0014) ───────────────────────────────────

const STATUSES = ['prospect', 'onboarding', 'build', 'actif', 'pause', 'termine'] as const;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const THRESHOLD_KEYS = Object.keys(DEFAULT_THRESHOLDS) as (keyof typeof DEFAULT_THRESHOLDS)[];

function editableClient(cl: ClientRow) {
  let thresholds: Record<string, unknown> = {};
  try { thresholds = JSON.parse(cl.thresholds_json || '{}'); } catch { thresholds = {}; }
  return {
    id: cl.id, name: cl.name, slug: cl.slug, status: cl.status, offer: cl.offer, startDate: cl.start_date,
    campaignsLaunchedAt: cl.campaigns_launched_at, driveFolderUrl: cl.drive_folder_url ?? null, masterTrackerUrl: cl.master_tracker_url ?? null, verticalsEnabled: Boolean(cl.verticals_enabled),
    adAccountCurrency: cl.ad_account_currency, adAccountTimezone: cl.ad_account_timezone,
    autoPublishRecos: Boolean(cl.auto_publish_recos), isDemo: Boolean(cl.is_demo),
    thresholds, defaultThresholds: DEFAULT_THRESHOLDS,
  };
}

/** Valide et normalise les champs envoyés ; ne renvoie que ceux présents dans le corps. */
function parseClientFields(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  const str = (k: string, col: string, max: number, nullable = true) => {
    if (!(k in body)) return;
    const v = body[k];
    if (v == null || v === '') { if (!nullable) throw new HttpError(400, `${k} requis.`); out[col] = null; return; }
    if (typeof v !== 'string' || v.trim().length > max) throw new HttpError(400, `${k} invalide.`);
    out[col] = v.trim();
  };
  str('name', 'name', 120, false);
  str('offer', 'offer', 200);
  if ('status' in body) {
    if (!STATUSES.includes(body.status as never)) throw new HttpError(400, 'Statut invalide.');
    out.status = body.status;
  }
  for (const [k, col] of [['startDate', 'start_date'], ['campaignsLaunchedAt', 'campaigns_launched_at']] as const) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v == null || v === '') { out[col] = null; continue; }
    if (typeof v !== 'string' || !YMD.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new HttpError(400, `${k} invalide (AAAA-MM-JJ).`);
    out[col] = v;
  }
  if ('driveFolderUrl' in body) {
    const v = body.driveFolderUrl;
    if (v == null || v === '') out.drive_folder_url = null;
    else if (typeof v !== 'string' || !/^https:\/\/[^\s]+$/.test(v.trim()) || v.length > 500) throw new HttpError(400, 'Lien du dossier invalide (https).');
    else out.drive_folder_url = v.trim();
  }
  if ('masterTrackerUrl' in body) {
    const v = body.masterTrackerUrl;
    if (v == null || v === '') out.master_tracker_url = null;
    else if (typeof v !== 'string' || !/^https:\/\/[^\s]+$/.test(v.trim()) || v.length > 500) throw new HttpError(400, 'Lien du master tracker invalide (https).');
    else out.master_tracker_url = v.trim();
  }
  if ('adAccountCurrency' in body) {
    if (typeof body.adAccountCurrency !== 'string' || !/^[A-Z]{3}$/.test(body.adAccountCurrency)) throw new HttpError(400, 'Devise invalide (ex. EUR).');
    out.ad_account_currency = body.adAccountCurrency;
  }
  if ('adAccountTimezone' in body) {
    const tz = body.adAccountTimezone;
    try { if (typeof tz !== 'string') throw new Error(); new Intl.DateTimeFormat('fr-FR', { timeZone: tz }); } catch { throw new HttpError(400, 'Fuseau invalide (ex. Europe/Paris).'); }
    out.ad_account_timezone = tz;
  }
  if ('autoPublishRecos' in body) out.auto_publish_recos = body.autoPublishRecos ? 1 : 0;
  if ('verticalsEnabled' in body) out.verticals_enabled = body.verticalsEnabled ? 1 : 0;
  if ('thresholds' in body) {
    const t = body.thresholds;
    if (t == null || typeof t !== 'object' || Array.isArray(t)) throw new HttpError(400, 'Seuils invalides.');
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(t as Record<string, unknown>)) {
      if (!THRESHOLD_KEYS.includes(k as never)) throw new HttpError(400, `Seuil inconnu : ${k}.`);
      if (v == null || v === '') continue; // valeur par défaut
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e9) throw new HttpError(400, `Seuil ${k} invalide.`);
      clean[k] = v;
    }
    out.thresholds_json = JSON.stringify(clean);
  }
  return out;
}

const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'client';

agency.get('/clients/:id', async (c) => {
  const cl = await first<ClientRow>(c.env.DB, 'SELECT * FROM clients WHERE id = ?1', c.req.param('id'));
  if (!cl || (c.env.ENVIRONMENT === 'production' && cl.is_demo)) throw notFound();
  return c.json({ client: editableClient(cl) });
});

agency.post('/clients', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const fields = parseClientFields(body);
  if (!fields.name) throw new HttpError(400, 'Nom du client requis.');
  const base = slugify(String(fields.name));
  let slug = base;
  for (let i = 2; await first(c.env.DB, 'SELECT 1 FROM clients WHERE slug = ?1', slug); i++) slug = `${base}-${i}`;
  const id = `cl_${slug.replace(/-/g, '_')}`;
  if (await first(c.env.DB, 'SELECT 1 FROM clients WHERE id = ?1', id)) throw new HttpError(409, 'Un client porte déjà cet identifiant.');
  const cols = { status: 'onboarding', ...fields, id, slug, is_demo: 0,
    // Aucune source branchée à la création : ces mesures s'affichent « — » avec leur raison, jamais 0.
    unmeasured_json: JSON.stringify(['crm_contacts', 'appointments_booked', 'appointments_held', 'sales', 'cash_collected_cents']) };
  const keys = Object.keys(cols);
  await c.env.DB.prepare(`INSERT INTO clients (${keys.join(', ')}) VALUES (${keys.map((_, i) => `?${i + 1}`).join(', ')})`)
    .bind(...keys.map((k) => (cols as Record<string, unknown>)[k])).run();
  const user = c.get('user');
  await audit(c.env.DB, { clientId: id, actorId: user.id, actorEmail: user.email, action: 'client_creation', objectType: 'client', objectId: id, after: cols });
  const cl = await first<ClientRow>(c.env.DB, 'SELECT * FROM clients WHERE id = ?1', id);
  return c.json({ client: editableClient(cl!) }, 201);
});

agency.patch('/clients/:id', async (c) => {
  const cl = await first<ClientRow>(c.env.DB, 'SELECT * FROM clients WHERE id = ?1', c.req.param('id'));
  if (!cl || (c.env.ENVIRONMENT === 'production' && cl.is_demo)) throw notFound();
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const fields = parseClientFields(body);
  const keys = Object.keys(fields).filter((k) => (cl as unknown as Record<string, unknown>)[k] !== fields[k]);
  if (!keys.length) return c.json({ client: editableClient(cl) });
  const now = nowIso();
  await c.env.DB.prepare(`UPDATE clients SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(', ')}, updated_at = ?${keys.length + 1} WHERE id = ?${keys.length + 2}`)
    .bind(...keys.map((k) => fields[k]), now, cl.id).run();
  const user = c.get('user');
  // Avant / après pour chaque champ modifié, seuils compris (§12).
  await audit(c.env.DB, {
    clientId: cl.id, actorId: user.id, actorEmail: user.email, action: keys.includes('thresholds_json') ? 'client_seuils_modification' : 'client_modification',
    objectType: 'client', objectId: cl.id,
    before: Object.fromEntries(keys.map((k) => [k, (cl as unknown as Record<string, unknown>)[k]])),
    after: Object.fromEntries(keys.map((k) => [k, fields[k]])),
  });
  const updated = await first<ClientRow>(c.env.DB, 'SELECT * FROM clients WHERE id = ?1', cl.id);
  return c.json({ client: editableClient(updated!) });
});

agency.get('/clients/:id/alerts', async (c) => {
  const alerts = await latestAlerts(c.env.DB, [c.req.param('id')]);
  return c.json({ alerts });
});

// ─── Parcours nouveau client (décision 0020) ────────────────────────────────────

/** Liste de contrôle de la fiche client : ce qui est fait, ce qui reste, et où le faire. Calculée, jamais saisie. */
agency.get('/clients/:id/parcours', async (c) => {
  const db = c.env.DB;
  const cl = await first<ClientRow & { onboarding_submitted_at: string | null }>(db, 'SELECT * FROM clients WHERE id = ?1', c.req.param('id'));
  if (!cl || (c.env.ENVIRONMENT === 'production' && cl.is_demo)) throw notFound();
  const [users, answers, assets, steps, conns, published] = await Promise.all([
    all<{ email: string; last_login_at: string | null }>(db, 'SELECT email, last_login_at FROM users WHERE client_id = ?1 ORDER BY email', cl.id),
    all<{ question_key: string; answer: string | null }>(db, 'SELECT question_key, answer FROM onboarding_answers WHERE client_id = ?1', cl.id),
    first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM onboarding_assets WHERE client_id = ?1', cl.id),
    all<{ step: string; status: string; content_md: string | null; result_url: string | null; queued_at: string | null }>(db,
      `SELECT step, status, content_md, result_url, queued_at FROM delivery_steps WHERE client_id = ?1 AND instr(step, '@') = 0`, cl.id),
    all<{ type: string; state: string }>(db, 'SELECT type, state FROM connections WHERE client_id = ?1', cl.id),
    first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM deliverables WHERE client_id = ?1 AND visible_client = 1', cl.id),
  ]);
  const gate = deliveryGate(cl.onboarding_submitted_at ?? null, Object.fromEntries(answers.map((a) => [a.question_key, a.answer])));
  const byStep = new Map(steps.map((s) => [s.step, s]));
  const chain = CHAIN_STEPS.filter((k) => k !== 's9');
  const written = chain.filter((k) => byStep.get(k)?.content_md?.trim() || byStep.get(k)?.result_url).length;
  const validated = chain.filter((k) => byStep.get(k)?.status === 'valide').length;
  const queued = steps.filter((s) => s.queued_at).length;
  const conn = (t: string) => conns.find((x) => x.type === t)?.state ?? null;
  const base = `/c/${cl.id}`;
  const STATE: Record<string, string> = { ok: 'opérationnelle', degrade: 'dégradée', casse: 'en erreur', non_configure: 'non configurée' };
  const items = [
    { key: 'fiche', label: 'Fiche client créée', done: true, detail: `Statut : ${cl.status}`, href: `/agence/clients/${cl.id}` },
    { key: 'drive', label: 'Dossier Drive renseigné', done: Boolean(cl.drive_folder_url), detail: cl.drive_folder_url ? 'Lien enregistré dans la fiche' : 'Collez le lien du dossier dans la fiche (créé par la tâche planifiée ou à la main)', href: `/agence/clients/${cl.id}` },
    { key: 'tracker', label: 'Master tracker créé', done: Boolean(cl.master_tracker_url), detail: cl.master_tracker_url ? 'Lien enregistré dans la fiche' : 'Collez le lien du Google Sheet « Client - Master tracker » dans la fiche', href: `/agence/clients/${cl.id}` },
    { key: 'acces', label: 'Accès client donné', done: users.length > 0,
      detail: users.length ? users.map((u) => `${u.email}${u.last_login_at ? ' (connecté)' : ' (jamais connecté)'}`).join(', ') : 'Ajout manuel : compte dans la base et email dans Cloudflare Access', href: null },
    { key: 'onboarding', label: 'Onboarding envoyé par le client', done: Boolean(cl.onboarding_submitted_at),
      detail: cl.onboarding_submitted_at ? (gate.ok ? 'Infos de base complètes' : `Manque : ${gate.missing.join(' · ')}`) : `${answers.filter((a) => a.answer?.trim()).length} réponses enregistrées, pas encore envoyé`, href: `${base}/onboarding` },
    { key: 'ressources', label: 'Ressources reçues (logo, captures, témoignages)', done: (assets?.n ?? 0) > 0, optional: true,
      detail: (assets?.n ?? 0) > 0 ? `${assets!.n} ressource${assets!.n > 1 ? 's' : ''} dans l'espace` : 'Aucune dans l\'espace (elles peuvent être dans le Drive)', href: `${base}/onboarding` },
    { key: 'delivery', label: 'Delivery rédigé', done: written === chain.length,
      detail: `${written}/${chain.length} étapes rédigées${queued ? ` · ${queued} en file` : ''}${!gate.ok ? ' · lancement bloqué tant que l\'onboarding est incomplet' : ''}`, href: `${base}/delivery` },
    { key: 'validation', label: 'Delivery validé par l\'agence', done: validated === chain.length, detail: `${validated}/${chain.length} étapes validées`, href: `${base}/delivery` },
    { key: 'meta', label: 'Connexion Meta opérationnelle', done: conn('meta') === 'ok', detail: conn('meta') ? `Connexion ${STATE[conn('meta')!] ?? conn('meta')}` : 'Jeton et compte publicitaire à saisir', href: `${base}/connexions` },
    { key: 'ghl', label: 'Connexion GoHighLevel opérationnelle', done: conn('ghl') === 'ok', detail: conn('ghl') ? `Connexion ${STATE[conn('ghl')!] ?? conn('ghl')}` : 'Jeton et sous-compte à saisir', href: `${base}/connexions` },
    { key: 'tracking', label: 'Tracking et connexions vérifiés (étape 9)', done: byStep.get('s9')?.status === 'valide', detail: byStep.get('s9')?.status === 'valide' ? 'Étape 9 validée' : 'Pixel, champs GHL et vérification à valider', href: `${base}/delivery` },
    { key: 'livrables', label: 'Livrables publiés pour le client', done: (published?.n ?? 0) > 0, detail: `${published?.n ?? 0} livrable${(published?.n ?? 0) > 1 ? 's' : ''} visible${(published?.n ?? 0) > 1 ? 's' : ''}`, href: `${base}/infrastructure` },
    { key: 'lancement', label: 'Campagnes lancées', done: Boolean(cl.campaigns_launched_at), detail: cl.campaigns_launched_at ? `Depuis le ${cl.campaigns_launched_at}` : 'Date de lancement à saisir dans la fiche', href: `/agence/clients/${cl.id}` },
  ];
  const required = items.filter((i) => !('optional' in i && i.optional));
  return c.json({ items, done: required.filter((i) => i.done).length, total: required.length, next: required.find((i) => !i.done)?.key ?? null });
});
