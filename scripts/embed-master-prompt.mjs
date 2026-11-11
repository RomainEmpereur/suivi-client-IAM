// Intègre docs/delivery/master-prompt.md au code (packages/domain/src/generated/master-prompt.ts).
// À relancer après toute modification du master prompt : `node scripts/embed-master-prompt.mjs`.
// Un test vérifie que le fichier généré correspond au .md (aucune divergence silencieuse).
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const md = readFileSync(root + 'docs/delivery/master-prompt.md', 'utf8');
writeFileSync(root + 'packages/domain/src/generated/master-prompt.ts',
  '// Fichier généré par scripts/embed-master-prompt.mjs depuis docs/delivery/master-prompt.md — ne pas modifier.\n' +
  `export const MASTER_PROMPT = ${JSON.stringify(md)};\n`);
console.log('Master prompt intégré :', md.length, 'caractères');
