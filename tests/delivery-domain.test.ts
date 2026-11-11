import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DELIVERY_STEPS, MASTER_PROMPT, deliveryGate, stepAvailability, stepInstructions } from '../packages/domain/src/index.ts';

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
  it('enchaîne les étapes et exige le mécanisme à partir de la VSL', () => {
    const v = new Set(['s0', 's1a', 's1b', 's1c']);
    expect(stepAvailability('s1a', { gateOk: true, mechanism: null, validated: new Set() }).available).toBe(false);
    expect(stepAvailability('s2', { gateOk: true, mechanism: null, validated: v }).reason).toMatch(/mécanisme/);
    expect(stepAvailability('s2', { gateOk: true, mechanism: 'Le Système X', validated: v }).available).toBe(true);
    expect(stepAvailability('s0', { gateOk: false, mechanism: null, validated: new Set() }).available).toBe(false);
  });
});
