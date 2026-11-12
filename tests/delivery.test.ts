import { describe, expect, it } from 'vitest';
import { A, AGENCE, B, C, CLIENT_A, CLIENT_B, setup } from './helpers/app.ts';

const TOKEN = 'cle-de-test-generation-automatique-0123456789';
const robotHeaders = { Authorization: `Bearer ${TOKEN}` };
const boot = () => setup({ DELIVERY_ROBOT_TOKEN: TOKEN });
const get = async (call: any, client: string) => (await (await call(`/clients/${client}/delivery`, { as: AGENCE })).json()) as any;
const step = async (call: any, client: string, key: string) => (await get(call, client)).steps.find((s: any) => s.key === key);
const patch = (call: any, client: string, key: string, body: unknown, as = AGENCE) =>
  call(`/clients/${client}/delivery/${key}`, { as, method: 'PATCH', body });
const deposit = (call: any, client: string, key: string, body: unknown) =>
  call(`/robot/clients/${client}/delivery/${key}`, { method: 'PUT', body, headers: robotHeaders });
const CHAIN = ['s0', 's1a', 's1b', 's1c', 's2', 's3', 's4', 's5', 's6', 's7'];

/** Lance le delivery et fait rédiger toute la chaîne par la « génération ». */
async function generateAll(call: any) {
  expect((await call(`/clients/${B}/delivery/launch`, { as: AGENCE, method: 'POST' })).status).toBe(200);
  for (const k of CHAIN) {
    const r = await deposit(call, B, k, { contentMd: `# Pièce ${k}\n\nTexte de ${k}.`, ...(k === 's1c' ? { mechanism: 'La Méthode Pilote' } : {}) });
    expect(r.status, k).toBe(200);
  }
}

describe('Delivery : conditions de lancement', () => {
  it("rien ne se lance tant que l'onboarding et les infos de base manquent", async () => {
    const { call } = boot();
    const d = await get(call, C);
    expect(d.gate.ok).toBe(false);
    expect(d.gate.missing).toContain("Formulaire d'onboarding envoyé");
    expect(d.steps.every((s: any) => !s.available)).toBe(true);
    expect((await call(`/clients/${C}/delivery/launch`, { as: AGENCE, method: 'POST' })).status).toBe(409);
    expect((await call(`/clients/${C}/delivery/s0/brief`, { as: AGENCE })).status).toBe(409);
  });

  it('liste précisément l’info de base manquante', async () => {
    const { call, raw } = boot();
    expect((await get(call, B)).gate).toEqual({ ok: true, missing: [] });
    raw.prepare(`UPDATE onboarding_answers SET answer = '' WHERE client_id = ? AND question_key = 'q33'`).run(B);
    expect((await get(call, B)).gate).toEqual({ ok: false, missing: ['Concurrents cités'] });
  });
});

describe('Delivery : génération de toute la chaîne', () => {
  it('le lancement met les étapes 0 à 7 en file, dans l’ordre, sans le point hebdomadaire', async () => {
    const { call } = boot();
    const r = await call(`/clients/${B}/delivery/launch`, { as: AGENCE, method: 'POST' });
    expect(((await r.json()) as any).queued).toBe(10);
    const q = (await (await call('/robot/delivery/queue', { headers: robotHeaders })).json()) as any;
    expect(q.items.map((i: any) => i.step)).toEqual(CHAIN);
    // Relancer ne duplique rien.
    expect(((await (await call(`/clients/${B}/delivery/launch`, { as: AGENCE, method: 'POST' })).json()) as any).queued).toBe(0);
  });

  it('la génération rédige dans l’ordre, fixe le mécanisme recommandé, et sort chaque pièce de la file', async () => {
    const { call } = boot();
    await call(`/clients/${B}/delivery/launch`, { as: AGENCE, method: 'POST' });
    // Pas de VSL avant l'offre.
    expect((await call(`/robot/clients/${B}/delivery/s2/brief`, { headers: robotHeaders })).status).toBe(409);
    for (const k of ['s0', 's1a', 's1b']) await deposit(call, B, k, { contentMd: `Texte ${k}` });
    expect((await deposit(call, B, 's1c', { contentMd: 'Page client' })).status).toBe(400); // nom recommandé exigé
    expect((await deposit(call, B, 's1c', { contentMd: 'Page client', mechanism: 'La Méthode Pilote' })).status).toBe(200);
    const brief = (await (await call(`/robot/clients/${B}/delivery/s2/brief`, { headers: robotHeaders })).json()) as any;
    expect(brief.masterPrompt.length).toBeGreaterThan(10000);
    expect(brief.brief).toContain('La Méthode Pilote');
    expect(brief.brief).toContain("## 2. Les règles d'or");
    expect(brief.brief).toContain('Visuels de la VSL');
    expect(brief.brief).toContain('## 13. Garde-fous');
    expect(brief.brief).toContain('Texte s1b');
    expect(brief.brief).toContain('Les 8 blocs');
    const d = await get(call, B);
    expect(d.mechanism).toBe('La Méthode Pilote');
    expect(d.steps.find((s: any) => s.key === 's1c')).toMatchObject({ status: 'a_valider', queued: false, contentSource: 'claude', contentVersion: 1 });
    expect(d.steps.find((s: any) => s.key === 's2')).toMatchObject({ status: 'en_cours', queued: true });
  });

  it('la génération ne valide ni ne publie jamais, et refuse sans la bonne clé', async () => {
    const { call, raw } = boot();
    await generateAll(call);
    expect((await get(call, B)).steps.filter((s: any) => s.status === 'valide')).toHaveLength(0);
    expect(raw.prepare(`SELECT COUNT(*) n FROM deliverables WHERE origin = 'genere'`).get()).toEqual({ n: 0 });
    expect((await call('/robot/delivery/queue', { headers: { Authorization: 'Bearer mauvaise' } })).status).toBe(401);
    expect((await call('/robot/delivery/queue')).status).toBe(401);
    const { call: noKey } = setup();
    expect((await noKey('/robot/delivery/queue', { headers: robotHeaders })).status).toBe(503);
    // Pas de route de validation côté génération.
    expect((await call(`/robot/clients/${B}/delivery/s0`, { method: 'PATCH', body: { status: 'valide' }, headers: robotHeaders })).status).not.toBe(200);
  });

  it('un échec signalé sort l’étape de la file avec son message', async () => {
    const { call } = boot();
    await call(`/clients/${B}/delivery/launch`, { as: AGENCE, method: 'POST' });
    await call(`/robot/clients/${B}/delivery/s0/error`, { method: 'POST', body: { message: 'Site inaccessible' }, headers: robotHeaders });
    expect(await step(call, B, 's0')).toMatchObject({ queued: false, lastError: 'Site inaccessible', status: 'a_faire' });
  });
});

describe('Delivery : relecture, validation, publication au client', () => {
  it('valider une pièce client la publie aussitôt dans l’espace du client, mise en page', async () => {
    const { call } = boot();
    await generateAll(call);
    expect((await patch(call, B, 's2', { status: 'valide' })).status).toBe(200);
    const infra = (await (await call(`/clients/${B}/infrastructure`, { as: CLIENT_B })).json()) as any;
    const vsl = infra.deliverables.find((x: any) => x.type === 'vsl_script' && x.hasContent);
    expect(vsl).toMatchObject({ status: 'valide', published: true, hasContent: true });
    const read = (await (await call(`/clients/${B}/deliverables/${vsl.id}`, { as: CLIENT_B })).json()) as any;
    expect(read.contentMd).toContain('Texte de s2');
    // Un document interne (1B) ne crée pas de livrable client.
    expect((await patch(call, B, 's1b', { status: 'valide' })).status).toBe(200);
    const after = (await (await call(`/clients/${B}/infrastructure`, { as: CLIENT_B })).json()) as any;
    expect(after.deliverables.filter((x: any) => x.hasContent)).toHaveLength(1);
  });

  it("modifier une pièce validée la repasse « à valider » ; le client garde la version publiée jusqu'à la revalidation", async () => {
    const { call } = boot();
    await generateAll(call);
    await patch(call, B, 's3', { status: 'valide' });
    expect((await patch(call, B, 's3', { contentMd: '# Landing v2' })).status).toBe(200);
    expect(await step(call, B, 's3')).toMatchObject({ status: 'a_valider', contentVersion: 2, contentSource: 'agence' });
    const infra = async () => (await (await call(`/clients/${B}/infrastructure`, { as: CLIENT_B })).json()) as any;
    let lp = (await infra()).deliverables.find((x: any) => x.type === 'landing' && x.hasContent);
    expect(((await (await call(`/clients/${B}/deliverables/${lp.id}`, { as: CLIENT_B })).json()) as any).contentMd).toContain('Texte de s3');
    await patch(call, B, 's3', { status: 'valide' });
    lp = (await infra()).deliverables.find((x: any) => x.type === 'landing' && x.hasContent);
    expect(lp).toMatchObject({ status: 'mis_a_jour', version: 2 });
    expect(((await (await call(`/clients/${B}/deliverables/${lp.id}`, { as: CLIENT_B })).json()) as any).contentMd).toBe('# Landing v2');
  });

  it("changer l'offre ou le mécanisme fait passer la suite « à revoir » ; la reprise la remet en file", async () => {
    const { call } = boot();
    await generateAll(call);
    await patch(call, B, 's1b', { contentMd: 'Offre corrigée' });
    const d = await get(call, B);
    expect(d.steps.filter((s: any) => s.stale).map((s: any) => s.key)).toEqual(['s1c', 's2', 's3', 's4', 's5', 's6', 's7']);
    expect((await patch(call, B, 's2', { status: 'valide' })).status).toBe(409);
    // Garder tel quel.
    expect((await patch(call, B, 's1c', { stale: false })).status).toBe(200);
    // Reprendre le reste.
    const r = await call(`/clients/${B}/delivery/regenerate-stale`, { as: AGENCE, method: 'POST' });
    expect(((await r.json()) as any).queued).toBe(6);
    await deposit(call, B, 's2', { contentMd: 'VSL refaite' });
    expect(await step(call, B, 's2')).toMatchObject({ stale: false, queued: false, contentVersion: 2 });
    // Changer le mécanisme : les pièces qui le citent passent à revoir.
    await patch(call, B, 's2', { stale: false });
    await patch(call, B, 's1c', { mechanism: 'Le Système Pilote' });
    expect((await get(call, B)).mechanism).toBe('Le Système Pilote');
    expect((await step(call, B, 's2')).stale).toBe(true);
  });

  it('une reprise avec consigne transmet la consigne et la version actuelle à la génération', async () => {
    const { call } = boot();
    await generateAll(call);
    expect((await patch(call, B, 's4', { regenerate: true, instruction: 'Hooks plus courts' })).status).toBe(200);
    const q = (await (await call('/robot/delivery/queue', { headers: robotHeaders })).json()) as any;
    expect(q.items).toEqual([expect.objectContaining({ step: 's4', instruction: 'Hooks plus courts' })]);
    const brief = ((await (await call(`/robot/clients/${B}/delivery/s4/brief`, { headers: robotHeaders })).json()) as any).brief;
    expect(brief).toContain('Hooks plus courts');
    expect(brief).toContain('Texte de s4');
    await deposit(call, B, 's4', { contentMd: 'Ads v2' });
    expect(await step(call, B, 's4')).toMatchObject({ instruction: null, queued: false, contentVersion: 2 });
  });

  it('le point hebdomadaire se demande, se rédige avec les chiffres, et ne se valide pas', async () => {
    const { call } = boot();
    await generateAll(call);
    expect((await patch(call, B, 's8', { regenerate: true })).status).toBe(200);
    const brief = ((await (await call(`/robot/clients/${B}/delivery/s8/brief`, { headers: robotHeaders })).json()) as any).brief;
    expect(brief).toContain('Chiffres de la semaine');
    await deposit(call, B, 's8', { contentMd: 'Point de la semaine' });
    expect((await patch(call, B, 's8', { status: 'valide' })).status).toBe(409);
  });
});

describe('Delivery : accès', () => {
  it('refusé au client et à la vue client ; un autre client est introuvable', async () => {
    const { call } = boot();
    expect((await call(`/clients/${B}/delivery`, { as: CLIENT_B })).status).toBe(403);
    expect((await call(`/clients/${B}/delivery`, { as: AGENCE, view: 'client' })).status).toBe(403);
    expect((await call(`/clients/${B}/delivery/launch`, { as: CLIENT_B, method: 'POST' })).status).toBe(403);
    expect((await patch(call, B, 's0', { status: 'valide' }, CLIENT_B)).status).toBe(403);
    expect((await call(`/clients/${A}/delivery`, { as: CLIENT_B })).status).toBe(404);
    expect((await call('/delivery/master-prompt', { as: CLIENT_B })).status).toBe(403);
  });

  it("un client ne lit pas un livrable non publié, ni celui d'un autre client", async () => {
    const { call, raw } = boot();
    await generateAll(call);
    await patch(call, B, 's5', { status: 'valide' });
    const id = (raw.prepare(`SELECT id FROM deliverables WHERE client_id = ? AND type = 'sequences' AND origin = 'genere'`).get(B) as any).id;
    expect((await call(`/clients/${A}/deliverables/${id}`, { as: CLIENT_A })).status).toBe(404);
    raw.prepare(`UPDATE deliverables SET visible_client = 0 WHERE id = ?`).run(id);
    expect(((await (await call(`/clients/${B}/deliverables/${id}`, { as: CLIENT_B })).json()) as any).contentMd).toBeNull();
  });
});

describe('Intégrations de la landing (décision 0017)', () => {
  const PAGE = '<html><body><div class="hero"><!-- OBSIDIAN:VSL:DEBUT --><div class="mock">Lecteur</div><!-- OBSIDIAN:VSL:FIN --></div>'
    + '<section><!-- OBSIDIAN:CALENDRIER:DEBUT --><div class="mock">Calendrier</div><!-- OBSIDIAN:CALENDRIER:FIN --></section></body></html>';

  it('remplace le contenu des repères, garde les repères, ignore les motifs $ du code', async () => {
    const { applyIntegrations, integrationMarkers } = await import('../packages/domain/src/index.ts');
    expect(integrationMarkers(PAGE)).toEqual({ vsl: true, calendrier: true });
    const r = applyIntegrations(PAGE, { vsl: '<script src="https://fast.wistia.com/x.js"></script>$&', calendrier: null });
    expect(r.applied).toEqual(['vsl']);
    expect(r.html).toContain('<!-- OBSIDIAN:VSL:DEBUT -->\n<script src="https://fast.wistia.com/x.js"></script>$&\n<!-- OBSIDIAN:VSL:FIN -->');
    expect(r.html).not.toContain('Lecteur');
    expect(r.html).toContain('Calendrier'); // sans code, la maquette reste
    const again = applyIntegrations(r.html, { vsl: '<iframe src="https://fast.wistia.net/embed/iframe/abc"></iframe>' });
    expect(again.html).not.toContain('x.js'); // remplaçable autant de fois que nécessaire
    expect(applyIntegrations('<p>sans repères</p>', { vsl: '<iframe></iframe>' }).missingMarkers).toEqual(['vsl', 'calendrier']);
  });

  it("l'agence enregistre les codes sur l'étape 3 ; ils survivent à une nouvelle version ; refusés ailleurs et pour le client", async () => {
    const { call } = boot();
    await generateAll(call);
    expect((await patch(call, B, 's3', { integrations: { vsl: 'pas un code' } })).status).toBe(400);
    expect((await patch(call, B, 's2', { integrations: { vsl: '<iframe></iframe>' } })).status).toBe(400);
    expect((await patch(call, B, 's3', { integrations: { calendrier: '<iframe src="https://api.leadconnectorhq.com/widget/booking/x"></iframe>' } }, CLIENT_B)).status).toBe(403);
    expect((await patch(call, B, 's3', { integrations: { vsl: '<script src="https://fast.wistia.com/a.js"></script>', calendrier: '<iframe src="https://api.leadconnectorhq.com/widget/booking/x"></iframe>' } })).status).toBe(200);
    await deposit(call, B, 's3', { contentMd: '# Landing v2\n\n```html page\n' + PAGE + '\n```' });
    const s3 = await step(call, B, 's3');
    expect(s3.integrations.vsl).toContain('wistia');
    expect(s3.integrations.calendrier).toContain('leadconnectorhq');
    expect((await step(call, B, 's2')).integrations).toBeNull();
  });
});

describe('Code pour GoHighLevel', () => {
  it('transforme une page complète en fragment : polices et styles gardés, doctype / head / meta retirés, body en conteneur', async () => {
    const { ghlSnippet } = await import('../packages/domain/src/index.ts');
    const doc = '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>X</title><link rel="icon" href="/f.ico">'
      + '<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet"><style>.a{color:red}</style></head>'
      + '<body class="lp" style="margin:0"><h1>Titre</h1><script>console.log(1)</script></body></html>';
    const out = ghlSnippet(doc);
    expect(out).not.toMatch(/<!doctype|<html|<head|<body|<title|<meta|rel="icon"/i);
    expect(out).toContain('fonts.googleapis.com');
    expect(out).toContain('<style>.a{color:red}</style>');
    expect(out).toContain('<div class="obsidian-landing lp" style="margin:0">');
    expect(ghlSnippet('<html><head><style>body{margin:0} html, body .x{a:b} .tbody{c:d}</style></head><body><p>x</p></body></html>'))
      .toContain('<style>.obsidian-landing{margin:0} .obsidian-landing, .obsidian-landing .x{a:b} .tbody{c:d}</style>');
    expect(out).toContain('<h1>Titre</h1><script>console.log(1)</script>');
    expect(ghlSnippet('<section>déjà un fragment</section>')).toBe('<section>déjà un fragment</section>');
  });
});
