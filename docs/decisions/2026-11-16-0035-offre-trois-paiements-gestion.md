# 0035 — Proposition commerciale : trois paiements et gestion mensuelle

Date : 2026-11-16

## Contexte
Pour baisser le risque perçu par le prospect sans changer le prix total, Romain découpe le paiement au résultat en deux paliers, puis propose une gestion mensuelle facultative une fois les 30 rendez-vous atteints (première application : Alexandre F., Liroad).

## Décision
- L'offre (`prospects_proposition_offre`) passe à huit champs : total, mise en place, paiement 2 et sa condition, paiement 3 et sa condition, prix de la gestion mensuelle et son engagement. Défaut : 3 000 € = 1 500 € à la signature, 750 € à 15 rendez-vous validés, 750 € à 30 ; puis 400 € / mois avec engagement de 3 mois, ou autonomie sans frais.
- Nouveaux champs du modèle, remplis par le code : `{{PRIX_RESULTAT_2}}`, `{{CONDITION_RESULTAT_2}}`, `{{PRIX_GESTION}}`, `{{ENGAGEMENT_GESTION}}`. Le modèle par défaut ajoute la ligne « Paiement 3 », la condition des paiements 2 et 3 (chaque seuil sur 90 jours) et un bloc « Après les 30 rendez-vous validés » (option 1 : gestion ; option 2 : autonomie).
- Tous les champs de l'offre sont requis à l'enregistrement. Claude n'écrit toujours aucun prix.
- Pas de migration : aucune offre ni aucun modèle n'étaient enregistrés en production, les défauts s'appliquent. Une proposition déjà générée garde son texte.

## Mise à jour (17 novembre)
- Le modèle par défaut se termine par un bloc « SIGNATURES » : mention « Lu et approuvé », Romain Auroux pour Obsidian Partners et `{{CONTACTS}}` pour `{{ENTREPRISE}}`, avec date et case de signature. La mention « (5 à 8 min) » de la VSL est retirée, comme dans le modèle enregistré par Romain. Le bloc est aussi ajouté au modèle enregistré en production.
- Fiche prospect : la carte « Google Doc » est visible dès le brouillon, et un bouton « Valider et créer le Google Doc » enchaîne la validation et la demande du document.
