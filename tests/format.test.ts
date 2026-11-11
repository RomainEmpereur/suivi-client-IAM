import { describe, expect, it } from 'vitest';
import { formatDate, formatDelta, formatEuros, formatInt, formatPercent, verdict } from '../packages/domain/src/index.ts';

describe('Formats français', () => {
  it('euros : espace fine pour les milliers, espace avant €', () => {
    expect(formatEuros(175500)).toBe('1 755 €');
    expect(formatEuros(6400)).toBe('64,00 €');
  });
  it("une absence de mesure s'affiche « — », jamais 0", () => {
    expect(formatEuros(null)).toBe('—');
    expect(formatInt(undefined)).toBe('—');
    expect(formatPercent(null)).toBe('—');
    expect(formatDelta(null)).toBe('—');
  });
  it('pourcentages et variations', () => {
    expect(formatPercent(0.0183)).toBe('1,8 %');
    expect(formatDelta(0.124)).toBe('+12 %');
    expect(formatDelta(-0.05)).toBe('−5 %');
  });
  it('dates abrégées', () => {
    expect(formatDate('2026-11-12')).toBe('12 nov. 2026');
  });
  it('verdicts de seuil', () => {
    expect(verdict(1200, 1500, 'max')).toBe('tenu');
    expect(verdict(1700, 1500, 'max')).toBe('surveiller');
    expect(verdict(2500, 1500, 'max')).toBe('corriger');
    expect(verdict(null, 1500, 'max')).toBe('non_mesure');
  });
});
