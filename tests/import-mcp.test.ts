import { describe, expect, it } from 'vitest';
import { createTestDb } from './helpers/d1.ts';

/** Le ré-import (même requête que scripts/import-mcp.ts) ne doit jamais écraser un statut posé par l'agence. */
const upsert = (status: string) => `INSERT INTO appointments (id, client_id, ghl_appointment_id, contact_name, booked_at, scheduled_at, status, counts_toward_target, exclusion_reason)
  VALUES ('ap_x', 'cl_t', 'g1', 'A. B.', '2026-10-01T10:00:00Z', '2026-10-02T10:00:00Z', '${status}', 1, NULL)
  ON CONFLICT (client_id, ghl_appointment_id) DO UPDATE SET
    status = CASE WHEN appointments.status_source = 'agence' THEN appointments.status ELSE excluded.status END,
    counts_toward_target = CASE WHEN appointments.status_source = 'agence' THEN appointments.counts_toward_target ELSE excluded.counts_toward_target END,
    exclusion_reason = CASE WHEN appointments.status_source = 'agence' THEN appointments.exclusion_reason ELSE excluded.exclusion_reason END;`;

describe('Ré-import des rendez-vous', () => {
  it('met à jour un statut GHL mais conserve un statut agence', () => {
    const { raw } = createTestDb();
    raw.exec(`INSERT INTO clients (id, name, slug) VALUES ('cl_t', 'T', 't')`);
    raw.exec(upsert('prevu'));
    raw.exec(upsert('absent'));
    expect((raw.prepare(`SELECT status FROM appointments WHERE id = 'ap_x'`).get() as any).status).toBe('absent');
    raw.exec(`UPDATE appointments SET status = 'honore', status_source = 'agence' WHERE id = 'ap_x'`);
    raw.exec(upsert('prevu'));
    expect((raw.prepare(`SELECT status FROM appointments WHERE id = 'ap_x'`).get() as any).status).toBe('honore');
  });
});
