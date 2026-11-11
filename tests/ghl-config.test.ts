import { describe, expect, it } from 'vitest';
import { resolveGhlConfig } from '../packages/domain/src/index.ts';
import { encryptToken } from '../api/src/crypto.ts';
import { runGhlForClient } from '../jobs/sync-daily/src/run.ts';
import { createTestDb } from './helpers/d1.ts';

const pipelines = [
  { id: 'pm', name: '1. Sales Pipeline - Militaires', stages: [{ id: 'm1', name: 'Strategy Session Booked', position: 0 }, { id: 'm2', name: 'Deal Closed', position: 1 }, { id: 'm3', name: 'No Show', position: 2 }] },
  { id: 'pe', name: '5. Sales Pipeline - Entreprises', stages: [{ id: 'e1', name: 'Audit planifié entreprises', position: 0 }, { id: 'e2', name: 'Deal Closed', position: 1 }] },
  { id: 'px', name: '2. Hiring Pipeline', stages: [{ id: 'x1', name: 'Hired', position: 0 }] },
];

describe('Réglage GHL par noms', () => {
  it('résout pipelines et étapes, y compris une même étape présente dans deux pipelines', () => {
    const c = resolveGhlConfig({
      locationId: 'loc', pipelineNames: ['1. Sales Pipeline - Militaires', '5. sales pipeline - entreprises'],
      postCallStageNames: ['Deal Closed'], noShowStageNames: ['No Show'], wonStageNames: ['Deal Closed'],
    }, pipelines);
    expect(c.pipelineIds).toEqual(['pm', 'pe']);
    expect(c.displayPipelineIds).toEqual(['pm', 'pe']);
    expect(c.postCallStageIds.sort()).toEqual(['e2', 'm2']);
    expect(c.noShowStageIds).toEqual(['m3']);
  });
  it('un nom inconnu bloque avec la liste des noms disponibles', () => {
    expect(() => resolveGhlConfig({ locationId: 'l', pipelineNames: ['Pipeline fantôme'], postCallStageNames: [], noShowStageNames: [], wonStageNames: [] }, pipelines))
      .toThrow(/introuvable.*Hiring Pipeline/);
    expect(() => resolveGhlConfig({ locationId: 'l', pipelineNames: ['2. Hiring Pipeline'], postCallStageNames: ['Deal Closed'], noShowStageNames: [], wonStageNames: [] }, pipelines))
      .toThrow(/Étape GHL introuvable/);
  });
});

describe('Synchronisation complète (jeton chiffré, réglage par noms, deux pipelines)', () => {
  it('affiche les deux pipelines et retire les indicateurs CRM des mesures non synchronisées', async () => {
    const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const { d1, raw } = createTestDb();
    raw.exec(`INSERT INTO clients (id, name, slug, unmeasured_json, ghl_config_json) VALUES ('cl', 'Civex', 'civex',
      '["crm_contacts","appointments_booked","appointments_held","sales","cash_collected_cents"]',
      '${JSON.stringify({ pipelineNames: ['1. Sales Pipeline - Militaires', '5. Sales Pipeline - Entreprises'], postCallStageNames: ['Deal Closed'], noShowStageNames: ['No Show'], wonStageNames: ['Deal Closed'] })}')`);
    raw.prepare(`INSERT INTO connections (id, client_id, type, external_id, token_ciphertext) VALUES ('cn', 'cl', 'ghl', 'loc', ?)`).run(await encryptToken('pit-test', key));
    const urls: string[] = [];
    const fake = (async (url: string, init: any) => {
      urls.push(url);
      expect(init.headers.Authorization).toBe('Bearer pit-test');
      const u = new URL(url);
      const body = u.pathname === '/opportunities/pipelines' ? { pipelines }
        : u.pathname === '/calendars/' ? { calendars: [{ id: 'cal1', name: 'Démo' }] }
        : u.pathname === '/calendars/events' ? { events: [] }
        : u.pathname === '/opportunities/search' ? { opportunities: [{ id: 'o-' + u.searchParams.get('pipeline_id'), contactId: 'c-' + u.searchParams.get('pipeline_id'), pipelineId: u.searchParams.get('pipeline_id'), pipelineStageId: u.searchParams.get('pipeline_id') === 'pm' ? 'm1' : 'e1', status: 'open', createdAt: '2026-11-02T10:00:00Z' }], meta: { total: 1 } }
        : {};
      return new Response(JSON.stringify(body));
    }) as unknown as typeof fetch;
    const r = await runGhlForClient({ DB: d1, TOKEN_ENCRYPTION_KEY: key }, 'cl', { from: '2026-10-01', to: '2026-11-10', fetchImpl: fake });
    expect(r.ok).toBe(true);
    expect(urls.some((u) => u.includes('/calendars/events') && u.includes('calendarId=cal1'))).toBe(true); // tous les calendriers
    const pipe = raw.prepare('SELECT pipeline_name, stage_name, open_opportunities FROM pipeline_snapshot ORDER BY stage_order').all();
    expect(pipe.map((p: any) => p.pipeline_name)).toEqual(['1. Sales Pipeline - Militaires', '1. Sales Pipeline - Militaires', '1. Sales Pipeline - Militaires', '5. Sales Pipeline - Entreprises', '5. Sales Pipeline - Entreprises']);
    expect(JSON.parse((raw.prepare(`SELECT unmeasured_json j FROM clients WHERE id = 'cl'`).get() as any).j)).toEqual(['cash_collected_cents']);
    expect((raw.prepare(`SELECT state FROM connections WHERE id = 'cn'`).get() as any).state).toBe('ok');
  });
});
