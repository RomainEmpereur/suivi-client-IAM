import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken } from '../api/src/crypto.ts';
import { A, AGENCE, CLIENT_A, setup } from './helpers/app.ts';

const testKey = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

describe('Chiffrement des jetons', () => {
  it('chiffre et déchiffre ; le chiffré ne contient pas le jeton ; une autre clé échoue', async () => {
    const k = testKey();
    const c = await encryptToken('pit-jeton-de-test-123', k);
    expect(c.startsWith('v1.')).toBe(true);
    expect(c).not.toContain('pit-jeton');
    expect(await decryptToken(c, k)).toBe('pit-jeton-de-test-123');
    await expect(decryptToken(c, testKey())).rejects.toThrow();
  });
  it('refuse une clé absente ou de mauvaise taille', async () => {
    await expect(encryptToken('x', undefined)).rejects.toThrow(/non configurée/);
    await expect(encryptToken('x', btoa('court'))).rejects.toThrow(/32 octets/);
  });
});

describe('Saisie des jetons et synchronisation manuelle', () => {
  it("l'agence enregistre un jeton : stocké chiffré, jamais renvoyé", async () => {
    const key = testKey();
    const { call, raw } = setup({ TOKEN_ENCRYPTION_KEY: key });
    const res = await call(`/clients/${A}/connections/meta/token`, { as: AGENCE, method: 'PUT', body: { token: 'EAAjeton-meta-de-test', externalId: 'act_1' } });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('EAAjeton');
    const row = raw.prepare(`SELECT token_ciphertext FROM connections WHERE client_id = ? AND type = 'meta'`).get(A) as any;
    expect(row.token_ciphertext).not.toContain('EAAjeton');
    expect(await decryptToken(row.token_ciphertext, key)).toBe('EAAjeton-meta-de-test');
    const list = await (await call(`/clients/${A}/connections`, { as: AGENCE })).text();
    expect(list).not.toContain('EAAjeton');
    expect(list).not.toContain(row.token_ciphertext);
  });

  it('refusé au client, en vue client, et sans clé de chiffrement', async () => {
    const { call } = setup({ TOKEN_ENCRYPTION_KEY: testKey() });
    const body = { token: 'EAAjeton-meta-de-test', externalId: 'act_1' };
    expect((await call(`/clients/${A}/connections/meta/token`, { as: CLIENT_A, method: 'PUT', body })).status).toBe(403);
    expect((await call(`/clients/${A}/connections/meta/token`, { as: AGENCE, view: 'client', method: 'PUT', body })).status).toBe(403);
    const { call: call2 } = setup();
    expect((await call2(`/clients/${A}/connections/meta/token`, { as: AGENCE, method: 'PUT', body })).status).toBe(500);
  });

  it('la synchronisation manuelle est réservée à l’agence et signale un jeton absent', async () => {
    const { call } = setup({ TOKEN_ENCRYPTION_KEY: testKey() });
    expect((await call(`/clients/${A}/sync`, { as: CLIENT_A, method: 'POST', body: {} })).status).toBe(403);
    const res = await call(`/clients/${A}/sync`, { as: AGENCE, method: 'POST', body: {} });
    expect(res.status).toBe(502);
    expect(((await res.json()) as any).error).toMatch(/Aucun jeton GHL/);
  });
});
