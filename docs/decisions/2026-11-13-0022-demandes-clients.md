# 0022 — Demandes clients

**Statut :** acceptée (Romain, 13 nov. 2026).

## Besoin
Un commentaire d'un client sur un livrable est en général urgent ; il doit se voir tout de suite côté agence.

## Décision
- Page agence « Demandes clients » (`/agence/demandes`) : les livrables commentés par un client et pas encore traités, le plus
  ancien d'abord (client, livrable, dernier commentaire, attente), puis les retours (feedback) ouverts, puis ce qui a été traité
  ces 14 jours.
- Un commentaire client est « à traiter » tant que l'agence n'a pas répondu sur le livrable ou cliqué « Marquer comme traité »
  (`deliverable_comments.handled_at`, migration 0016). Répondre traite toutes les demandes du livrable.
- Signalement : compteur rouge animé à côté du lien de la barre latérale (commentaires à traiter + retours nouveaux ou vus),
  bandeau dans la console, badge rouge animé « N commentaires du client à traiter » et bordure rouge sur la carte du livrable,
  commentaires « À traiter » encadrés sur la page du livrable. Animation coupée si l'utilisateur réduit les animations.
- Le client ne voit jamais cet état de traitement.
