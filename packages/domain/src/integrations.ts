/**
 * Intégrations de la landing (décision 0017) : la landing livrée contient deux zones balisées
 *   <!-- OBSIDIAN:VSL:DEBUT --> … maquette du lecteur … <!-- OBSIDIAN:VSL:FIN -->
 *   <!-- OBSIDIAN:CALENDRIER:DEBUT --> … maquette du calendrier … <!-- OBSIDIAN:CALENDRIER:FIN -->
 * L'agence fournit ensuite le code d'intégration Wistia et celui du calendrier GoHighLevel ; l'espace remplace le contenu
 * de chaque zone (repères conservés), de façon déterministe : aucune régénération, le design ne bouge pas.
 */
export type IntegrationKey = 'vsl' | 'calendrier';
export const INTEGRATIONS: { key: IntegrationKey; marker: string; label: string; hint: string }[] = [
  { key: 'vsl', marker: 'VSL', label: 'Code d\'intégration Wistia (VSL)', hint: 'Wistia › la vidéo › Embed & Share › Inline › copier le code.' },
  { key: 'calendrier', marker: 'CALENDRIER', label: 'Code d\'intégration du calendrier GoHighLevel', hint: 'GoHighLevel › Calendriers › le calendrier › Partager › Intégrer › copier le code.' },
];

export interface Integrations { vsl?: string | null; calendrier?: string | null }

const zone = (marker: string) => new RegExp(`(<!--\\s*OBSIDIAN:${marker}:DEBUT\\s*-->)[\\s\\S]*?(<!--\\s*OBSIDIAN:${marker}:FIN\\s*-->)`, 'g');

/** Repères présents dans la page (pour signaler une landing livrée sans eux). */
export function integrationMarkers(html: string): Record<IntegrationKey, boolean> {
  return Object.fromEntries(INTEGRATIONS.map((i) => [i.key, zone(i.marker).test(html)])) as Record<IntegrationKey, boolean>;
}

/** Page finale : chaque zone balisée reçoit le code fourni ; sans code, la maquette reste en place. */
export function applyIntegrations(html: string, codes: Integrations): { html: string; applied: IntegrationKey[]; missingMarkers: IntegrationKey[] } {
  let out = html;
  const applied: IntegrationKey[] = [];
  const missingMarkers: IntegrationKey[] = [];
  for (const i of INTEGRATIONS) {
    const code = codes[i.key]?.trim();
    if (!zone(i.marker).test(out)) { missingMarkers.push(i.key); continue; }
    if (!code) continue;
    // Fonction de remplacement : aucun motif « $& » du code fourni n'est interprété.
    out = out.replace(zone(i.marker), (_m, a: string, b: string) => `${a}\n${code}\n${b}`);
    applied.push(i.key);
  }
  return { html: out, applied, missingMarkers };
}

/**
 * Code prêt à coller dans l'élément « Code personnalisé » (Custom JS/HTML) d'une page GoHighLevel :
 * l'élément attend un fragment, pas un document complet. On garde les feuilles et polices du <head> (link, style),
 * le contenu du <body> et ses scripts ; on retire doctype, html, head, body, title et les meta (gérés par GHL).
 * Les attributs class / style du <body> d'origine sont reportés sur un conteneur.
 */
export function ghlSnippet(html: string): string {
  const src = html.replace(/<!doctype[^>]*>/i, '').trim();
  const head = src.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';
  const bodyMatch = src.match(/<body\b([^>]*)>([\s\S]*)<\/body>/i);
  if (!bodyMatch && !/<html\b/i.test(src)) return src; // déjà un fragment
  // Les règles CSS écrites pour html / body visent désormais le conteneur, pour ne pas toucher au reste de la page GHL.
  const scope = (css: string) => css.replace(/(^|[\s,}>~+(])(html|body)(?=[\s,{.:#[>~+)])/g, '$1.obsidian-landing');
  const keep = (head.match(/<link\b[^>]*>|<style\b[\s\S]*?<\/style>|<script\b[\s\S]*?<\/script>/gi) ?? [])
    .filter((t) => !/<link\b[^>]*rel=["']?(icon|canonical|manifest)/i.test(t))
    .map((t) => (/^<style/i.test(t) ? t.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/i, (_m, a: string, b: string, c: string) => a + scope(b) + c) : t));
  const bodyAttrs = bodyMatch?.[1] ?? '';
  const cls = bodyAttrs.match(/\sclass=(?:"([^"]*)"|'([^']*)')/i);
  const sty = bodyAttrs.match(/\sstyle=(?:"[^"]*"|'[^']*')/i)?.[0] ?? '';
  const body = bodyMatch?.[2] ?? src.replace(/<\/?html\b[^>]*>/gi, '').replace(/<head\b[\s\S]*?<\/head>/i, '');
  return [
    '<!-- Code généré par l\'espace Obsidian Partners : à coller dans un élément « Code personnalisé » GoHighLevel, section pleine largeur sans marges. -->',
    ...keep,
    `<div class="obsidian-landing${cls ? ` ${cls[1] ?? cls[2]}` : ''}"${sty}>`,
    body.trim(),
    '</div>',
  ].join('\n');
}
