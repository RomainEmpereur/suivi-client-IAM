import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DELIVERY_STEPS, MASTER_PROMPT, deliveryGate, stepAvailability, stepInstructions, validationBlocker } from '../packages/domain/src/index.ts';

describe('Master prompt intégré', () => {
  it('le fichier généré correspond exactement au .md versionné', () => {
    expect(MASTER_PROMPT).toBe(readFileSync(resolve(__dirname, '../docs/delivery/master-prompt.md'), 'utf8'));
  });
  it('chaque étape retrouve sa section, sans déborder sur la suivante', () => {
    for (const s of DELIVERY_STEPS) expect(stepInstructions(s).length).toBeGreaterThan(200);
    const s1a = stepInstructions(DELIVERY_STEPS.find((s) => s.key === 's1a')!);
    expect(s1a).toContain('bibliothèque publicitaire Meta');
    expect(s1a).not.toContain('1B ·');
    const s2 = stepInstructions(DELIVERY_STEPS.find((s) => s.key === 's2')!);
    expect(s2).toContain('Les 8 blocs');
    expect(s2).not.toContain('Étape 3');
  });
});

describe('Conditions de lancement', () => {
  it("bloque tant que l'onboarding n'est pas envoyé et liste les infos manquantes", () => {
    const g = deliveryGate(null, { q01: 'x' });
    expect(g.ok).toBe(false);
    expect(g.missing).toContain("Formulaire d'onboarding envoyé");
    expect(g.missing).toContain('Histoire du fondateur');
  });
  it('ouvre toutes les étapes une fois les conditions remplies ; la VSL ne se valide pas sans mécanisme', () => {
    expect(stepAvailability('s5', { gateOk: true }).available).toBe(true);
    expect(stepAvailability('s0', { gateOk: false }).available).toBe(false);
    const vsl = DELIVERY_STEPS.find((s) => s.key === 's2')!;
    expect(validationBlocker(vsl, { hasContent: true, mechanism: null, stale: false })).toMatch(/mécanisme/);
    expect(validationBlocker(vsl, { hasContent: true, mechanism: 'X', stale: true })).toMatch(/amont/);
    expect(validationBlocker(vsl, { hasContent: false, mechanism: 'X', stale: false })).toMatch(/contenu/);
    expect(validationBlocker(vsl, { hasContent: true, mechanism: 'X', stale: false })).toBeNull();
  });
});
