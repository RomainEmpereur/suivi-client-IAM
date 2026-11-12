# 0015 — Retours clients avec pièces jointes, rapport enrichi

**Statut :** acceptée (Romain, 12 nov. 2026).

## Retours (feedback)
- Le client écrit sa demande (type, urgence, description) et joint jusqu'à 5 fichiers : images (PNG, JPEG, GIF, WebP), PDF,
  vidéos courtes (MP4, MOV), 25 Mo chacun, déposés dans R2 (`feedback/<client>/<retour>/…`). Le format est vérifié par la
  signature du fichier. Les pièces jointes s'ajoutent dans l'heure qui suit l'envoi, par l'auteur du retour seulement.
  Les fichiers sont servis par l'API avec les droits du retour ; la clé R2 ne sort jamais.
- **Pas de discussion** : le client ne répond pas. Il suit l'avancement (reçu, pris en compte, en cours, traité).
  L'agence peut laisser une note facultative, visible du client, à laquelle il ne peut pas répondre.
- L'agence reçoit chaque demande dans « Retours clients à traiter » en tête de la console, tous clients, les plus urgentes d'abord.

## Rapport
Le rapport figé (`reports.snapshot_json`) contient en plus, pour les rapports générés à partir de cette décision :
ratios clés (CTR, CPC, CPM, coût par lead, coût par rendez-vous, taux de présence, coût d'acquisition, ROAS encaissé) avec
la période précédente, la dépense et les rendez-vous (à défaut les leads) par jour, le tableau des campagnes et les publicités
les plus dépensières. Une publicité ou une campagne qui a dépensé sans rendez-vous est en rouge, avec le montant dépensé.
Les rapports déjà générés gardent leur contenu d'origine.
