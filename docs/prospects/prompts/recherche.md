# Recherche marché

À partir de l'analyse post-R1 **validée** (logiciel, cible, marchés, concurrents cités, objections) et du site du prospect, tu fais une vraie recherche, avec tes outils, puis tu rends ce que tu as trouvé. Elle sert ensuite au mini plan d'action.

1. **Le site du prospect** (WebFetch, ou l'agent web-fetch) : sa promesse, ses preuves, son ton, les verticales qu'il sert déjà.
2. **Trois à cinq concurrents ou alternatives** que sa cible utilise : ceux cités en R1 d'abord, puis ceux que tu trouves (catégories G2 ou Capterra, recherches « alternative à »). Pour chacun : son site et sa promesse.
3. **Leurs publicités Meta** : bibliothèque publicitaire (`ads_library_search`, **lecture seule**), sur les pays où le prospect vend. Pour chaque concurrent : publicités actives ou non, angles, formats, date de la plus ancienne encore active, et les liens. La bibliothèque ne donne aucune dépense : nombre et ancienneté sont des indices, jamais des mesures de performance.
4. **Le langage de la cible** : cinq à dix citations réelles (avis G2 ou Capterra des concurrents, forums du métier), chacune avec l'adresse de la page où tu l'as lue.
5. **Deux ou trois statistiques sectorielles**, chacune avec sa source. Sans source : n'écris rien.
6. **L'espace libre** : ce que personne ne dit encore à cette cible, et l'angle que tu prendrais.

Une source inaccessible se dit (« bibliothèque publicitaire inaccessible », « avis G2 non lisibles »), elle ne s'invente jamais. Aucun prix, aucun chiffre sans source.

{{REGLES}}

```json
{
  "site": { "url": "…", "promesse": "…", "preuves": ["…"], "ton": "…", "verticalesServies": ["…"] },
  "concurrents": [
    { "nom": "…", "url": "…", "promesse": "…", "pourquoi": "cité en R1 / trouvé sur G2…",
      "publicitesMeta": { "actives": true, "angles": ["…"], "formats": ["vidéo", "image"], "plusAncienneActive": "AAAA-MM-JJ ou null", "liens": ["https://www.facebook.com/ads/library/?id=…"] } }
  ],
  "langageCible": [ { "citation": "texte exact lu", "source": "https://…" } ],
  "stats": [ { "chiffre": "…", "source": "https://…" } ],
  "espaceLibre": "…",
  "synthese": "cinq à huit phrases : le marché, ce que font les concurrents, l'angle libre, ce qui en découle pour le plan",
  "sourcesInaccessibles": ["…"]
}
```
