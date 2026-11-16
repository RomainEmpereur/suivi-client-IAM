# 0035 — Proposition commerciale : trois paiements et gestion mensuelle

Date : 2026-11-16

## Contexte
Pour baisser le risque perçu par le prospect sans changer le prix total, Romain découpe le paiement au résultat en deux paliers, puis propose une gestion mensuelle facultative une fois les 30 rendez-vous atteints (première application : Alexandre F., Liroad).

## Décision
- L'offre (`prospects_proposition_offre`) passe à huit champs : total, mise en place, paiement 2 et sa condition, paiement 3 et sa condition, prix de la gestion mensuelle et son engagement. Défaut : 3 000 € = 1 500 € à la signature, 750 € à 15 rendez-vous validés, 750 € à 30 ; puis 400 € / mois avec engagement de 3 mois, ou autonomie sans frais.
- Nouveaux champs du modèle, remplis par le code : `{{PRIX_RESULTAT_2}}`, `{{CONDITION_RESULTAT_2}}`, `{{PRIX_GESTION}}`, `{{ENGAGEMENT_GESTION}}`. Le modèle par défaut ajoute la ligne « Paiement 3 », la condition des paiements 2 et 3 (chaque seuil sur 90 jours) et un bloc « Après les 30 rendez-vous validés » (option 1 : gestion ; option 2 : autonomie).
- Tous les champs de l'offre sont requis à l'enregistrement. Claude n'écrit toujours aucun prix.
- Pas de migration : aucune offre ni aucun modèle n'étaient enregistrés en production, les défauts s'appliquent. Une proposition déjà générée garde son texte.
