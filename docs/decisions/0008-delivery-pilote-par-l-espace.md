# 0008 — Delivery piloté par l'espace, rédaction dans le projet Claude

**Statut :** acceptée (Romain, 11 nov. 2026)

## Contexte
Chaque livrable client suit le master prompt de delivery (`docs/delivery/master-prompt.md`) : étapes 0 à 8, dans l'ordre,
chaque pièce validée avant la suivante, mécanisme nommé verrouillé à l'étape 1C. Le delivery ne se lance que lorsque
le formulaire d'onboarding est rempli et que les infos de base sont données.

## Décision
- **La rédaction se fait dans le projet Claude de delivery** (master prompt en instructions). L'espace n'appelle aucun modèle
  et n'envoie rien à un service externe.
- **L'espace pilote** (écran « Delivery », agence uniquement, vue agence) :
  - conditions de lancement : onboarding envoyé + infos de base du §14 (entreprise, site, histoire du fondateur, ticket, durée de vie,
    closing, capacité de rendez-vous, garantie, concurrents, client idéal, marchés) — `deliveryGate` dans `packages/domain/src/delivery.ts` ;
  - **ressources non bloquantes** : le dossier Drive du client est cité dans le brief s'il existe, sinon on avance sans ;
  - enchaînement : une étape s'ouvre quand la précédente est validée ; la VSL et la suite attendent le nom du mécanisme (1C) ;
    le mécanisme est verrouillé dès qu'une étape aval a démarré ; on ne rouvre une étape que si la suivante n'a pas démarré ;
  - brief à copier par étape : section du master prompt + dossier client (réponses d'onboarding, site, Drive) + liens des étapes
    validées en amont ; l'étape 8 ajoute les chiffres de la semaine contre la précédente (depuis `metrics_rollup`, « — » si absents) ;
  - valider exige un lien https du document ; une pièce client validée (1C, 2 à 7) crée une fiche livrable **non publiée**
    (`origin = 'genere'`), que l'agence publie au client d'un clic (« à relire »).
- Le master prompt est intégré au code par `scripts/embed-master-prompt.mjs` ; un test vérifie qu'il est identique au `.md`.
- Migration 0008 : table `delivery_steps`, colonne `clients.delivery_mechanism`.

## Conséquences
- Les clients repris avant l'espace n'ont pas d'onboarding dans l'espace : leur delivery reste fermé tant qu'il n'est pas rempli.
- Modifier le master prompt : éditer le `.md`, relancer le script d'intégration, redéployer.
