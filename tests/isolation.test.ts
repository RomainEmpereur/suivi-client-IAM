import { describe, expect, it } from 'vitest';
import { A, AGENCE, B, CLIENT_A, CLIENT_B, setup } from './helpers/app.ts';

/** §4, §16 : l'isolation est vérifiée côté serveur à chaque requête. */
describe('Isolation entre clients', () => {
  const { call } = setup();
  const paths = ['', '/dashboard', '/appointments', '/infrastructure', '/connections', '/recommendations', '/guides'];

  it.each(paths)('un client de A qui demande B%s reçoit une erreur, pas les données', async (p) => {
    const res = await call(`/clients/${B}${p}`, { as: CLIENT_A });
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain('Pilotis');
  });

  it.each(paths)('un client de A accède à ses propres données%s', async (p) => {
    const res = await call(`/clients/${A}${p}`, { as: CLIENT_A });
    expect(res.status).toBe(200);
  });

  it("un identifiant inexistant donne la même réponse qu'un client étranger", async () => {
    const res = await call('/clients/cl_inexistant', { as: CLIENT_A });
    expect(res.status).toBe(404);
  });

  it("un client ne peut pas s'élever en agence via les en-têtes", async () => {
    const res = await call('/agence/console', { as: CLIENT_B, headers: { 'X-View': 'agence' } });
    expect(res.status).toBe(403);
  });

  it('sans identité : 401 ; adresse inconnue : 403', async () => {
    expect((await call(`/clients/${A}`)).status).toBe(401);
    expect((await call(`/clients/${A}`, { as: 'inconnu@example.com' })).status).toBe(403);
  });

  it("l'agence voit tous les clients", async () => {
    expect((await call(`/clients/${A}`, { as: AGENCE })).status).toBe(200);
    expect((await call(`/clients/${B}`, { as: AGENCE })).status).toBe(200);
    const me = await (await call('/me', { as: AGENCE })).json() as { clients: unknown[] };
    expect(me.clients).toHaveLength(2);
  });

  it('un client ne liste que son propre client', async () => {
    const me = await (await call('/me', { as: CLIENT_A })).json() as { clients: { id: string }[] };
    expect(me.clients.map((c) => c.id)).toEqual([A]);
  });

  it("un client ne peut pas cocher une tâche d'un autre client", async () => {
    const res = await call(`/clients/${B}/tasks/tk_${B}_4`, { as: CLIENT_A, method: 'PATCH', body: { status: 'fait' } });
    expect(res.status).toBe(404);
  });

  it('un client ne peut pas cocher une tâche de l’agence, mais peut cocher la sienne', async () => {
    expect((await call(`/clients/${B}/tasks/tk_${B}_3`, { as: CLIENT_B, method: 'PATCH', body: { status: 'fait' } })).status).toBe(403);
    expect((await call(`/clients/${B}/tasks/tk_${B}_4`, { as: CLIENT_B, method: 'PATCH', body: { status: 'fait' } })).status).toBe(200);
  });
});

describe('Visibilité des brouillons et vue client', () => {
  const { call } = setup();

  it("un livrable non publié s'affiche « en préparation » et rien d'autre côté client", async () => {
    const res = await call(`/clients/${B}/infrastructure`, { as: CLIENT_B });
    const json = await res.json() as { deliverables: Record<string, unknown>[] };
    const landing = json.deliverables.find((d) => d.id === `dl_${B}_landing`)!;
    expect(landing.status).toBe('en_preparation');
    expect(landing).not.toHaveProperty('externalUrl');
    expect(landing).not.toHaveProperty('clientSummary');
    expect(JSON.stringify(json)).not.toContain('brouillon-interne');
  });

  it("l'agence en vue client voit exactement la même chose que le client", async () => {
    const asClient = await (await call(`/clients/${B}/infrastructure`, { as: CLIENT_B })).json() as { deliverables: unknown };
    const asAgencyClientView = await (await call(`/clients/${B}/infrastructure`, { as: AGENCE, view: 'client' })).json() as { deliverables: unknown };
    expect(asAgencyClientView.deliverables).toEqual(asClient.deliverables);
  });

  it('la vue client est en lecture seule, même pour l’agence', async () => {
    const res = await call(`/clients/${B}/deliverables/dl_${B}_landing/publish`, { as: AGENCE, view: 'client', method: 'POST', body: { confirm: true } });
    expect(res.status).toBe(403);
  });

  it('les recommandations non publiées et les notes internes ne sortent pas côté client', async () => {
    const json = await (await call(`/clients/${A}/recommendations`, { as: CLIENT_A })).json() as { recommendations: Record<string, unknown>[] };
    expect(json.recommendations.map((r) => r.id)).not.toContain(`rc_${A}_3`);
    expect(JSON.stringify(json)).not.toContain('Le hook douleur ne passe pas');
    expect(json.recommendations.find((r) => r.id === `rc_${A}_1`)!.title).toBe('Nous arrêtons la publicité « Hook douleur »');
  });

  it('les guides en brouillon ne sont pas visibles du client', async () => {
    const c = await (await call(`/clients/${A}/guides`, { as: CLIENT_A })).json() as { guides: { id: string }[] };
    const a = await (await call(`/clients/${A}/guides`, { as: AGENCE })).json() as { guides: { id: string }[] };
    expect(c.guides.map((g) => g.id)).not.toContain('gd_demo_facture');
    expect(a.guides.map((g) => g.id)).toContain('gd_demo_facture');
  });

  it('publier exige une confirmation explicite et se journalise', async () => {
    const { call: call2, raw } = setup();
    expect((await call2(`/clients/${B}/deliverables/dl_${B}_landing/publish`, { as: AGENCE, method: 'POST', body: {} })).status).toBe(400);
    expect((await call2(`/clients/${B}/deliverables/dl_${B}_landing/publish`, { as: AGENCE, method: 'POST', body: { confirm: true } })).status).toBe(200);
    const after = await (await call2(`/clients/${B}/infrastructure`, { as: CLIENT_B })).json() as { deliverables: Record<string, unknown>[] };
    expect(after.deliverables.find((d) => d.id === `dl_${B}_landing`)!.status).toBe('a_relire');
    const log = raw.prepare(`SELECT action FROM audit_log WHERE object_id = ?`).all(`dl_${B}_landing`);
    expect(log).toHaveLength(1);
  });
});

describe('Secrets', () => {
  it('aucun jeton ne sort, même en vue agence', async () => {
    const { call, raw } = setup();
    raw.prepare(`UPDATE connections SET token_ciphertext = 'CHIFFRE-SECRET-123' WHERE client_id = ?`).run(A);
    for (const as of [AGENCE, CLIENT_A]) {
      const text = await (await call(`/clients/${A}/connections`, { as })).text();
      expect(text).not.toContain('CHIFFRE-SECRET-123');
      expect(text).not.toContain('token_ciphertext');
    }
    const agency = await (await call(`/clients/${A}/connections`, { as: AGENCE })).json() as { connections: { tokenConfigured: boolean }[] };
    expect(agency.connections.every((c) => c.tokenConfigured)).toBe(true);
  });
});

describe('Production', () => {
  it("refuse l'identité de développement et les données de démonstration", async () => {
    const { call } = setup({ ENVIRONMENT: 'production', DEV_AUTH: '1', ACCESS_TEAM_DOMAIN: 'x.cloudflareaccess.com', ACCESS_AUD: 'aud' });
    expect((await call(`/clients/${A}`, { as: AGENCE })).status).toBe(401);
    expect((await call('/dev/users')).status).toBe(404);
  });
});
