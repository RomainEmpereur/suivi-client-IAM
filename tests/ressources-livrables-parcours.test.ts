import { describe, expect, it } from 'vitest';
import app from '../api/src/index.ts';
import { A, AGENCE, B, CLIENT_A, CLIENT_B, setup } from './helpers/app.ts';

const fakeR2 = () => {
  const m = new Map<string, { body: ArrayBuffer; meta: any }>();
  return { map: m,
    put: async (k: string, v: ArrayBuffer, o: any) => { m.set(k, { body: v, meta: o?.httpMetadata }); },
    get: async (k: string) => { const x = m.get(k); return x ? { body: new Blob([x.body]).stream(), httpMetadata: x.meta } : null; },
    delete: async (k: string) => { m.delete(k); } };
};
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('Ressources d’onboarding', () => {
  it('le client dépose un fichier vérifié et un lien ; l’agence les voit ; un autre client non', async () => {
    const { call, env } = setup();
    const r2 = fakeR2();
    (env as any).FILES = r2;
    const send = (as: string, body: Uint8Array, type: string, client = A, q = 'type=logo&description=version%20claire') =>
      app.request(`/api/clients/${client}/resources/file?${q}`, { method: 'PUT', headers: { 'X-Dev-User': as, 'Content-Type': type, 'X-File-Name': encodeURIComponent('logo clair.png') }, body }, env);
    expect((await send(CLIENT_A, new TextEncoder().encode('pas une image'), 'image/png')).status).toBe(400);
    expect((await send(CLIENT_A, png, 'text/html')).status).toBe(400);
    expect((await send(CLIENT_A, png, 'image/png', A, 'type=inconnu')).status).toBe(400);
    expect((await send(CLIENT_B, png, 'image/png', A)).status).toBe(404);
    expect((await send(CLIENT_A, png, 'image/png')).status).toBe(201);
    expect(r2.map.size).toBe(1);
    expect((await call(`/clients/${A}/resources/link`, { as: AGENCE, method: 'POST', body: { type: 'temoignage', url: 'http://pas-https.fr' } })).status).toBe(400);
    expect((await call(`/clients/${A}/resources/link`, { as: AGENCE, method: 'POST', body: { type: 'temoignage', url: 'https://drive.google.com/x' } })).status).toBe(201);
    const list = (await (await call(`/clients/${A}/resources`, { as: CLIENT_A })).json()) as any;
    expect(list.resources).toHaveLength(2);
    const file = list.resources.find((r: any) => r.isFile);
    expect(file).toMatchObject({ type: 'logo', fileName: 'logo clair.png', description: 'version claire', createdBy: 'client' });
    expect(JSON.stringify(list)).not.toContain('onboarding/'); // la clé R2 ne sort pas
    const dl = await call(file.url.replace('/api', ''), { as: AGENCE });
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toBe('image/png');
    expect((await call(file.url.replace('/api', '').replace(A, B), { as: CLIENT_B })).status).toBe(404);
    // Le client ne supprime pas ce que l'agence a ajouté ; il supprime le sien (et le fichier part de R2).
    const link = list.resources.find((r: any) => !r.isFile);
    expect((await call(`/clients/${A}/resources/${link.id}`, { as: CLIENT_A, method: 'DELETE' })).status).toBe(403);
    expect((await call(`/clients/${A}/resources/${file.id}`, { as: CLIENT_A, method: 'DELETE' })).status).toBe(200);
    expect(r2.map.size).toBe(0);
    // L'agence en vue client est en lecture seule.
    expect((await call(`/clients/${A}/resources/${link.id}`, { as: AGENCE, view: 'client', method: 'DELETE' })).status).toBe(403);
  });
});

describe('Livrables : édition agence et commentaires', () => {
  it('l’agence ajoute un livrable, le client le commente une fois publié, l’agence répond', async () => {
    const { call } = setup();
    const create = await call(`/clients/${A}/deliverables`, { as: AGENCE, method: 'POST', body: { type: 'offre', title: 'Offre de trafic froid', externalUrl: 'https://drive.google.com/a', visible: false } });
    expect(create.status).toBe(201);
    const { id } = (await create.json()) as any;
    expect((await call(`/clients/${A}/deliverables`, { as: CLIENT_A, method: 'POST', body: { type: 'offre', title: 'x', externalUrl: 'https://a.fr' } })).status).toBe(403);
    // Non publié : le client ne peut ni lire ni commenter.
    expect((await call(`/clients/${A}/deliverables/${id}/comments`, { as: CLIENT_A, method: 'POST', body: { body: 'Question' } })).status).toBe(404);
    expect((await call(`/clients/${A}/deliverables/${id}`, { as: AGENCE, method: 'PATCH', body: { visible: true, status: 'valide' } })).status).toBe(200);
    expect((await call(`/clients/${A}/deliverables/${id}/comments`, { as: CLIENT_A, method: 'POST', body: { body: 'Peut-on changer la promesse ?' } })).status).toBe(201);
    expect((await call(`/clients/${A}/deliverables/${id}/comments`, { as: AGENCE, method: 'POST', body: { body: 'Oui, version 2 demain.' } })).status).toBe(201);
    expect((await call(`/clients/${A}/deliverables/${id}/comments`, { as: CLIENT_B })).status).toBe(404);
    const thread = (await (await call(`/clients/${A}/deliverables/${id}/comments`, { as: CLIENT_A })).json()) as any;
    expect(thread.comments.map((k: any) => [k.authorRole, k.author === 'Obsidian Partners'])).toEqual([['client', false], ['agence', true]]);
    // Le client ne supprime pas la réponse de l'agence.
    const agencyComment = thread.comments[1];
    expect((await call(`/clients/${A}/deliverables/${id}/comments/${agencyComment.id}`, { as: CLIENT_A, method: 'DELETE' })).status).toBe(403);
    // Lien modifié sur un livrable publié : version suivante, « mis à jour ».
    expect((await call(`/clients/${A}/deliverables/${id}`, { as: CLIENT_A, method: 'PATCH', body: { title: 'x' } })).status).toBe(403);
    await call(`/clients/${A}/deliverables/${id}`, { as: AGENCE, method: 'PATCH', body: { externalUrl: 'https://drive.google.com/b' } });
    const infra = (await (await call(`/clients/${A}/infrastructure`, { as: CLIENT_A })).json()) as any;
    expect(infra.deliverables.find((d: any) => d.id === id)).toMatchObject({ status: 'mis_a_jour', version: 2, comments: 2, externalUrl: 'https://drive.google.com/b' });
    expect((await call(`/clients/${A}/deliverables/${id}`, { as: AGENCE, method: 'DELETE' })).status).toBe(200);
    expect((await call(`/clients/${A}/deliverables/${id}/comments`, { as: AGENCE })).status).toBe(404);
  });
});

describe('Parcours nouveau client', () => {
  it('liste ce qui est fait et ce qui reste, réservée à l’agence', async () => {
    const { call } = setup();
    expect((await call(`/agence/clients/${A}/parcours`, { as: CLIENT_A })).status).toBe(403);
    const r = await call('/agence/clients', { as: AGENCE, method: 'POST', body: { name: 'Nouveau SaaS' } });
    const { client } = (await r.json()) as any;
    const p = (await (await call(`/agence/clients/${client.id}/parcours`, { as: AGENCE })).json()) as any;
    expect(p.items[0]).toMatchObject({ key: 'fiche', done: true });
    expect(p.next).toBe('drive');
    expect(p.done).toBe(1);
    await call(`/agence/clients/${client.id}`, { as: AGENCE, method: 'PATCH', body: { driveFolderUrl: 'https://drive.google.com/x', masterTrackerUrl: 'https://docs.google.com/spreadsheets/d/x' } });
    const p2 = (await (await call(`/agence/clients/${client.id}/parcours`, { as: AGENCE })).json()) as any;
    expect(p2.next).toBe('acces');
    expect(p2.done).toBe(3);
    expect(p2.items.find((i: any) => i.key === 'ressources').optional).toBe(true);
  });
});

describe('Demandes clients', () => {
  it('un commentaire client reste à traiter jusqu’à la réponse de l’agence ou son marquage', async () => {
    const { call } = setup();
    const { id } = (await (await call(`/clients/${A}/deliverables`, { as: AGENCE, method: 'POST', body: { type: 'offre', title: 'Offre', externalUrl: 'https://drive.google.com/a', visible: true } })).json()) as any;
    const count = async () => ((await (await call('/agence/demandes/compteur', { as: AGENCE })).json()) as any).comments;
    const base = await count();
    await call(`/clients/${A}/deliverables/${id}/comments`, { as: CLIENT_A, method: 'POST', body: { body: 'Urgent : la promesse est fausse.' } });
    expect(await count()).toBe(base + 1);
    expect((await call('/agence/demandes', { as: CLIENT_A })).status).toBe(403);
    const list = (await (await call('/agence/demandes', { as: AGENCE })).json()) as any;
    expect(list.comments.find((r: any) => r.deliverableId === id)).toMatchObject({ pending: 1, lastBody: 'Urgent : la promesse est fausse.' });
    const agencyCard = ((await (await call(`/clients/${A}/infrastructure`, { as: AGENCE })).json()) as any).deliverables.find((d: any) => d.id === id);
    expect(agencyCard.pendingClientComments).toBe(1);
    const clientCard = ((await (await call(`/clients/${A}/infrastructure`, { as: CLIENT_A })).json()) as any).deliverables.find((d: any) => d.id === id);
    expect(clientCard.pendingClientComments).toBeUndefined();
    // La réponse de l'agence traite la demande.
    await call(`/clients/${A}/deliverables/${id}/comments`, { as: AGENCE, method: 'POST', body: { body: 'Corrigé.' } });
    expect(await count()).toBe(base);
    // Nouveau commentaire, traité sans réponse.
    await call(`/clients/${A}/deliverables/${id}/comments`, { as: CLIENT_A, method: 'POST', body: { body: 'Merci !' } });
    expect(await count()).toBe(base + 1);
    expect((await call(`/agence/demandes/livrables/${id}/traiter`, { as: AGENCE, method: 'POST' })).status).toBe(200);
    expect(await count()).toBe(base);
    const after = (await (await call('/agence/demandes', { as: AGENCE })).json()) as any;
    expect(after.handled.find((h: any) => h.deliverableId === id)).toMatchObject({ count: 2 });
  });
});
