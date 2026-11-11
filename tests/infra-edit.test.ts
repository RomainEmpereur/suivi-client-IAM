import { describe, expect, it } from 'vitest';
import { A, AGENCE, B, CLIENT_A, CLIENT_B, setup } from './helpers/app.ts';

const infra = async (call: any, client: string, as: string) => (await (await call(`/clients/${client}/infrastructure`, { as })).json()) as any;

describe('Édition des tâches (agence)', () => {
  it('crée, modifie (statut, phase, échéance, bloquante) puis supprime une tâche, avec journal', async () => {
    const { call, raw } = setup();
    const res = await call(`/clients/${B}/tasks`, { as: AGENCE, method: 'POST', body: { label: 'Tourner la VSL', owner: 'client', phase: 'vsl', dueDate: '2026-12-01' } });
    expect(res.status).toBe(201);
    const { id } = await res.json() as any;
    expect((await call(`/clients/${B}/tasks/${id}`, { as: AGENCE, method: 'PATCH', body: { status: 'bloque', blocking: true, owner: 'agence', label: 'Tourner et monter la VSL' } })).status).toBe(200);
    const t = (await infra(call, B, AGENCE)).tasks.agence.find((x: any) => x.id === id);
    expect(t).toMatchObject({ label: 'Tourner et monter la VSL', status: 'bloque', blocking: true, phase: 'vsl', dueDate: '2026-12-01' });
    expect((await call(`/clients/${B}/tasks/${id}`, { as: AGENCE, method: 'DELETE' })).status).toBe(200);
    expect((await infra(call, B, AGENCE)).tasks.agence.find((x: any) => x.id === id)).toBeUndefined();
    const actions = raw.prepare(`SELECT action FROM audit_log WHERE object_id = ? ORDER BY created_at`).all(id).map((r: any) => r.action);
    expect(actions).toEqual(['tache_creee', 'tache_modifiee', 'tache_supprimee']);
  });

  it('refuse les valeurs invalides', async () => {
    const { call } = setup();
    expect((await call(`/clients/${B}/tasks`, { as: AGENCE, method: 'POST', body: { label: '', owner: 'agence' } })).status).toBe(400);
    expect((await call(`/clients/${B}/tasks`, { as: AGENCE, method: 'POST', body: { label: 'x', owner: 'autre' } })).status).toBe(400);
    expect((await call(`/clients/${B}/tasks`, { as: AGENCE, method: 'POST', body: { label: 'x', owner: 'agence', phase: 'inconnue' } })).status).toBe(400);
    expect((await call(`/clients/${B}/tasks/tk_${B}_1`, { as: AGENCE, method: 'PATCH', body: { dueDate: '12/01/2026' } })).status).toBe(400);
  });

  it('le client ne crée, ne renomme ni ne supprime rien ; il coche seulement ses tâches', async () => {
    const { call } = setup();
    expect((await call(`/clients/${B}/tasks`, { as: CLIENT_B, method: 'POST', body: { label: 'x', owner: 'client' } })).status).toBe(403);
    expect((await call(`/clients/${B}/tasks/tk_${B}_4`, { as: CLIENT_B, method: 'PATCH', body: { label: 'renommée' } })).status).toBe(400);
    expect((await call(`/clients/${B}/tasks/tk_${B}_4`, { as: CLIENT_B, method: 'PATCH', body: { status: 'bloque' } })).status).toBe(400);
    expect((await call(`/clients/${B}/tasks/tk_${B}_4`, { as: CLIENT_B, method: 'DELETE' })).status).toBe(403);
    expect((await call(`/clients/${B}/tasks/tk_${B}_4`, { as: CLIENT_B, method: 'PATCH', body: { status: 'fait' } })).status).toBe(200);
  });

  it('vue client en lecture seule, et aucune action sur un autre client', async () => {
    const { call } = setup();
    expect((await call(`/clients/${B}/tasks`, { as: AGENCE, view: 'client', method: 'POST', body: { label: 'x', owner: 'agence' } })).status).toBe(403);
    expect((await call(`/clients/${B}/tasks/tk_${B}_1`, { as: CLIENT_A, method: 'PATCH', body: { status: 'fait' } })).status).toBe(404);
    expect((await call(`/clients/${A}/tasks/tk_${B}_1`, { as: AGENCE, method: 'DELETE' })).status).toBe(404);
  });
});

describe('Édition des phases (agence)', () => {
  it("change l'état, la date et le blocage d'une phase, avec journal", async () => {
    const { call, raw } = setup();
    expect((await call(`/clients/${B}/phases/landing`, { as: AGENCE, method: 'PATCH', body: { state: 'livre', startedAt: '2026-11-01', blocker: null } })).status).toBe(200);
    const p = (await infra(call, B, CLIENT_B)).phases.find((x: any) => x.key === 'landing');
    expect(p).toMatchObject({ state: 'livre', startedAt: '2026-11-01', blocker: null });
    expect(raw.prepare(`SELECT COUNT(*) n FROM audit_log WHERE action = 'phase_modifiee'`).get()).toEqual({ n: 1 });
  });
  it('refusé au client, état invalide refusé, phase inconnue introuvable', async () => {
    const { call } = setup();
    expect((await call(`/clients/${B}/phases/landing`, { as: CLIENT_B, method: 'PATCH', body: { state: 'valide' } })).status).toBe(403);
    expect((await call(`/clients/${B}/phases/landing`, { as: AGENCE, method: 'PATCH', body: { state: 'termine' } })).status).toBe(400);
    expect((await call(`/clients/${B}/phases/xyz`, { as: AGENCE, method: 'PATCH', body: { state: 'valide' } })).status).toBe(404);
  });
});
