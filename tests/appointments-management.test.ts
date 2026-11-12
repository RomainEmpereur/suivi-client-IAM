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

  it('le client pose le statut (décision 0014) mais ne peut pas exclure ; la vue client agence est en lecture seule ; un autre client reçoit 404', async () => {
    const { call, raw } = setup();
    const { id } = firstMissing(raw, A);
    expect((await call(`/clients/${A}/appointments/${id}`, { as: AGENCE, view: 'client', method: 'PATCH', body: { status: 'honore' } })).status).toBe(403);
    expect((await call(`/clients/${A}/appointments/${id}`, { as: CLIENT_A, method: 'PATCH', body: { countsTowardTarget: false, exclusionReason: 'x' } })).status).toBe(403);
    expect((await call(`/clients/${A}/appointments/${id}`, { as: CLIENT_A, method: 'PATCH', body: { status: 'honore' } })).status).toBe(200);
    expect((raw.prepare('SELECT status, status_source FROM appointments WHERE id = ?').get(id) as any)).toMatchObject({ status: 'honore', status_source: 'client' });
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

describe('Rendez-vous saisis à la main : comptés dans les chiffres', () => {
  it('un rendez-vous ajouté par le client apparaît dans les rendez-vous pris, puis tenus ; la synchro GHL ne les efface pas', async () => {
    const { setup, B, CLIENT_B, AGENCE } = await import('./helpers/app.ts');
    const { call, raw } = setup();
    raw.prepare(`UPDATE clients SET unmeasured_json = '["appointments_booked","appointments_held"]' WHERE id = ?`).run(B);
    const past = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const r = await call(`/clients/${B}/appointments`, { as: CLIENT_B, method: 'POST', body: { contactName: 'Prospect hors CRM', scheduledAt: past } });
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as any;
    const row = () => raw.prepare(`SELECT appointments_booked b, appointments_held h, source FROM metrics_daily WHERE client_id = ? AND ad_id = 'saisie_manuelle'`).get(B) as any;
    expect(row()).toMatchObject({ b: 1, h: 0, source: 'manuel' });
    expect(JSON.parse((raw.prepare('SELECT unmeasured_json u FROM clients WHERE id = ?').get(B) as any).u)).toEqual([]);
    await call(`/clients/${B}/appointments/${id}`, { as: AGENCE, method: 'PATCH', body: { status: 'honore' } });
    expect(row()).toMatchObject({ b: 1, h: 1 });
    const rollup = raw.prepare(`SELECT SUM(appointments_booked) b FROM metrics_rollup WHERE client_id = ? AND level = 'campaign' AND entity_id = 'saisie_manuelle'`).get(B) as any;
    expect(rollup.b).toBe(1);
  });
});

describe('Vérification des leads du CRM à la saisie', () => {
  it('recherche par nom ; un rendez-vous saisi rattaché à un lead qui a déjà son RDV GHL n’est pas compté deux fois', async () => {
    const { setup, B, CLIENT_B, CLIENT_A, A } = await import('./helpers/app.ts');
    const { call, raw } = setup();
    raw.prepare(`INSERT INTO crm_leads (client_id, opportunity_id, contact_id, name, company, stage_name, entered_at) VALUES (?, 'o1', 'ct1', 'Sophie Guillet', 'Boutique Garance', 'R1 / Démo planifiée', '2026-11-08T10:00:00Z'), (?, 'o2', 'ct2', 'Linda Sanquer', 'Balaruc', 'Nouveau Lead Meta', '2026-11-09T10:00:00Z')`).run(B, B);
    const s = (await (await call(`/clients/${B}/crm-leads?q=garance`, { as: CLIENT_B })).json()) as any;
    expect(s.leads).toEqual([expect.objectContaining({ contactId: 'ct1', name: 'Sophie Guillet', stage: 'R1 / Démo planifiée' })]);
    expect(((await (await call(`/clients/${B}/crm-leads?q=inconnu`, { as: CLIENT_B })).json()) as any)).toMatchObject({ leads: [], crmSynced: true });
    expect((await call(`/clients/${B}/crm-leads?q=sophie`, { as: CLIENT_A })).status).toBe(404);
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect((await call(`/clients/${B}/appointments`, { as: CLIENT_B, method: 'POST', body: { contactName: 'Sophie Guillet', scheduledAt: past, ghlContactId: 'ct_inexistant' } })).status).toBe(400);
    expect((await call(`/clients/${B}/appointments`, { as: CLIENT_B, method: 'POST', body: { contactName: 'Sophie Guillet', scheduledAt: past, ghlContactId: 'ct1' } })).status).toBe(201);
    const manual = () => (raw.prepare(`SELECT appointments_booked b FROM metrics_daily WHERE client_id = ? AND ad_id = 'saisie_manuelle'`).get(B) as any)?.b ?? 0;
    expect(manual()).toBe(1);
    // La synchro GHL rapporte ensuite son propre rendez-vous pour ce contact : la saisie n'est plus comptée.
    raw.prepare(`INSERT INTO appointments (id, client_id, ghl_appointment_id, contact_name, booked_at, scheduled_at, status, origin, ghl_contact_id) VALUES ('ap_g1', ?, 'g1', 'Sophie Guillet', ?, ?, 'prevu', 'ghl', 'ct1')`).run(B, past, past);
    // Recalcul déclenché par un nouvel ajout sans rattachement.
    await call(`/clients/${B}/appointments`, { as: CLIENT_B, method: 'POST', body: { contactName: 'Autre prospect', scheduledAt: past } });
    expect(manual()).toBe(1);
    void A;
  });
});
