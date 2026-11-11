import app from '../../api/src/index.ts';
import { generateDemoSql } from '../../db/seed/generate.ts';
import { todayParis } from '../../packages/domain/src/index.ts';
import { createTestDb } from './d1.ts';

export const AGENCE = 'agence@obsidian.demo.local';
export const CLIENT_A = 'client@nordline.demo.local';
export const CLIENT_B = 'client@pilotis.demo.local';
export const A = 'cl_demo_nordline';
export const B = 'cl_demo_pilotis';

export function setup(envOverrides: Record<string, string> = {}) {
  const { d1, raw } = createTestDb(generateDemoSql(todayParis()));
  const env = { DB: d1, ENVIRONMENT: 'test', DEV_AUTH: '1', ...envOverrides };
  const call = (path: string, opts: { as?: string; view?: 'client'; method?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.as) headers['X-Dev-User'] = opts.as;
    if (opts.view) headers['X-View'] = opts.view;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    return app.request(`/api${path}`, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }, env);
  };
  return { call, raw, env };
}
