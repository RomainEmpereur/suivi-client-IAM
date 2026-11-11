import { describe, expect, it } from 'vitest';
import { createGhlClient, GhlError } from '../packages/ghl/src/index.ts';

describe('Client GoHighLevel', () => {
  it("n'expose aucune méthode d'écriture", () => {
    const c = createGhlClient({ token: 't', fetchImpl: (async () => new Response('{}')) as any });
    expect(Object.keys(c).sort()).toEqual(['calendars', 'events', 'location', 'opportunities', 'pipelines']);
  });

  it('envoie uniquement des GET avec la version d’API, et pagine les opportunités', async () => {
    const calls: { url: string; method: string; headers: any }[] = [];
    const page = (n: number, last: boolean) => ({
      opportunities: Array.from({ length: last ? 3 : 100 }, (_, i) => ({ id: `o${n}-${i}` })),
      meta: { total: 103, startAfter: 123, startAfterId: last ? undefined : 'cur' },
    });
    let i = 0;
    const c = createGhlClient({
      token: 'secret-de-test',
      fetchImpl: (async (url: string, init: any) => { calls.push({ url, method: init.method, headers: init.headers }); return new Response(JSON.stringify(page(i, i++ === 1))); }) as any,
    });
    const opps = await c.opportunities('loc', 'pipe');
    expect(opps).toHaveLength(103);
    expect(calls.every((x) => x.method === 'GET' && x.headers.Version === '2021-07-28')).toBe(true);
    expect(calls[1].url).toContain('startAfterId=cur');
  });

  it("réessaie sur 429 puis échoue proprement, sans divulguer le jeton", async () => {
    let n = 0;
    const c = createGhlClient({ token: 'secret-de-test', sleep: async () => {}, fetchImpl: (async () => { n++; return new Response('{}', { status: 429 }); }) as any });
    const err = await c.location('loc').catch((e) => e);
    expect(err).toBeInstanceOf(GhlError);
    expect(n).toBe(4);
    expect(String(err.message)).not.toContain('secret-de-test');
  });
});
