// Intègre l'interface compilée (web/dist) dans le Worker : un seul script à déployer, aucun upload d'assets séparé.
// Produit api/src/generated/web-assets.ts (ignoré par git, régénéré à chaque build).
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'web', 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.png': 'image/png', '.woff2': 'font/woff2' };
const TEXT = new Set(['.html', '.js', '.css', '.svg', '.json', '.txt']);

const files = {};
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    const ext = extname(name);
    const buf = readFileSync(p);
    files['/' + relative(dist, p).split('\\').join('/')] = TEXT.has(ext)
      ? { type: TYPES[ext], body: buf.toString('utf8') }
      : { type: TYPES[ext] ?? 'application/octet-stream', base64: buf.toString('base64') };
  }
})(dist);

if (!files['/index.html']) { console.error('web/dist/index.html introuvable : lancer `npm run build -w web` avant.'); process.exit(1); }
mkdirSync(join(root, 'api', 'src', 'generated'), { recursive: true });
writeFileSync(join(root, 'api', 'src', 'generated', 'web-assets.ts'),
  '// Fichier généré par scripts/embed-web.mjs — ne pas modifier.\n' +
  'export const WEB_ASSETS: Record<string, { type: string; body?: string; base64?: string }> = ' + JSON.stringify(files) + ';\n');
console.log(`${Object.keys(files).length} fichiers intégrés au Worker.`);
