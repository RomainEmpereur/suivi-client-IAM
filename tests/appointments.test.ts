import { describe, expect, it } from 'vitest';
import { computeAppointmentCounter, isValidatedAppointment, type AppointmentLike } from '../packages/domain/src/index.ts';

const client = { campaigns_launched_at: '2026-09-01', appointment_target: 30, window_days: 90 };
const at = (ymd: string, h = 10) => `${ymd}T${String(h).padStart(2, '0')}:00:00Z`;
const appt = (scheduled: string, status: AppointmentLike['status'], counts = 1): AppointmentLike =>
  ({ scheduled_at: scheduled, status, counts_toward_target: counts });

describe('Rendez-vous validé (définition unique)', () => {
  it('honoré et non exclu → validé', () => expect(isValidatedAppointment(appt(at('2026-09-02'), 'honore'))).toBe(true));
  it('annulé, absent, prévu → non validé', () => {
    for (const s of ['annule', 'absent', 'prevu'] as const) expect(isValidatedAppointment(appt(at('2026-09-02'), s))).toBe(false);
  });
  it('marqué hors cible → non validé', () => expect(isValidatedAppointment(appt(at('2026-09-02'), 'honore', 0))).toBe(false));
});

describe('Compteur contractuel', () => {
  const now = new Date('2026-10-01T12:00:00Z'); // J+30

  it('compte uniquement les validés tenus dans la fenêtre', () => {
    const list = [
      appt(at('2026-08-31'), 'honore'), // avant la fenêtre
      appt(at('2026-09-01', 8), 'honore'), // 1er jour (10 h Paris)
      appt(at('2026-09-15'), 'honore'),
      appt(at('2026-09-16'), 'honore', 0), // exclu
      appt(at('2026-09-17'), 'annule'),
      appt(at('2026-09-18'), 'absent'),
      appt(at('2026-09-29'), 'prevu'), // passé sans statut
      appt(at('2026-10-05'), 'prevu'), // à venir
      appt(at('2026-11-30', 22), 'honore'), // après la fin (fenêtre jusqu'au 30 nov. exclu)
    ];
    const c = computeAppointmentCounter(client, list, now);
    expect(c.validated).toBe(2);
    expect(c.excluded).toBe(1);
    expect(c.pendingStatus).toBe(1);
    expect(c.upcoming).toBe(1);
    expect(c.windowEnd).toBe('2026-11-30');
    expect(c.daysElapsed).toBe(30);
    expect(c.daysRemaining).toBe(60);
    expect(c.expectedByNow).toBe(10);
    expect(c.onPace).toBe(false);
  });

  it("borne de fenêtre au fuseau de Paris : 31 août 23 h 30 Paris n'est pas dans la fenêtre", () => {
    // 31 août 23 h 30 Paris = 21 h 30 UTC ; 1er sept. 00 h 30 Paris = 31 août 22 h 30 UTC
    const c = computeAppointmentCounter(client, [
      appt('2026-08-31T21:30:00Z', 'honore'),
      appt('2026-08-31T22:30:00Z', 'honore'),
    ], now);
    expect(c.validated).toBe(1);
  });

  it('avant le lancement : pas de compteur', () => {
    const c = computeAppointmentCounter({ ...client, campaigns_launched_at: null }, [appt(at('2026-09-02'), 'honore')], now);
    expect(c.started).toBe(false);
    expect(c.validated).toBe(0);
  });
});
