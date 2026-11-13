import { describe, expect, it } from 'vitest';
import { AGENCE, B, CLIENT_B, setup } from './helpers/app.ts';
import { addDaysYmd, compareOptimisation, optimisationWindows, todayParis, emptyTotals } from '../packages/domain/src/index.ts';

const TOKEN = 'cle-de-test-generation-automatique-0123456789';
const robotHeaders = { Authorization: `Bearer ${TOKEN}` };
const boot = () => setup({ DELIVERY_ROBOT_TOKEN: TOKEN });
const CHAIN = ['s0', 's1a', 's1b', 's1c', 's2', 's3', 's4', 's5', 's6', 's7', 's9'];

async function chain(call: any) {
  await call(`/clients/${B}/delivery/launch`, { as: AGENCE, method: 'POST' });
  for (const k of CHAIN) {
    const r = await call(`/robot/clients/${B}/delivery/${k}`, { method: 'PUT', headers: robotHeaders, body: { contentMd: `# Pièce ${k}\n\nTexte de ${k}.`, ...(k === 's1c' ? { mechanism: 'La Méthode Pilote' } : {}) } });
    expect(r.status, k).toBe(200);
  }
}
const list = async (call: any, as = AGENCE) => (await (await call(`/clients/${B}/optimisations`, { as })).json()) as any;
const queue = async (call: any) => ((await (await call('/robot/delivery/queue', { headers: robotHeaders })).json()) as any).items;

describe('Optimisations : mesure', () => {
  it('fenêtres de 14 jours avant / après, bornées à hier', () => {
    const w = optimisationWindows('2026-11-01', '2026-11-06');
    expect(w.before).toEqual({ from: '2026-10-18', to: '2026-10-31' });
    expect(w.after).toEqual({ from: '2026-11-01', to: '2026-11-05' });
    expect(w).toMatchObject({ elapsedDays: 5, complete: false, completeOn: '2026-11-15' });
    expect(optimisationWindows('2026-11-01', '2026-11-20')).toMatchObject({ elapsedDays: 14, complete: true, after: { to: '2026-11-14' } });
    expect(optimisationWindows('2026-11-10', '2026-11-10').after).toBeNull();
  });
  it('compare les ratios, jamais de zéro inventé', () => {
    const b = { ...emptyTotals(), spend_cents: 10000, leads: 10, appointments_booked: 2 };
    const a = { ...emptyTotals(), spend_cents: 10000, leads: 20, appointments_booked: 5 };
    const m = Object.fromEntries(compareOptimisation(b, a).map((x) => [x.key, x]));
    expect(m.cost_per_lead_cents).toMatchObject({ before: 1000, after: 500, delta: -0.5, better: true });
    expect(m.booking_rate).toMatchObject({ before: 0.2, after: 0.25, better: true });
    expect(m.leads.delta).toBeNull();
    expect(compareOptimisation(b, null).every((x) => x.after === null)).toBe(true);
  });
});

describe('Optimisations : de bout en bout', () => {
  it('création, réécriture par le robot (même file), validation, mise en ligne, mesure, verdict « on garde »', async () => {
    const { call, raw } = boot();
    // Pas de pièce rédigée → refus.
    const early = await call(`/clients/${B}/optimisations`, { as: AGENCE, method: 'POST', body: { title: 'x', constat: 'c', hypothese: 'h', steps: ['s4'] } });
    expect(early.status).toBe(409);
    await chain(call);
    expect((await call(`/clients/${B}/optimisations`, { as: CLIENT_B, method: 'POST', body: {} })).status).toBe(403);
    const r = await call(`/clients/${B}/optimisations`, { as: AGENCE, method: 'POST', body: {
      title: 'Nouvelle vague axée coût du statu quo', constat: 'CPL en hausse de 40 % sur 14 jours.', hypothese: 'Des hooks sur le coût du statu quo baissent le CPL.',
      consigne: 'Trois angles nouveaux.', steps: ['s4', 's6'],
    } });
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as any;
    // Le client ne voit rien tant que ce n'est pas prêt.
    expect((await list(call, CLIENT_B)).items).toHaveLength(0);

    const items = await queue(call);
    const opt = items.filter((i: any) => i.step.includes('~'));
    expect(opt.map((i: any) => i.step)).toEqual([`s4~${id}`, `s6~${id}`]);
    expect(opt[0].clientName).toContain('optimisation « Nouvelle vague');

    const brief = (await (await call(`/robot/clients/${B}/delivery/s4~${id}/brief`, { headers: robotHeaders })).json()) as any;
    expect(brief.brief).toContain("## Consigne de reprise de l'agence (prioritaire)");
    expect(brief.brief).toContain('Hypothèse à tester : Des hooks sur le coût du statu quo');
    expect(brief.brief).toContain('## Version actuelle à reprendre');
    expect(brief.brief).toContain('Texte de s4.');
    expect(brief.brief).toContain('Optimisation « Nouvelle vague');
    expect(brief.brief).toContain('Chiffres de la semaine');

    for (const k of ['s4', 's6']) {
      expect((await call(`/robot/clients/${B}/delivery/${k}~${id}`, { method: 'PUT', headers: robotHeaders, body: { contentMd: `# ${k} optimisé` } })).status).toBe(200);
    }
    expect((await queue(call)).filter((i: any) => i.step.includes('~'))).toHaveLength(0);
    // Le delivery n'a pas bougé, rien n'est « à revoir ».
    const d = (await (await call(`/clients/${B}/delivery`, { as: AGENCE })).json()) as any;
    expect(d.steps.find((s: any) => s.key === 's4').contentMd).toContain('Texte de s4.');
    expect(d.steps.some((s: any) => s.stale)).toBe(false);

    // Mise en ligne refusée tant que tout n'est pas validé.
    expect((await call(`/clients/${B}/optimisations/${id}`, { as: AGENCE, method: 'PATCH', body: { launchedOn: '2026-01-01' } })).status).toBe(409);
    await call(`/clients/${B}/optimisations/${id}/pieces/s4`, { as: AGENCE, method: 'PATCH', body: { status: 'validee' } });
    let o = (await list(call)).items[0];
    expect(o.status).toBe('en_preparation');
    const v = await call(`/clients/${B}/optimisations/${id}/pieces/s6`, { as: AGENCE, method: 'PATCH', body: { status: 'validee' } });
    expect(((await v.json()) as any).status).toBe('prete');
    // Visible du client, avec les pièces validées.
    const cl = (await list(call, CLIENT_B)).items;
    expect(cl).toHaveLength(1);
    expect(cl[0].consigne).toBeNull();
    expect(cl[0].pieces[0].contentMd).toBe('# s4 optimisé');

    const launched = addDaysYmd(todayParis(), -14);
    expect((await call(`/clients/${B}/optimisations/${id}`, { as: AGENCE, method: 'PATCH', body: { launchedOn: launched } })).status).toBe(200);
    o = (await list(call)).items[0];
    expect(o.status).toBe('en_ligne');
    expect(o.measure.complete).toBe(true);
    expect(o.measure.metrics.map((m: any) => m.key)).toContain('cost_per_booked_cents');
    // Une pièce en ligne ne se modifie plus.
    expect((await call(`/clients/${B}/optimisations/${id}/pieces/s4`, { as: AGENCE, method: 'PATCH', body: { contentMd: 'autre' } })).status).toBe(409);

    expect((await call(`/clients/${B}/optimisations/${id}`, { as: AGENCE, method: 'PATCH', body: { verdict: 'garder', verdictNote: 'CPL en baisse.' } })).status).toBe(200);
    o = (await list(call, CLIENT_B)).items[0];
    expect(o).toMatchObject({ status: 'terminee', verdict: 'garder', verdictNote: 'CPL en baisse.' });
    const d2 = (await (await call(`/clients/${B}/delivery`, { as: AGENCE })).json()) as any;
    expect(d2.steps.find((s: any) => s.key === 's4')).toMatchObject({ contentMd: '# s4 optimisé', status: 'valide' });
    expect(d2.steps.some((s: any) => s.stale)).toBe(false);
    const dl = raw.prepare(`SELECT content_md FROM deliverables WHERE client_id = ? AND json_extract(generation_json, '$.delivery_step') = 's4'`).get(B) as any;
    expect(dl.content_md).toBe('# s4 optimisé');
  });

  it('verdict « on revient » : le delivery garde sa version ; abandon retire de la file', async () => {
    const { call } = boot();
    await chain(call);
    const mk = async (title: string) => ((await (await call(`/clients/${B}/optimisations`, { as: AGENCE, method: 'POST', body: { title, constat: 'c', hypothese: 'h', steps: ['s3'] } })).json()) as any).id;
    const id = await mk('Landing plus courte');
    await call(`/robot/clients/${B}/delivery/s3~${id}`, { method: 'PUT', headers: robotHeaders, body: { contentMd: 'landing courte' } });
    await call(`/clients/${B}/optimisations/${id}/pieces/s3`, { as: AGENCE, method: 'PATCH', body: { status: 'validee' } });
    await call(`/clients/${B}/optimisations/${id}`, { as: AGENCE, method: 'PATCH', body: { launchedOn: todayParis() } });
    expect((await call(`/clients/${B}/optimisations/${id}`, { as: AGENCE, method: 'PATCH', body: { verdict: 'revenir' } })).status).toBe(200);
    const d = (await (await call(`/clients/${B}/delivery`, { as: AGENCE })).json()) as any;
    expect(d.steps.find((s: any) => s.key === 's3').contentMd).toContain('Texte de s3.');

    const id2 = await mk('Autre test');
    expect((await queue(call)).some((i: any) => i.step === `s3~${id2}`)).toBe(true);
    await call(`/clients/${B}/optimisations/${id2}`, { as: AGENCE, method: 'PATCH', body: { abandon: true } });
    expect((await queue(call)).some((i: any) => i.step === `s3~${id2}`)).toBe(false);
    expect((await call(`/robot/clients/${B}/delivery/s3~${id2}/brief`, { headers: robotHeaders })).status).toBe(409);
  });

  it('reprise avec consigne et optimisation sur une verticale', async () => {
    const { call } = boot();
    await chain(call);
    const id = ((await (await call(`/clients/${B}/optimisations`, { as: AGENCE, method: 'POST', body: { title: 'Formulaire', constat: 'c', hypothese: 'h', steps: ['s6'] } })).json()) as any).id;
    await call(`/robot/clients/${B}/delivery/s6~${id}`, { method: 'PUT', headers: robotHeaders, body: { contentMd: 'v1' } });
    await call(`/clients/${B}/optimisations/${id}/pieces/s6`, { as: AGENCE, method: 'PATCH', body: { regenerate: true, instruction: 'Une question de qualification en plus.' } });
    const brief = (await (await call(`/robot/clients/${B}/delivery/s6~${id}/brief`, { headers: robotHeaders })).json()) as any;
    expect(brief.brief).toContain('Retour de l\'agence sur ta proposition précédente (prioritaire) : Une question de qualification en plus.');
    expect(brief.brief).toContain('v1');
    // Verticale sans pièce rédigée → refus.
    await call(`/agence/clients/${B}`, { as: AGENCE, method: 'PATCH', body: { verticalsEnabled: true } });
    const vt = ((await (await call(`/clients/${B}/delivery/verticales`, { as: AGENCE, method: 'POST', body: { name: 'V', avatar: 'A' } })).json()) as any).id;
    expect((await call(`/clients/${B}/optimisations`, { as: AGENCE, method: 'POST', body: { title: 't', constat: 'c', hypothese: 'h', steps: ['s4'], verticalId: vt } })).status).toBe(409);
  });
});
