# 0012 — Seuils larges B2B, pas de compteur contractuel, rendez-vous saisis comptés

**Statut :** acceptée (Romain, 12 nov. 2026). Modifie les défauts §14 (seuils) et l'affichage du compteur (§6, §8).

## Seuils par défaut (B2B, campagnes de lancement)
Les premiers chiffres d'une campagne de lancement B2B sont peu fiables : les seuils par défaut sont élargis
(`packages/domain/src/thresholds.ts`) et la marge « à surveiller » passe de 20 % à 30 % d'écart.

| Indicateur | Avant | Désormais |
|---|---|---|
| CPM max | 15 € | 40 € |
| CPC max | 1 € | 3 € |
| CTR min | 1,5 % | 0,7 % |
| ThruPlay min | 12 % | 8 % |
| Annulation max | 15 % | 25 % |
| ROAS encaissé min | 3 | 1 |

Un client peut toujours avoir ses propres seuils (`clients.thresholds_json`).

## Compteur de rendez-vous
Tous les clients n'ont pas l'offre « 30 rendez-vous » : le compteur contractuel n'est plus affiché
(tableau de bord, page Rendez-vous, console). La page Rendez-vous est une **liste** : rendez-vous du CRM et rendez-vous
ajoutés à la main par le client (réservés hors du CRM). La définition du rendez-vous validé reste dans
`packages/domain/src/appointments.ts` pour le jour où l'offre le demandera.

## Rendez-vous saisis à la main
Ils comptent dans les chiffres du client (rendez-vous pris le jour de la saisie, tenus quand le statut « honoré » est posé),
via des lignes `metrics_daily` dédiées (`ad_id = 'saisie_manuelle'`, `source = 'manuel'`) recalculées à chaque ajout ou
changement de statut. La synchro GHL ne les touche pas. Dès qu'un client a un rendez-vous saisi, les rendez-vous pris et tenus
ne sont plus « non mesurés » pour lui.

## Affichage
- Une pastille de verdict n'apparaît que si la mesure existe et qu'un seuil existe (plus de « Non mesuré » à côté d'un « — »).
- Le graphique contacts / rendez-vous affiche « Non synchronisé » au lieu de zéros quand le CRM n'est pas relié.
- Le bandeau d'avancement de l'infrastructure n'apparaît plus pour un client au statut « actif ».
