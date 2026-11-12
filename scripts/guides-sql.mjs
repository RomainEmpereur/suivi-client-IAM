// Génère le SQL d'import des guides rédigés (docs/guides/*.md) en BROUILLON (published = 0).
// N'écrase jamais un guide existant (INSERT OR IGNORE) : une fois dans l'espace, le guide s'édite dans « Guides (rédaction) ».
// Usage : node scripts/guides-sql.mjs > guides.sql
import { readFileSync } from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const GUIDES = [
  ['gd_meta_setup', 'Configurer votre Meta Business Manager', 10, 'docs/guides/1-setup-meta.md'],
  ['gd_ghl_navigation', 'Naviguer dans GoHighLevel', 20, 'docs/guides/2-naviguer-gohighlevel.md'],
  ['gd_espace_client', "Utiliser votre espace client", 30, 'docs/guides/3-espace-client.md'],
  ['gd_meta_personne', 'Ajouter Obsidian Partners comme personne dans Meta', 40, 'docs/guides/4-ajouter-obsidian-personne-meta.md'],
];
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
for (const [id, title, order, file] of GUIDES) {
  const body = readFileSync(root + file, 'utf8').trim();
  console.log(`INSERT OR IGNORE INTO guides (id, client_id, title, kind, body_md, sort_order, published) VALUES (${q(id)}, NULL, ${q(title)}, 'page', ${q(body)}, ${order}, 0);`);
}
