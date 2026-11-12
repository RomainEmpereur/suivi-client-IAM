# 0018 — Étape 9 du delivery : tracking et connexions

**Statut :** acceptée (Romain, 12 nov. 2026).

## Besoin
Le suivi Meta ↔ GoHighLevel doit être posé de la même façon pour chaque client :
- un pixel par client avec deux évènements, Lead et Rendez-vous réservé ;
- l'origine de chaque lead (campagne, ensemble, publicité, formulaire) ;
- les réponses du formulaire Meta dans des champs personnalisés GHL, visibles sur la carte du prospect dans le pipeline.

Et rien ne se lance tant que les connexions ne sont pas opérationnelles.

## Décision
- Nouvelle étape `s9` « 9 · Tracking et connexions », en fin de chaîne (après l'étape 7), section 12 du master prompt.
  Elle est mise en file par « Lancer le delivery » comme les étapes 0 à 7. Le point hebdomadaire (8) reste récurrent.
- Document interne, aucun livrable client. Le pixel se crée à la main ; aucun workflow GHL ajouté, ceux du snapshot suffisent.
  L'étape écrit les champs personnalisés (dossier « Qualification Meta »), le mapping de l'intégration Facebook,
  les champs affichés sur la carte de l'opportunité et la vérification des connexions avant lancement.
- Le brief de l'étape 9 joint l'état des connexions de l'espace (table `connections`, sans jeton).
- L'étape 9 ne se valide que si les connexions Meta et GHL de l'espace sont « ok » (`CONNECTIONS_REQUIRED_BEFORE_LAUNCH`).
  Les autres lignes (pixel, formulaire, calendrier, domaine, emails, master tracker) se cochent à la main par l'agence.
- Les sections suivantes du master prompt sont renumérotées : Conventions 13, Garde-fous 14, Démarrer 15.
