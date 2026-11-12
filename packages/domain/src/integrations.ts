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
