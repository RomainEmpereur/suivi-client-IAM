import { describe, expect, it } from 'vitest';
import { A, AGENCE, B, CLIENT_A, CLIENT_B, setup } from './helpers/app.ts';

const firstMissing = (raw: any, client: string) =>
  raw.prepare(`SELECT id FROM appointments WHERE client_id = ? AND status = 'prevu' AND scheduled_at < ? ORDER BY scheduled_at LIMIT 1`)
    .get(client, new Date().toISOString()) as { id: string };

describe('Gestion des rendez-vous', () => {
  it("l'agence passe un rendez-vous en honoré : le compteur augmente et c'est journalisé", async () => {
    const { call, raw } = setup();
    const before = await (await call(`/clients/${A}/appointments`, { as: AGENCE })).json() as any;
    const { id } = firstMissing(raw, A);
    expect((await call(`/clients/${A}/appointments/${id}`, { as: AGENCE, method: 'PATCH', body: { status: 'honore' } })).status).toBe(200);
    const after = await (await call(`/clients/${A}/appointments`, { as: AGENCE })).json() as any;
    expect(after.counter.validated).toBe(before.counter.validated + 1);
    const row = raw.prepare('SELECT status_source FROM appointments WHERE id = ?').get(id) as any;
    expect(row.status_source).toBe('agence');
    const log = raw.prepare(`SELECT before_json, after_json FROM audit_log WHERE action = 'rdv_statut' AND object_id = ?`).get(id) as any;
    expect(JSON.parse(log.before_json).status).toBe('prevu');
    expect(JSON.parse(log.after_json).status).toBe('honore');
  });

  it('exclure du compteur exige un motif', async () => {
    const { call, raw } = setup();
    const { id } = firstMissing(raw, A);
    expect((await call(`/clients/${A}/appointments/${id}`, { as: AGENCE, method: 'PATCH', body: { countsTowardTarget: false } })).status).toBe(400);
    expect((await call(`/clients/${A}/appointments/${id}`, { as: AGENCE, method: 'PATCH', body: { countsTowardTarget: false, exclusionReason: 'Hors cible' } })).status).toBe(200);
  });

  it('un rendez-vous futur ne peut pas être honoré', async () => {
    const { call, raw } = setup();
    const future = raw.prepare(`SELECT id FROM appointments WHERE client_id = ? AND scheduled_at > ? LIMIT 1`).get(A, new Date().toISOString()) as any;
    expect((await call(`/clients/${A}/appointments/${future.id}`, { as: AGENCE, method: 'PATCH', body: { status: 'honore' } })).status).toBe(400);
  });

  it('le client ne pose pas de statut ; la vue client est en lecture seule ; un autre client reçoit 404', async () => {
    const { call, raw } = setup();
    const { id } = firstMissing(raw, A);
    expect((await call(`/clients/${A}/appointments/${id}`, { as: CLIENT_A, method: 'PATCH', body: { status: 'honore' } })).status).toBe(403);
    expect((await call(`/clients/${A}/appointments/${id}`, { as: AGENCE, view: 'client', method: 'PATCH', body: { status: 'honore' } })).status).toBe(403);
    expect((await call(`/clients/${A}/appointments/${id}`, { as: CLIENT_B, method: 'PATCH', body: { status: 'honore' } })).status).toBe(404);
    expect((await call(`/clients/${B}/appointments/${id}`, { as: AGENCE, method: 'PATCH', body: { status: 'honore' } })).status).toBe(404);
  });

  it('le client ajoute un rendez-vous : il naît « prévu », saisi, et ne compte pas encore', async () => {
    const { call, raw } = setup();
    const before = await (await call(`/clients/${A}/appointments`, { as: CLIENT_A })).json() as any;
    const res = await call(`/clients/${A}/appointments`, { as: CLIENT_A, method: 'POST', body: { contactName: 'Jeanne D.', scheduledAt: '2026-11-20T10:00:00+01:00' } });
    expect(res.status).toBe(201);
    const after = await (await call(`/clients/${A}/appointments`, { as: CLIENT_A })).json() as any;
    expect(after.appointments).toHaveLength(before.appointments.length + 1);
    const added = after.appointments.find((x: any) => x.contact_name === 'Jeanne D.');
    expect(added).toMatchObject({ status: 'prevu', origin: 'saisie', status_source: 'client' });
    expect(after.counter.validated).toBe(before.counter.validated);
    expect((await call(`/clients/${A}/appointments`, { as: CLIENT_A, method: 'POST', body: { contactName: '', scheduledAt: 'x' } })).status).toBe(400);
    expect((await call(`/clients/${B}/appointments`, { as: CLIENT_A, method: 'POST', body: { contactName: 'X', scheduledAt: '2026-11-20T10:00:00Z' } })).status).toBe(404);
  });
});
