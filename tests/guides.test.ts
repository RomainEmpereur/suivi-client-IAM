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

/** Faux R2 en mémoire (put / get / delete). */
function fakeR2() {
  const m = new Map<string, { body: ArrayBuffer; meta: any }>();
  return {
    map: m,
    put: async (k: string, v: ArrayBuffer, o: any) => { m.set(k, { body: v, meta: o?.httpMetadata }); },
    get: async (k: string) => { const x = m.get(k); return x ? { body: new Blob([x.body]).stream(), httpMetadata: x.meta } : null; },
    delete: async (k: string) => { m.delete(k); },
  };
}
const pdf = new TextEncoder().encode('%PDF-1.4\n% faux PDF de test\n%%EOF');

describe('Guides : PDF (R2)', () => {
  it("l'agence joint un PDF ; le client publié le télécharge ; un brouillon reste inaccessible", async () => {
    const r2 = fakeR2();
    const { call, env } = setup();
    (env as any).FILES = r2;
    const { id } = (await (await call('/agence/guides', { as: AGENCE, method: 'POST', body: { title: 'Setup Meta' } })).json()) as any;
    // Envoi brut : la fonction call de test ne gère que le JSON, on passe par app.request directement.
    const send = async (body: Uint8Array, type: string) => (await import('../api/src/index.ts')).default.request(`/api/agence/guides/${id}/file`,
      { method: 'PUT', headers: { 'X-Dev-User': AGENCE, 'Content-Type': type, 'X-File-Name': 'setup.pdf' }, body }, env);
    expect((await send(new TextEncoder().encode('pas un pdf'), 'application/pdf')).status).toBe(400);
    expect((await send(pdf, 'image/png')).status).toBe(400);
    expect((await send(pdf, 'application/pdf')).status).toBe(200);
    expect(r2.map.size).toBe(1);
    expect((await call(`/clients/${A}/guides/${id}/file`, { as: CLIENT_A })).status).toBe(404); // brouillon
    await call(`/agence/guides/${id}`, { as: AGENCE, method: 'PATCH', body: { published: true } });
    const dl = await call(`/clients/${A}/guides/${id}/file`, { as: CLIENT_A });
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toBe('application/pdf');
    expect(new TextDecoder().decode(new Uint8Array(await dl.arrayBuffer()))).toContain('%PDF-1.4');
    // Remplacement : l'ancien fichier est supprimé.
    expect((await send(pdf, 'application/pdf')).status).toBe(200);
    expect(r2.map.size).toBe(1);
    expect((await call(`/agence/guides/${id}/file`, { as: AGENCE, method: 'DELETE' })).status).toBe(200);
    expect(r2.map.size).toBe(0);
    expect((await call(`/clients/${A}/guides/${id}/file`, { as: CLIENT_A })).status).toBe(404);
  });

  it('sans R2 activé, le dépôt répond clairement', async () => {
    const { env } = setup();
    const { default: app } = await import('../api/src/index.ts');
    const r = await app.request('/api/agence/guides', { method: 'POST', headers: { 'X-Dev-User': AGENCE, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x' }) }, env);
    const { id } = (await r.json()) as any;
    const up = await app.request(`/api/agence/guides/${id}/file`, { method: 'PUT', headers: { 'X-Dev-User': AGENCE, 'Content-Type': 'application/pdf' }, body: pdf }, env);
    expect(up.status).toBe(503);
  });
});
