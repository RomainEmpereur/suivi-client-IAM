# 0016 — Delivery : offre sans ajouts, visuels de la VSL, design des landings, scripts d'ads

**Statut :** acceptée (Romain, 12 nov. 2026), après relecture du test DAVAI.AI.

## Décision (master prompt modifié)
- **Bonus, garantie, rareté, urgence** : uniquement ce que le client mentionne dans son onboarding, repris tel qu'il le formule.
  Aucun bonus « à créer », aucune garantie « recommandée », aucune échéance ni limite de places inventée (règle d'or 9, étape 1B,
  garde-fous). La page client (1C) suit l'offre ainsi corrigée, sans changer de structure.
- **VSL** : nouvelle sortie « Visuels de la VSL », une maquette animée en HTML autonome (bloc ```html video), une scène par beat
  calée sur les timecodes, avec lecture / pause et barre de progression. L'espace l'affiche comme un lecteur 16:9.
- **Landing** : règles de design explicites contre le rendu générique (« AI slop ») ; code livré en bloc ```html page, affiché en
  aperçu dans l'espace. Des landings de référence fournies par l'agence fixent le niveau de finition.
- **Scripts d'ads** : en paragraphes (pas de tableau), une minute au plus ; le CTA n'est pas la prise de rendez-vous mais la
  découverte du système dans la présentation vidéo complète (la publicité envoie vers le tunnel de vente) ; bouton « En savoir plus ».
- Chaque brief joint désormais les règles d'or et les garde-fous du master prompt, en plus des consignes de l'étape.

## Affichage
Les blocs ```html des livrables s'affichent dans une iframe isolée (`sandbox="allow-scripts"`, sans `allow-same-origin` :
origine opaque, aucun accès à l'espace, à ses cookies ni à son API), avec le code source dépliable.
