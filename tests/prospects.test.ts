import { describe, expect, it } from 'vitest';
import { AGENCE, CLIENT_A, A, setup } from './helpers/app.ts';
import { checkVerbatims, maxCostPerAppointment, normalizeForQuote, qualificationChecks } from '../packages/domain/src/index.ts';

const TOKEN = 'cle-de-test-generation-automatique-0123456789';
const robotHeaders = { Authorization: `Bearer ${TOKEN}` };
const boot = () => setup({ DELIVERY_ROBOT_TOKEN: TOKEN });
const TRANSCRIPT = `Romain : D'où viennent vos clients aujourd'hui ?
Prospect : Honnêtement, c'est le bouche-à-oreille, et ça ne suffit plus. On a essayé une agence LinkedIn à 2 000 € par mois, ça n'a rien donné.
Prospect : Si rien ne change d'ici six mois, je vais devoir licencier un commercial.
Prospect : J'ai peur que Facebook ne touche pas des directeurs financiers.`;

const ANALYSE = {
  fiche: { logiciel: 'Factura', cibleActuelle: 'PME', ticketMensuel: '300 €', dureeVieClient: '24 mois', tauxClosing: '25 %', capaciteDemos: '10', clientsPayants: '40', budgetPublicitaire: '30 €', decideurs: 'associé', ecarts: [] },
  chiffres: { ticket_mensuel: 300, duree_vie_mois: 24, taux_closing: 0.25, capacite_demos_semaine: 10, clients_payants: 40, budget_pub_jour: 30, objectif_3_mois: null },
  forces: {
    douleur: { texte: 'Le bouche-à-oreille ne suffit plus', verbatim: "c'est le bouche-à-oreille, et ça ne suffit plus" },
    attrait: { texte: '…', verbatim: '' }, anxietes: { texte: 'Doute sur Facebook', verbatim: "J'ai peur que Facebook ne touche pas des directeurs financiers" },
    habitudes: { texte: '…', verbatim: '' },
  },
  declencheur: { texte: 'Risque de licencier', verbatim: 'je vais devoir licencier un commercial' },
  dejaEssaye: [{ canal: 'LinkedIn', prestataire: 'agence', montant: '2 000 € par mois', raisonEchec: 'rien donné', verbatim: "On a essayé une agence LinkedIn à 2 000 € par mois, ça n'a rien donné" }],
  coutInaction: { texte: 'Licenciement', verbatim: 'je vais devoir licencier un commercial' },
  objections: [{ famille: 'canal', objection: 'Ma cible n\'est pas sur Facebook', explicite: true, verbatim: "J'ai peur que Facebook ne touche pas des directeurs financiers" }],
  verdict: { valeur: 'qualifie', raisons: ['ok'] }, aConfirmerEnR2: ['objectif à 3 mois'], messageSortie: null,
};
const deposit = (call: any, id: string, type: string, obj: unknown) =>
  call(`/robot/clients/${id}/delivery/pr~${type}`, { method: 'PUT', headers: robotHeaders, body: { contentMd: '```json\n' + JSON.stringify(obj) + '\n```' } });

describe('Prospects : calculs et verbatims (code, pas modèle)', () => {
  it('coût maximum d\'un rendez-vous = ticket × durée × marge × closing ; donnée manquante → pas de chiffre', () => {
    expect(maxCostPerAppointment({ ticket_mensuel: 300, duree_vie_mois: 24, taux_closing: 0.25 }, 0.25).value).toBe(450);
    const m = maxCostPerAppointment({ ticket_mensuel: 300, taux_closing: 0.25 });
    expect(m.value).toBeNull();
    expect(m.missing).toEqual(['duree_vie_mois']);
    const q = qualificationChecks({ clients_payants: 40, budget_pub_jour: 10, ticket_mensuel: 300, duree_vie_mois: 24, taux_closing: 0.25 }, true);
    expect(q.map((x) => x.ok)).toEqual([true, true, true, false]);
  });
  it('verbatim : mot pour mot, tolérant aux apostrophes, à la casse et aux espaces', () => {
    expect(normalizeForQuote('  J’ai  « peur »… ')).toBe("j'ai peur");
    const r = checkVerbatims(['ça ne suffit PLUS', 'ça ne suffira jamais'], [TRANSCRIPT]);
    expect(r.map((x) => x.found)).toEqual([true, false]);
  });
});

describe('Prospects : du R1 au R2', () => {
  it('parcours complet, étapes verrouillées, verbatims vérifiés, rien envoyé, vue agence uniquement', async () => {
    const { call, raw } = boot();
    expect((await call('/agence/prospects', { as: CLIENT_A })).status).toBe(403);
    const r = await call('/agence/prospects', { as: AGENCE, method: 'POST', body: { name: 'Factura', software: 'Factura SaaS', r1At: '2026-11-10T10:00:00Z' } });
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as any;
    const get = async () => (await (await call(`/agence/prospects/${id}`, { as: AGENCE })).json()) as any;
    let d = await get();
    expect(d.prospect.stage).toBe('r1_a_prevoir');
    expect(d.template.blocks.length).toBe(5);

    // Trame : chiffres saisis pendant l'appel, calcul en direct.
    await call(`/agence/prospects/${id}/calls/r1`, { as: AGENCE, method: 'PATCH', body: { notes: { ticket: '300', duree_vie: '24', taux_closing: '25', vente_demo: 'oui', clients_payants: '40', budget_pub: '30' } } });
    d = await get();
    expect(d.figures.taux_closing).toEqual({ value: 0.25, origin: 'trame' });
    expect(d.cost.value).toBe(450);
    // Plan impossible avant l'analyse.
    expect((await call(`/agence/prospects/${id}/documents/plan/generate`, { as: AGENCE, method: 'POST', body: {} })).status).toBe(409);

    await call(`/agence/prospects/${id}/calls/r1`, { as: AGENCE, method: 'PATCH', body: { status: 'tenu', transcript: TRANSCRIPT } });
    expect((await get()).prospect.stage).toBe('r1_fait');
    expect((await call(`/agence/prospects/${id}/documents/analyse/generate`, { as: AGENCE, method: 'POST', body: {} })).status).toBe(200);

    // Même file que le delivery.
    const q = ((await (await call('/robot/delivery/queue', { headers: robotHeaders })).json()) as any).items;
    const item = q.find((i: any) => i.clientId === id);
    expect(item).toMatchObject({ step: 'pr~analyse', clientName: 'Prospect — Factura' });
    const brief = (await (await call(`/robot/clients/${id}/delivery/pr~analyse/brief`, { headers: robotHeaders })).json()) as any;
    expect(brief.masterPrompt).toContain("Rien d'inventé");
    expect(brief.masterPrompt).toContain('Aucun prix');
    expect(brief.brief).toContain('450 € = ticket mensuel 300 €');
    expect(brief.brief).toContain('licencier un commercial');

    // Citation inventée → validation bloquée.
    const bad = structuredClone(ANALYSE);
    bad.forces.attrait.verbatim = 'Votre système a l\'air génial';
    expect((await deposit(call, id, 'analyse', { nope: 1 })).status).toBe(400);
    expect((await deposit(call, id, 'analyse', bad)).status).toBe(200);
    d = await get();
    expect(d.docs.analyse.latest.verbatimsMissing).toBe(1);
    expect((await call(`/agence/prospects/${id}/documents/analyse`, { as: AGENCE, method: 'PATCH', body: { status: 'valide' } })).status).toBe(409);
    // Romain corrige à la main, puis valide.
    // Fiche incomplète : la validation demande une confirmation explicite.
    expect((await call(`/agence/prospects/${id}/documents/analyse`, { as: AGENCE, method: 'PATCH', body: { content: ANALYSE } })).status).toBe(200);
    const v1 = await call(`/agence/prospects/${id}/documents/analyse`, { as: AGENCE, method: 'PATCH', body: { status: 'valide' } });
    expect(v1.status).toBe(409);
    expect(((await v1.json()) as any).error).toContain('Fiche incomplète');
    expect((await call(`/agence/prospects/${id}/documents/analyse`, { as: AGENCE, method: 'PATCH', body: { status: 'valide', confirmMissing: true } })).status).toBe(200);
    d = await get();
    expect(d.prospect).toMatchObject({ stage: 'analyse_validee', verdict: 'qualifie', mainObjection: "Ma cible n'est pas sur Facebook" });
    // Les chiffres de la trame priment sur ceux de la transcription.
    expect(d.figures.ticket_mensuel.origin).toBe('trame');
    expect(d.figures.capacite_demos_semaine).toEqual({ value: 10, origin: 'transcription' });

    // Plan → script du Loom → pitch R2.
    await call(`/agence/prospects/${id}`, { as: AGENCE, method: 'PATCH', body: { marketResearch: 'Concurrents : X et Y' } });
    await call(`/agence/prospects/${id}/documents/plan/generate`, { as: AGENCE, method: 'POST', body: {} });
    const planBrief = (await (await call(`/robot/clients/${id}/delivery/pr~plan/brief`, { headers: robotHeaders })).json()) as any;
    expect(planBrief.brief).not.toContain('## Transcription du R1');
    expect(planBrief.brief).toContain('cs_civex');
    expect(planBrief.brief).toContain('Concurrents : X et Y');
    await deposit(call, id, 'plan', { verticale: { choix: 'Cabinets', raisons: [], suivante: null }, angles: [], coutMaxRdvExplication: '…', actionsSansAgence: ['a'], casClient: { id: 'cs_civex', pourquoi: '…' } });
    expect((await call(`/agence/prospects/${id}/documents/script_loom/generate`, { as: AGENCE, method: 'POST', body: {} })).status).toBe(409);
    await call(`/agence/prospects/${id}/documents/plan`, { as: AGENCE, method: 'PATCH', body: { status: 'valide' } });
    d = await get();
    expect(d.prospect).toMatchObject({ stage: 'plan_valide', caseStudyId: 'cs_civex' });
    await call(`/agence/prospects/${id}/documents/script_loom/generate`, { as: AGENCE, method: 'POST', body: {} });
    await deposit(call, id, 'script_loom', { dureeMinutes: 7, passages: [], messageEmail: { objet: 'o', corps: 'c' }, messageSms: 's' });
    await call(`/agence/prospects/${id}`, { as: AGENCE, method: 'PATCH', body: { loomUrl: 'https://loom.com/x', loomSentOn: '2026-11-12' } });
    expect((await get()).prospect.stage).toBe('loom_envoye');
    await call(`/agence/prospects/${id}/calls/r2`, { as: AGENCE, method: 'PATCH', body: { scheduledAt: '2026-11-20T10:00:00Z' } });
    expect((await get()).prospect.stage).toBe('r2_planifie');
    await call(`/agence/prospects/${id}/documents/pitch_r2/generate`, { as: AGENCE, method: 'POST', body: {} });
    await deposit(call, id, 'pitch_r2', { recap: { situation: 's', declencheur: 'd', coutInaction: 'c', verbatims: ['je vais devoir licencier un commercial'] }, plan: ['1', '2', '3'], objections: [], questionCloture: 'q', pointsACreuser: [] });
    expect((await call(`/agence/prospects/${id}/documents/pitch_r2`, { as: AGENCE, method: 'PATCH', body: { status: 'valide' } })).status).toBe(200);

    // Une nouvelle génération ne touche pas à la version validée.
    await call(`/agence/prospects/${id}/documents/pitch_r2/generate`, { as: AGENCE, method: 'POST', body: { instruction: 'Plus court' } });
    d = await get();
    expect(d.docs.pitch_r2.validated.version).toBe(1);
    expect(d.docs.pitch_r2.latest).toMatchObject({ version: 2, status: 'en_file', instruction: 'Plus court' });

    // Issue, lien vers le client, rien dans l'onboarding.
    await call(`/agence/prospects/${id}/outcome`, { as: AGENCE, method: 'POST', body: { outcome: 'signe', reason: 'ok', amountCents: 750000 } });
    await call(`/agence/prospects/${id}`, { as: AGENCE, method: 'PATCH', body: { clientId: A } });
    d = await get();
    expect(d.prospect).toMatchObject({ stage: 'signe', signedAmountCents: 750000, clientId: A });
    const list = (await (await call(`/agence/prospects?clientId=${A}`, { as: AGENCE })).json()) as any;
    expect(list.items).toHaveLength(1);
    expect(list.kpis.r1HeldTotal).toBe(1);
    expect(raw.prepare(`SELECT COUNT(*) n FROM onboarding_answers WHERE answer LIKE '%Factura%'`).get()).toEqual({ n: 0 });

    // Suppression : transcriptions et documents partent avec la fiche.
    await call(`/agence/prospects/${id}`, { as: AGENCE, method: 'DELETE' });
    expect(raw.prepare(`SELECT (SELECT COUNT(*) FROM prospect_calls) + (SELECT COUNT(*) FROM prospect_documents) n`).get()).toEqual({ n: 0 });
  });

  it('disqualifié : étapes 3 et 4 fermées sauf si Romain force la suite ; alerte R1 sans analyse', async () => {
    const { call } = boot();
    const { id } = (await (await call('/agence/prospects', { as: AGENCE, method: 'POST', body: { name: 'Petit', r1At: '2020-01-01T10:00:00Z' } })).json()) as any;
    await call(`/agence/prospects/${id}/calls/r1`, { as: AGENCE, method: 'PATCH', body: { status: 'tenu', transcript: TRANSCRIPT } });
    let list = (await (await call('/agence/prospects', { as: AGENCE })).json()) as any;
    expect(list.items[0].flags).toContain('R1 tenu sans analyse depuis plus de 24 h');
    await call(`/agence/prospects/${id}/documents/analyse/generate`, { as: AGENCE, method: 'POST', body: {} });
    await deposit(call, id, 'analyse', { ...ANALYSE, verdict: { valeur: 'disqualifie', raisons: ['pas de clients'] }, messageSortie: 'Merci…' });
    await call(`/agence/prospects/${id}/documents/analyse`, { as: AGENCE, method: 'PATCH', body: { status: 'valide', confirmMissing: true } });
    expect((await call(`/agence/prospects/${id}/documents/plan/generate`, { as: AGENCE, method: 'POST', body: {} })).status).toBe(409);
    await call(`/agence/prospects/${id}`, { as: AGENCE, method: 'PATCH', body: { forceContinue: true } });
    expect((await call(`/agence/prospects/${id}/documents/plan/generate`, { as: AGENCE, method: 'POST', body: {} })).status).toBe(200);
  });

  it('transcription collée : la trame vide est complétée (citation vérifiée), jamais ce que Romain a saisi ; vérification de la fiche', async () => {
    const { call } = boot();
    const { id } = (await (await call('/agence/prospects', { as: AGENCE, method: 'POST', body: { name: 'Trame', r1At: '2026-01-01T10:00:00Z' } })).json()) as any;
    await call(`/agence/prospects/${id}/calls/r1`, { as: AGENCE, method: 'PATCH', body: { status: 'tenu', transcript: TRANSCRIPT, notes: { canaux: 'Salons (noté par Romain)' } } });
    const brief = (await (await call(`/robot/clients/${id}/delivery/pr~analyse/brief`, { headers: robotHeaders })).json()) as any;
    await call(`/agence/prospects/${id}/documents/analyse/generate`, { as: AGENCE, method: 'POST', body: {} });
    const b2 = (await (await call(`/robot/clients/${id}/delivery/pr~analyse/brief`, { headers: robotHeaders })).json()) as any;
    expect(b2.brief).toContain('`canaux` — Canaux actuels : déjà saisi par Romain');
    expect(b2.brief).toContain('`declencheur` — Déclencheur : à compléter');
    expect(b2.masterPrompt).toContain('"trame"');
    expect(brief).toBeTruthy();
    await deposit(call, id, 'analyse', { ...ANALYSE, trame: {
      canaux: { valeur: 'Bouche-à-oreille', verbatim: "c'est le bouche-à-oreille" },            // déjà saisi : ignoré
      declencheur: { valeur: 'Licenciement en vue', verbatim: 'je vais devoir licencier un commercial' }, // citation exacte : repris
      deja_essaye: { valeur: 'Agence LinkedIn', verbatim: 'une agence LinkedIn à 5 000 €' },        // citation inventée : ignoré
      vente_demo: { valeur: 'OUI', verbatim: 'ça ne suffit plus' },                                   // choix normalisé
      decideurs: { valeur: 'Son associé', verbatim: null },                                           // sans citation : ignoré
    } });
    let d = (await (await call(`/agence/prospects/${id}`, { as: AGENCE })).json()) as any;
    expect(d.r1.notes).toMatchObject({ canaux: 'Salons (noté par Romain)', declencheur: 'Licenciement en vue', vente_demo: 'oui' });
    expect(d.r1.notes.deja_essaye).toBeUndefined();
    expect(d.r1.notes.decideurs).toBeUndefined();
    const st = Object.fromEntries(d.completeness.map((x: any) => [x.key, x.status]));
    expect(st).toMatchObject({ canaux: 'trame', declencheur: 'transcription', vente_demo: 'transcription', deja_essaye: 'manquant', decideurs: 'manquant' });
    expect(d.completeness.find((x: any) => x.key === 'declencheur').verbatim).toBe('je vais devoir licencier un commercial');
    // La citation inventée dans `trame` bloque aussi la validation.
    expect(d.docs.analyse.latest.verbatimsMissing).toBe(1);
    // Romain retouche un champ déduit : il redevient « saisi ».
    await call(`/agence/prospects/${id}/calls/r1`, { as: AGENCE, method: 'PATCH', body: { notes: { declencheur: 'Licenciement envisagé' } } });
    d = (await (await call(`/agence/prospects/${id}`, { as: AGENCE })).json()) as any;
    expect(d.completeness.find((x: any) => x.key === 'declencheur').status).toBe('trame');
    expect(d.r1.notes._origines.declencheur).toBeUndefined();
    // Une nouvelle analyse ne remplace pas ce que Romain a retouché.
    await call(`/agence/prospects/${id}/documents/analyse/generate`, { as: AGENCE, method: 'POST', body: {} });
    await deposit(call, id, 'analyse', { ...ANALYSE, trame: { declencheur: { valeur: 'Autre', verbatim: 'ça ne suffit plus' } } });
    d = (await (await call(`/agence/prospects/${id}`, { as: AGENCE })).json()) as any;
    expect(d.r1.notes.declencheur).toBe('Licenciement envisagé');
  });

  it('rendez-vous GoHighLevel à venir : listés, fiche créée depuis le rendez-vous, plus listés ensuite ; aucune écriture GHL', async () => {
    const { call, raw } = boot();
    const soon = new Date(Date.now() + 2 * 86400e3).toISOString();
    raw.exec(`DELETE FROM appointments WHERE client_id = '${A}';
      INSERT INTO appointments (id, client_id, ghl_appointment_id, contact_name, booked_at, scheduled_at, status, ghl_contact_id) VALUES
        ('ap_t1', '${A}', 'g1', 'Alexandre F.', '2026-01-01T10:00:00Z', '${soon}', 'prevu', 'ct1'),
        ('ap_t2', '${A}', 'g2', 'Annulé X.', '2026-01-01T10:00:00Z', '${soon}', 'annule', 'ct2'),
        ('ap_t3', '${A}', 'g3', 'Passé Y.', '2026-01-01T10:00:00Z', '2020-01-01T10:00:00Z', 'prevu', 'ct3');
      INSERT INTO crm_leads (client_id, opportunity_id, contact_id, name, source, stage_name) VALUES ('${A}', 'op1', 'ct1', 'Alexandre F', 'Facebook', 'Rendez-vous planifié');`);
    // Sans réglage : rien ; avec le client choisi : le seul rendez-vous à venir non annulé.
    expect(((await (await call('/agence/prospects', { as: AGENCE })).json()) as any).upcoming.clientId).toBeNull();
    expect((await call('/agence/prospects-reglages', { as: AGENCE, method: 'PUT', body: { ghlClientId: A } })).status).toBe(200);
    let up = ((await (await call('/agence/prospects', { as: AGENCE })).json()) as any).upcoming;
    expect(up.items.map((x: any) => x.id)).toEqual(['ap_t1']);
    expect(up.items[0]).toMatchObject({ name: 'Alexandre F.', source: 'Facebook', stage: 'Rendez-vous planifié' });
    const r = await call('/agence/prospects', { as: AGENCE, method: 'POST', body: { appointmentId: 'ap_t1' } });
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as any;
    const full = (await (await call(`/agence/prospects/${id}`, { as: AGENCE })).json()) as any;
    expect(full.prospect).toMatchObject({ name: 'Alexandre F.', source: 'publicite' });
    expect(full.r1.scheduledAt).toBe(soon);
    up = ((await (await call('/agence/prospects', { as: AGENCE })).json()) as any).upcoming;
    expect(up.items).toEqual([]);
    expect((await call('/agence/prospects', { as: AGENCE, method: 'POST', body: { appointmentId: 'ap_t1' } })).status).toBe(409);
    expect((await call('/agence/prospects', { as: AGENCE, method: 'POST', body: { appointmentId: 'ap_inconnu' } })).status).toBe(404);
  });

  it('réglages : marge, cas clients, trame versionnée (une fiche garde sa version)', async () => {
    const { call } = boot();
    const { id } = (await (await call('/agence/prospects', { as: AGENCE, method: 'POST', body: { name: 'P' } })).json()) as any;
    const s = (await (await call('/agence/prospects-reglages', { as: AGENCE })).json()) as any;
    expect(s.margin).toBe(0.25);
    expect(s.caseStudies.map((x: any) => x.client)).toEqual(['Civex', 'Invoicing Plus', 'Enobase', 'Ecommercio']);
    const blocks = structuredClone(s.template.blocks);
    blocks[0].questions = ['Nouvelle question'];
    expect((await call('/agence/prospects-reglages', { as: AGENCE, method: 'PUT', body: { template: blocks, margin: 0.3 } })).status).toBe(200);
    const s2 = (await (await call('/agence/prospects-reglages', { as: AGENCE })).json()) as any;
    expect(s2.template.version).toBe(2);
    expect(s2.margin).toBe(0.3);
    const d = (await (await call(`/agence/prospects/${id}`, { as: AGENCE })).json()) as any;
    expect(d.template.version).toBe(1);
    expect(d.template.blocks[0].questions[0]).not.toBe('Nouvelle question');
  });
});

describe('Prospects : « Mettre à jour » l\'analyse depuis la fiche (décision 0031)', () => {
  it('reprend chiffres et trame saisis après la rédaction, recalcule le coût, sans passer par Claude ; une version validée donne un nouveau brouillon', async () => {
    const { call } = boot();
    const { id } = (await (await call('/agence/prospects', { as: AGENCE, method: 'POST', body: { name: 'Liroad' } })).json()) as any;
    await call(`/agence/prospects/${id}/calls/r1`, { as: AGENCE, method: 'PATCH', body: { status: 'tenu', transcript: TRANSCRIPT, notes: { vente_demo: 'oui' } } });
    await call(`/agence/prospects/${id}/documents/analyse/generate`, { as: AGENCE, method: 'POST', body: {} });
    const partial = {
      ...ANALYSE,
      fiche: { ...ANALYSE.fiche, ticketMensuel: 'à confirmer en R2', dureeVieClient: 'à confirmer en R2' },
      chiffres: { ...ANALYSE.chiffres, ticket_mensuel: null, duree_vie_mois: null },
      verdict: { valeur: 'a_creuser', raisons: ["Coût maximum d'un rendez-vous : non calculable", 'Petit ticket'] },
      aConfirmerEnR2: ['Ticket mensuel exact', 'Durée de vie client', 'Qui décide'],
    };
    expect((await deposit(call, id, 'analyse', partial)).status).toBe(200);
    // Romain complète la fiche après coup.
    await call(`/agence/prospects/${id}/figures`, { as: AGENCE, method: 'PUT', body: { ticket_mensuel: 290, duree_vie_mois: 24, taux_closing: 0.2 } });
    await call(`/agence/prospects/${id}/calls/r1`, { as: AGENCE, method: 'PATCH', body: { notes: { vente_demo: 'oui', decideurs: 'Alexandre et ses deux associés' } } });

    const r = await call(`/agence/prospects/${id}/documents/analyse/refresh`, { as: AGENCE, method: 'POST' });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).changed).toContain('chiffres.ticket_mensuel');
    let d = (await (await call(`/agence/prospects/${id}`, { as: AGENCE })).json()) as any;
    const c = d.docs.analyse.latest.content;
    expect(d.docs.analyse.latest).toMatchObject({ version: 1, status: 'brouillon', editedByHand: false });
    expect(c.chiffres).toMatchObject({ ticket_mensuel: 290, duree_vie_mois: 24, taux_closing: 0.2 });
    expect(c.fiche).toMatchObject({ ticketMensuel: '290 €', dureeVieClient: '24 mois', tauxClosing: '20 %', decideurs: 'Alexandre et ses deux associés' });
    expect(c.aConfirmerEnR2).toEqual(['Qui décide']);
    expect(c.verdict.valeur).toBe('a_creuser'); // le jugement ne change pas
    expect(c.verdict.raisons.join(' ')).toContain('348 €'); // 290 × 24 × 25 % × 20 %
    expect(c.verdict.raisons).toContain('Petit ticket');
    expect((await (await call(`/agence/prospects/${id}/documents/analyse/refresh`, { as: AGENCE, method: 'POST' })).json() as any).changed).toEqual([]);

    // Validée puis mise à jour : nouvelle version en brouillon, la validée est conservée.
    await call(`/agence/prospects/${id}/documents/analyse`, { as: AGENCE, method: 'PATCH', body: { status: 'valide', confirmMissing: true } });
    await call(`/agence/prospects/${id}/figures`, { as: AGENCE, method: 'PUT', body: { budget_pub_jour: 35 } });
    expect((await call(`/agence/prospects/${id}/documents/analyse/refresh`, { as: AGENCE, method: 'POST' })).status).toBe(200);
    d = (await (await call(`/agence/prospects/${id}`, { as: AGENCE })).json()) as any;
    expect(d.docs.analyse.latest).toMatchObject({ version: 2, status: 'brouillon' });
    expect(d.docs.analyse.latest.content.fiche.budgetPublicitaire).toBe('35 €/jour');
    expect(d.docs.analyse.validated.version).toBe(1);
    expect((await call(`/agence/prospects/${id}/documents/analyse/refresh`, { as: CLIENT_A, method: 'POST' })).status).toBe(403);
  });
});
