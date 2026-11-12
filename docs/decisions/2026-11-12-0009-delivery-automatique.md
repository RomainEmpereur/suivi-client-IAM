# 0009 — Delivery automatique : Claude rédige toute la chaîne, l'agence valide chaque pièce

**Statut :** acceptée (Romain, 12 nov. 2026). Complète la décision 0008 et modifie le §3 du cahier des charges
(« rien n'est généré en v1 ») sur un point : la rédaction reste faite par Claude **à côté de l'espace**, mais elle est déclenchée
depuis l'espace et son résultat y est déposé.

## Contexte
Romain veut qu'une fois l'onboarding rempli, Claude produise toute l'infrastructure (recherche, offre, VSL, landing, ads, séquences,
formulaire, campagne), puis relire et valider chaque pièce lui-même ; chaque pièce validée doit apparaître dans l'espace du client.
Contrainte : ne pas payer de clé API Anthropic.

## Décision
- **Rédaction par une tâche planifiée Claude Code** sur l'abonnement de l'agence (pas de clé API, aucun modèle appelé par le Worker).
  Elle a accès aux connecteurs de l'agence (bibliothèque publicitaire Meta pour 1A) et à ses skills.
- **Lancement** : bouton « Lancer le delivery » (conditions de la décision 0008 inchangées) → étapes 0 à 7 en file.
  La tâche les rédige dans l'ordre ; chaque étape reçoit les pièces précédentes (brouillons compris) et le master prompt complet.
- **Mécanisme nommé** : Claude propose les trois noms et retient celui qu'il recommande ; l'agence peut le changer à la relecture.
- **Relecture** : l'agence lit, modifie (nouvelle version), ou fait reprendre une pièce avec une consigne. Toutes les versions sont gardées
  (`delivery_versions`). Une pièce amont modifiée (ou le mécanisme) fait passer les pièces aval « à revoir » : refaire ou garder tel quel.
- **Validation = publication** pour les pièces client (1C, 2 à 7) : le livrable apparaît aussitôt, mis en page, dans l'espace du client.
  Une pièce validée puis modifiée repasse « à valider » ; le client garde la version publiée jusqu'à la revalidation (« mis à jour »).
- **Accès de la tâche** : routes `/api/robot/*`, clé `DELIVERY_ROBOT_TOKEN` (secret Worker saisi par Romain), application Access
  « bypass » limitée à ce chemin. La tâche lit la file et les briefs, dépose du texte, signale un échec. Elle ne valide, ne publie,
  ne supprime jamais rien, et ne voit pas les clients de démonstration en production.
- Rendu du texte : markdown échappé avant mise en forme (aucun HTML du contenu interprété, liens https seulement).

## Conséquences
- Migration 0009 (contenu, versions, file, « à revoir » ; `deliverables.content_md`).
- La rédaction consomme le quota de l'abonnement Claude ; une file non traitée reprend au passage suivant.
- Le brief reste copiable pour une rédaction manuelle dans le projet Claude.

## Mise en place (12 nov. 2026)
- Application Access « bypass » limitée à `espace-obsidian.obsidianpartners.workers.dev/api/robot` (production seulement).
- Clé `DELIVERY_ROBOT_TOKEN` : secret du Worker de production, saisie par Romain ; même valeur enregistrée par Romain dans les
  secrets réseau de l'environnement Claude Code « suivi-client-iam » (injectée par le proxy, jamais visible).
- Tâche planifiée « Delivery automatique Obsidian » : chaque heure de 7 h 17 à 21 h 17 (Paris), elle relance une **session dédiée**
  (« Delivery automatique Obsidian (session dédiée) ») qui lit la file, rédige et dépose. Une session dédiée plutôt qu'une session
  neuve à chaque passage : les sessions lancées par une tâche n'ont pas les connecteurs du compte, la session dédiée a la bibliothèque
  publicitaire Meta (lecture seule), indispensable à l'étape 1A.
- Réseau de l'environnement Claude Code passé en accès complet (accord de Romain) pour ouvrir les pages des annonceurs concurrents
  (analyse de funnel) ; les clés restent injectées uniquement vers leurs propres hôtes.
