import { Hono } from 'hono';
import { computeAppointmentCounter, safeDiv, type AppointmentLike } from '@obsidian/domain';
import type { AppEnv, ClientRow } from '../env.ts';
import { requireAgency } from '../auth.ts';
import { all } from '../db.ts';
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

  const spend30 = rows.reduce((s, r) => s + (r.spend30_cents ?? 0), 0);
  const booked30 = rows.reduce((s, r) => s + (r.booked30 ?? 0), 0);
  return c.json({
    summary: {
      spend30_cents: rows.some((r) => r.spend30_cents !== null) ? spend30 : null,
      avgCostPerBooked30_cents: safeDiv(spend30, booked30),
      clientsBehindPace: rows.filter((r) => r.counter && !r.counter.onPace).length,
    },
    rows,
  });
});
