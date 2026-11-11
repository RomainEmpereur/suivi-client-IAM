import { describe, expect, it } from 'vitest';
import { A, AGENCE, B, C, CLIENT_B, setup } from './helpers/app.ts';

const get = async (call: any, client: string) => (await (await call(`/clients/${client}/delivery`, { as: AGENCE })).json()) as any;
const patch = (call: any, client: string, step: string, body: unknown, as = AGENCE) =>
  call(`/clients/${client}/delivery/${step}`, { as, method: 'PATCH', body });
const URL_ = 'https://docs.google.com/document/d/x';

async function validateUpTo(call: any, steps: string[]) {
  for (const s of steps) {
    const body: any = { status: 'valide', resultUrl: `${URL_}-${s}` };
    if (s === 's1c') body.mechanism = 'La Méthode Pilote';
    const r = await patch(call, B, s, body);
    expect(r.status, s).toBe(200);
  }
}

describe('Delivery : conditions de lancement', () => {
  it("bloque tout tant que l'onboarding n'est pas envoyé, et liste ce qui manque", async () => {
    const { call } = setup();
    const d = await get(call, C);
    expect(d.gate.ok).toBe(false);
    expect(d.gate.missing).toContain("Formulaire d'onboarding envoyé");
    expect(d.steps.every((s: any) => !s.available)).toBe(true);
    expect((await call(`/clients/${C}/delivery/s0/brief`, { as: AGENCE })).status).toBe(409);
    expect((await patch(call, C, 's0', { status: 'en_cours' })).status).toBe(409);
  });

  it("ouvre l'étape 0 seulement quand onboarding et infos de base sont là", async () => {
    const { call, raw } = setup();
    let d = await get(call, B);
    expect(d.gate).toEqual({ ok: true, missing: [] });
    expect(d.steps.map((s: any) => s.available)).toEqual([true, false, false, false, false, false, false, false, false, false, false]);
    raw.prepare(`UPDATE onboarding_answers SET answer = '' WHERE client_id = ? AND question_key = 'q33'`).run(B);
    d = await get(call, B);
    expect(d.gate).toEqual({ ok: false, missing: ['Concurrents cités'] });
  });
});

describe('Delivery : enchaînement des étapes', () => {
  it('chaque étape attend la validation de la précédente, et la VSL attend le mécanisme', async () => {
    const { call } = setup();
    expect((await patch(call, B, 's1a', { status: 'en_cours' })).status).toBe(409);
    await validateUpTo(call, ['s0', 's1a', 's1b']);
    // 1C sans mécanisme : refusée.
    expect((await patch(call, B, 's1c', { status: 'valide', resultUrl: URL_ })).status).toBe(400);
    await validateUpTo(call, ['s1c']);
    const d = await get(call, B);
    expect(d.mechanism).toBe('La Méthode Pilote');
    expect(d.steps.find((s: any) => s.key === 's2').available).toBe(true);
    // Le mécanisme se verrouille dès que la VSL démarre.
    expect((await patch(call, B, 's2', { status: 'en_cours' })).status).toBe(200);
    expect((await patch(call, B, 's1c', { mechanism: 'Autre nom' })).status).toBe(409);
    // On ne revient pas sur 1C tant que la VSL a démarré.
    expect((await patch(call, B, 's1c', { status: 'a_valider' })).status).toBe(409);
  });

  it('valider exige un lien https ; le point hebdomadaire ne se valide pas', async () => {
    const { call } = setup();
    expect((await patch(call, B, 's0', { status: 'valide' })).status).toBe(400);
    expect((await patch(call, B, 's0', { status: 'valide', resultUrl: 'http://x.fr' })).status).toBe(400);
    expect((await patch(call, B, 's0', { status: 'valide', resultUrl: 'javascript:alert(1)' })).status).toBe(400);
    expect((await patch(call, B, 'zz', { status: 'valide' })).status).toBe(404);
    await validateUpTo(call, ['s0', 's1a', 's1b', 's1c', 's2', 's3', 's4', 's5', 's6', 's7']);
    expect((await patch(call, B, 's8', { status: 'valide', resultUrl: URL_ })).status).toBe(400);
    expect((await call(`/clients/${B}/delivery/s8/brief`, { as: AGENCE })).status).toBe(200);
  });

  it('une pièce client validée crée une fiche livrable non publiée, que le client ne voit pas avant publication', async () => {
    const { call, raw } = setup();
    await validateUpTo(call, ['s0', 's1a', 's1b', 's1c']);
    const d = raw.prepare(`SELECT * FROM deliverables WHERE client_id = ? AND origin = 'genere'`).all(B) as any[];
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ type: 'offre', visible_client: 0, external_url: `${URL_}-s1c` });
    // Documents internes (0, 1A, 1B) : aucune fiche.
    expect(raw.prepare(`SELECT COUNT(*) n FROM audit_log WHERE action = 'delivery_etape_modifiee'`).get()).toEqual({ n: 4 });
    const infra = async () => (await (await call(`/clients/${B}/infrastructure`, { as: CLIENT_B })).json()) as any;
    const seen = (await infra()).deliverables.find((x: any) => x.id === d[0].id);
    expect(seen ? seen.externalUrl : undefined).toBeUndefined();
    expect((await call(`/clients/${B}/delivery/s1c/publish`, { as: AGENCE, method: 'POST' })).status).toBe(200);
    expect((await call(`/clients/${B}/delivery/s1b/publish`, { as: AGENCE, method: 'POST' })).status).toBe(400);
    const after = (await infra()).deliverables.find((x: any) => x.id === d[0].id);
    expect(after).toMatchObject({ status: 'a_relire', externalUrl: `${URL_}-s1c`, published: true });
  });
});

describe('Delivery : brief', () => {
  it("contient les consignes de l'étape, le dossier client et les livrables validés en amont", async () => {
    const { call } = setup();
    await validateUpTo(call, ['s0', 's1a', 's1b', 's1c']);
    const { text } = await (await call(`/clients/${B}/delivery/s2/brief`, { as: AGENCE })).json() as any;
    expect(text).toContain('Étape 2 · La VSL');
    expect(text).toContain('La Méthode Pilote');
    expect(text).toContain(`${URL_}-s1b`);
    expect(text).toContain('Pilotis RH — logiciel de gestion des entretiens');
    expect(text).toContain('Les 8 blocs');
    expect(text).not.toContain('Étape 3 — La landing page');
  });

  it('master prompt complet disponible pour le projet Claude (agence seulement)', async () => {
    const { call } = setup();
    const r = await call('/delivery/master-prompt', { as: AGENCE });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).text.length).toBeGreaterThan(10000);
    expect((await call('/delivery/master-prompt', { as: CLIENT_B })).status).toBe(403);
  });
});

describe('Delivery : accès', () => {
  it('refusé au client et à la vue client ; un autre client est introuvable', async () => {
    const { call } = setup();
    expect((await call(`/clients/${B}/delivery`, { as: CLIENT_B })).status).toBe(403);
    expect((await call(`/clients/${B}/delivery`, { as: AGENCE, view: 'client' })).status).toBe(403);
    expect((await call(`/clients/${B}/delivery/s0/brief`, { as: CLIENT_B })).status).toBe(403);
    expect((await patch(call, B, 's0', { status: 'en_cours' }, CLIENT_B)).status).toBe(403);
    expect((await call(`/clients/${A}/delivery`, { as: CLIENT_B })).status).toBe(404);
  });
});
