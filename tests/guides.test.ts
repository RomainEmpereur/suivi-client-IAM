import { describe, expect, it } from 'vitest';
import { A, AGENCE, B, CLIENT_A, CLIENT_B, setup } from './helpers/app.ts';

describe('Guides', () => {
  it("l'agence rédige un guide en brouillon, le publie ; le client le lit et sa lecture est notée", async () => {
    const { call, raw } = setup();
    const r = await call('/agence/guides', { as: AGENCE, method: 'POST', body: { title: 'Naviguer dans GoHighLevel', bodyMd: '## Étape 1\n1. Ouvrez le CRM' } });
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as any;
    const listA = async () => ((await (await call(`/clients/${A}/guides`, { as: CLIENT_A })).json()) as any).guides;
    expect((await listA()).find((g: any) => g.id === id)).toBeUndefined();
    expect((await call(`/clients/${A}/guides/${id}`, { as: CLIENT_A })).status).toBe(404);
    expect((await call(`/agence/guides/${id}`, { as: AGENCE, method: 'PATCH', body: { published: true } })).status).toBe(200);
    expect((await listA()).find((g: any) => g.id === id)).toMatchObject({ title: 'Naviguer dans GoHighLevel', hasBody: true, readAt: null });
    const read = (await (await call(`/clients/${A}/guides/${id}`, { as: CLIENT_A })).json()) as any;
    expect(read.guide.bodyMd).toContain('Étape 1');
    expect(read.guide.published).toBeUndefined();
    expect(raw.prepare('SELECT COUNT(*) n FROM guide_reads WHERE guide_id = ? AND client_id = ?').get(id, A)).toEqual({ n: 1 });
    expect((await listA()).find((g: any) => g.id === id).readAt).toBeTruthy();
  });

  it('un guide épinglé pour un client n’est visible que par lui', async () => {
    const { call } = setup();
    const { id } = (await (await call('/agence/guides', { as: AGENCE, method: 'POST', body: { title: 'Pour Pilotis', bodyMd: 'x', clientId: B } })).json()) as any;
    await call(`/agence/guides/${id}`, { as: AGENCE, method: 'PATCH', body: { published: true } });
    expect(((await (await call(`/clients/${B}/guides`, { as: CLIENT_B })).json()) as any).guides.find((g: any) => g.id === id)).toMatchObject({ pinned: true });
    expect(((await (await call(`/clients/${A}/guides`, { as: CLIENT_A })).json()) as any).guides.find((g: any) => g.id === id)).toBeUndefined();
    expect((await call(`/clients/${A}/guides/${id}`, { as: CLIENT_A })).status).toBe(404);
  });

  it('rédaction réservée à l’agence ; entrées invalides refusées', async () => {
    const { call } = setup();
    expect((await call('/agence/guides', { as: CLIENT_A, method: 'POST', body: { title: 'x' } })).status).toBe(403);
    expect((await call('/agence/guides', { as: AGENCE, method: 'POST', body: { title: '' } })).status).toBe(400);
    expect((await call('/agence/guides', { as: AGENCE, method: 'POST', body: { title: 'x', url: 'http://x.fr' } })).status).toBe(400);
    expect((await call('/agence/guides', { as: AGENCE, method: 'POST', body: { title: 'x', clientId: 'cl_inconnu' } })).status).toBe(400);
  });
});
