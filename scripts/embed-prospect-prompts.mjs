// Intègre les prompts du module Prospects (docs/prospects/prompts/*.md) au code (packages/domain/src/generated/prospect-prompts.ts).
// À relancer après toute modification d'un prompt : `node scripts/embed-prospect-prompts.mjs`.
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url).pathname;
const dir = root + 'docs/prospects/prompts/';
const rules = readFileSync(dir + '_regles.md', 'utf8').trim();
const out = {};
for (const t of ['analyse', 'plan', 'script_loom', 'pitch_r2']) out[t] = readFileSync(dir + t + '.md', 'utf8').replace('{{REGLES}}', rules).trim() + '\n';
writeFileSync(root + 'packages/domain/src/generated/prospect-prompts.ts',
  '// Fichier généré par scripts/embed-prospect-prompts.mjs depuis docs/prospects/prompts/ — ne pas modifier.\n' +
  `export const PROSPECT_PROMPTS = ${JSON.stringify(out, null, 2)} as const;\n`);
console.log('ok');
