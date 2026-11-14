import { describe, expect, it } from 'vitest';
import { AGENCE, CLIENT_A, A, setup } from './helpers/app.ts';

const day = (offset: number) => new Date(Date.now() + offset * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

describe("Tâches de l'agence", () => {
  it('vue agence seule ; tri par échéance, retard, faite / à refaire, suppression', async () => {
    const { call } = setup();
    expect((await call('/agence/taches', { as: CLIENT_A })).status).toBe(403);
    expect((await call('/agence/taches', { as: CLIENT_A, method: 'POST', body: { title: 'x' } })).status).toBe(403);
    expect((await call('/agence/taches', { as: AGENCE, method: 'POST', body: { title: '' } })).status).toBe(400);
    expect((await call('/agence/taches', { as: AGENCE, method: 'POST', body: { title: 'x', dueDate: '14/11/2026' } })).status).toBe(400);
    expect((await call('/agence/taches', { as: AGENCE, method: 'POST', body: { title: 'x', clientId: 'cl_inconnu' } })).status).toBe(400);
    const mk = async (body: Record<string, unknown>) => ((await (await call('/agence/taches', { as: AGENCE, method: 'POST', body })).json()) as any).id as string;
    const late = await mk({ title: 'Relancer le pixel', clientId: A, dueDate: day(-2), description: 'Le pixel ne remonte plus.' });
    const later = await mk({ title: 'Préparer le rapport', clientId: A, dueDate: day(5) });
    const today = await mk({ title: 'Appeler le client', clientId: A, dueDate: day(0) });
    const none = await mk({ title: 'Mettre à jour les guides' });
    let d = (await (await call('/agence/taches', { as: AGENCE })).json()) as any;
    expect(d.items.map((t: any) => t.id)).toEqual([late, today, later, none]);
    expect(d.items[0]).toMatchObject({ overdue: true, clientName: 'Nordline CRM (démo)', description: 'Le pixel ne remonte plus.' });
    expect(d.items[3]).toMatchObject({ clientId: null, dueDate: null, overdue: false });
    expect(d.counts).toEqual({ open: 4, overdue: 1, today: 1 });
    expect(((await (await call('/agence/taches/compteur', { as: AGENCE })).json()) as any).urgent).toBe(2);
    // Filtre par client et « agence ».
    expect(((await (await call(`/agence/taches?clientId=${A}`, { as: AGENCE })).json()) as any).items).toHaveLength(3);
    expect(((await (await call('/agence/taches?clientId=agence', { as: AGENCE })).json()) as any).items.map((t: any) => t.id)).toEqual([none]);
    // Faite, puis remise à faire ; modification ; suppression.
    await call(`/agence/taches/${late}`, { as: AGENCE, method: 'PATCH', body: { status: 'fait' } });
    d = (await (await call('/agence/taches', { as: AGENCE })).json()) as any;
    expect(d.items.at(-1)).toMatchObject({ id: late, status: 'fait', overdue: false });
    expect(d.items.at(-1).doneAt).toBeTruthy();
    await call(`/agence/taches/${late}`, { as: AGENCE, method: 'PATCH', body: { status: 'a_faire', title: 'Relancer le pixel (2)', dueDate: null } });
    d = (await (await call('/agence/taches', { as: AGENCE })).json()) as any;
    expect(d.items.find((t: any) => t.id === late)).toMatchObject({ title: 'Relancer le pixel (2)', dueDate: null, doneAt: null });
    expect((await call(`/agence/taches/${later}`, { as: AGENCE, method: 'DELETE' })).status).toBe(200);
    expect((await call(`/agence/taches/${later}`, { as: AGENCE, method: 'PATCH', body: { title: 'y' } })).status).toBe(404);
  });
});
