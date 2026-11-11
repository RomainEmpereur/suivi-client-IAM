import { describe, expect, it } from 'vitest';
import { ALL_QUESTIONS, ONBOARDING_SECTIONS, costPerAppointmentCeilingCents } from '../packages/domain/src/index.ts';
import { A, AGENCE, B, C, CLIENT_A, CLIENT_B, CLIENT_C, setup } from './helpers/app.ts';

const save = (call: ReturnType<typeof setup>['call'], client: string, as: string, key: string, value: string, view?: 'client') =>
  call(`/clients/${client}/onboarding/answers/${key}`, { as, method: 'PUT', body: { value }, view });

describe('Définition du formulaire', () => {
  it('reprend les 43 questions du formulaire Google, en 8 sections', () => {
    expect(ONBOARDING_SECTIONS).toHaveLength(8);
    const nums = ALL_QUESTIONS.filter((q) => q.num !== null).map((q) => q.num);
    expect(nums).toEqual(Array.from({ length: 43 }, (_, i) => i + 1));
  });
  it('contient les ajouts du §7 (avatar, habitude, anxiété, fondateur, chiffres unitaires, cas chiffré)', () => {
    const keys = ALL_QUESTIONS.map((q) => q.key);
    for (const k of ['avatar_journee', 'frein_habitude', 'frein_anxiete', 'fondateur_pourquoi', 'fondateur_echec', 'ue_ticket', 'ue_duree', 'ue_marge', 'ue_closing', 'ue_capacite', 'cas_chiffre', 'cas_accord']) {
      expect(keys).toContain(k);
    }
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('Onboarding : remplissage', () => {
  it('le client sauvegarde champ par champ et retrouve ses réponses', async () => {
    const { call } = setup();
    expect((await save(call, C, CLIENT_C, 'q05', 'Logiciel de paie pour cabinets.')).status).toBe(200);
    const json = await (await call(`/clients/${C}/onboarding`, { as: CLIENT_C })).json() as any;
    expect(json.answers.q05.value).toBe('Logiciel de paie pour cabinets.');
    expect(json.locked).toBe(false);
    expect(json.editableSections).toHaveLength(8);
  });

  it('valide la forme des réponses (nombre, choix)', async () => {
    const { call } = setup();
    expect((await save(call, C, CLIENT_C, 'ue_ticket', 'beaucoup')).status).toBe(400);
    expect((await save(call, C, CLIENT_C, 'q41', '1 000 € / jour')).status).toBe(400);
    expect((await save(call, C, CLIENT_C, 'q07', JSON.stringify(['Cold email', 'Inventé']))).status).toBe(400);
    expect((await save(call, C, CLIENT_C, 'q07', JSON.stringify(['Cold email']))).status).toBe(200);
    expect((await save(call, C, CLIENT_C, 'inexistante', 'x')).status).toBe(404);
  });

  it("un client ne peut pas écrire dans l'onboarding d'un autre", async () => {
    const { call } = setup();
    expect((await save(call, C, CLIENT_A, 'q05', 'intrusion')).status).toBe(404);
    expect((await call(`/clients/${C}/onboarding`, { as: CLIENT_A })).status).toBe(404);
  });

  it("l'agence ne répond pas à la place du client, et la vue client reste en lecture seule", async () => {
    const { call } = setup();
    expect((await save(call, C, AGENCE, 'q05', 'x')).status).toBe(403);
    expect((await save(call, C, AGENCE, 'q05', 'x', 'client')).status).toBe(403);
  });

  it("l'envoi est refusé tant que les obligatoires ne sont pas remplies", async () => {
    const { call } = setup();
    const res = await call(`/clients/${C}/onboarding/submit`, { as: CLIENT_C, method: 'POST' });
    expect(res.status).toBe(400);
    const json = await res.json() as { missing: string[] };
    expect(json.missing.length).toBeGreaterThan(40);
  });

  it('les chiffres unitaires alimentent le plafond du coût par rendez-vous', async () => {
    const { call, raw } = setup();
    for (const [k, v] of [['ue_ticket', '300'], ['ue_duree', '20'], ['ue_marge', '80'], ['ue_closing', '25']]) {
      expect((await save(call, C, CLIENT_C, k, v)).status).toBe(200);
    }
    const ue = JSON.parse((raw.prepare('SELECT unit_economics_json AS j FROM clients WHERE id = ?').get(C) as { j: string }).j);
    expect(ue).toMatchObject({ monthly_ticket_cents: 30000, lifetime_months: 20, gross_margin: 0.8, demo_close_rate: 0.25 });
    expect(costPerAppointmentCeilingCents({ ...ue, acceptable_share: 0.05 })).toBe(6000);
  });
});

describe('Onboarding : verrouillage et relance', () => {
  it('envoi complet → verrouillé, puis toute modification est refusée', async () => {
    const { call, raw } = setup();
    for (const q of ALL_QUESTIONS) {
      const v = q.type === 'number' ? '10' : q.type === 'choice' ? q.options![0] : q.type === 'multi' ? JSON.stringify([q.options![0]]) : 'ok';
      expect((await save(call, C, CLIENT_C, q.key, v)).status).toBe(200);
    }
    expect((await call(`/clients/${C}/onboarding/submit`, { as: CLIENT_C, method: 'POST' })).status).toBe(200);
    const json = await (await call(`/clients/${C}/onboarding`, { as: CLIENT_C })).json() as any;
    expect(json.locked).toBe(true);
    expect(json.submittedAt).toBeTruthy();
    expect(json.editableSections).toEqual([]);
    expect((await save(call, C, CLIENT_C, 'q05', 'modif')).status).toBe(403);
    expect(raw.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'onboarding_soumis' AND client_id = ?`).get(C)).toEqual({ n: 1 });
  });

  it('une section rouverte redevient modifiable, et elle seule', async () => {
    const { call } = setup();
    const json = await (await call(`/clients/${B}/onboarding`, { as: CLIENT_B })).json() as any;
    expect(json.editableSections).toEqual(['icp']);
    expect(json.reopenings[0].questionKey).toBe('avatar_journee');
    expect((await save(call, B, CLIENT_B, 'avatar_journee', 'À 8 h, elle ouvre trois tableurs…')).status).toBe(200);
    expect((await save(call, B, CLIENT_B, 'q05', 'hors section')).status).toBe(403);
    expect((await call(`/clients/${B}/onboarding/submit`, { as: CLIENT_B, method: 'POST' })).status).toBe(200);
    const after = await (await call(`/clients/${B}/onboarding`, { as: CLIENT_B })).json() as any;
    expect(after.editableSections).toEqual([]);
  });

  it("une réponse modifiée après l'envoi est signalée en vue agence, pas en vue client", async () => {
    const { call } = setup();
    await save(call, B, CLIENT_B, 'avatar_journee', 'Nouvelle version');
    const agency = await (await call(`/clients/${B}/onboarding`, { as: AGENCE })).json() as any;
    expect(Object.keys(agency.changesAfterSubmit)).toEqual(expect.arrayContaining(['q43', 'avatar_journee']));
    const client = await (await call(`/clients/${B}/onboarding`, { as: CLIENT_B })).json() as any;
    expect(client).not.toHaveProperty('changesAfterSubmit');
    const clientView = await (await call(`/clients/${B}/onboarding`, { as: AGENCE, view: 'client' })).json() as any;
    expect(clientView).not.toHaveProperty('changesAfterSubmit');
  });

  it("seule l'agence rouvre, avec un message, une section d'un formulaire déjà envoyé", async () => {
    const { call } = setup();
    const body = { section: 'offre', questionKey: 'ue_closing', message: 'Pouvez-vous préciser le taux de closing ?' };
    expect((await call(`/clients/${A}/onboarding/reopen`, { as: CLIENT_A, method: 'POST', body })).status).toBe(403);
    expect((await call(`/clients/${A}/onboarding/reopen`, { as: AGENCE, method: 'POST', body: { ...body, message: ' ' } })).status).toBe(400);
    expect((await call(`/clients/${A}/onboarding/reopen`, { as: AGENCE, method: 'POST', body: { ...body, questionKey: 'q05' } })).status).toBe(400);
    expect((await call(`/clients/${C}/onboarding/reopen`, { as: AGENCE, method: 'POST', body })).status).toBe(409);
    expect((await call(`/clients/${A}/onboarding/reopen`, { as: AGENCE, method: 'POST', body })).status).toBe(200);
    const json = await (await call(`/clients/${A}/onboarding`, { as: CLIENT_A })).json() as any;
    expect(json.editableSections).toEqual(['offre']);
  });
});
