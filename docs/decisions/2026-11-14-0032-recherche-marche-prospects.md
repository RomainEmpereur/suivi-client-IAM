# 0032 — Prospects : recherche marché rédigée par Claude, plan appuyé sur le tunnel des SaaS

Date : 2026-11-14 · acceptée (Romain).

## Contexte
À l'étape « Plan et Loom », la recherche marché était un champ à coller à la main. Romain veut que Claude la génère, puis que le
mini plan d'action s'appuie dessus et sur le tunnel de vente qu'Obsidian Partners installe chez ses clients SaaS.

## Décision
- Nouveau document « Recherche marché » (type `recherche`, migration 0025 qui élargit la contrainte de `prospect_documents.type`),
  entre l'analyse et le plan : bouton « Générer la recherche marché », même file robot (`pr~recherche`), prompt
  `docs/prospects/prompts/recherche.md` (site du prospect, 3 à 5 concurrents, leurs publicités Meta en lecture seule, langage de la
  cible avec sources, statistiques sourcées, espace libre, synthèse ; une source inaccessible se dit). Brouillon, puis validation.
- Le plan exige une recherche validée, ou des notes collées par Romain (le champ devient « vos notes ou compléments », pris en
  compte pour la recherche et le plan). Son brief joint la recherche validée et le « contexte du tunnel de vente des SaaS ».
- Contexte du tunnel : texte par défaut dans le code (`DEFAULT_TUNNEL_CONTEXT`, tiré de la méthode exposée par Romain : verticale,
  offre, pub vidéo, formulaire instantané, VSL et calendrier, pilotage au coût par rendez-vous, lancement prudent), modifiable dans
  les réglages Prospects (`agency_settings.prospects_contexte_tunnel`). Joint aux briefs du plan, du script du Loom et du pitch R2.
- « Annuler » retire de la file une rédaction pas encore commencée (la version validée n'est pas touchée).
