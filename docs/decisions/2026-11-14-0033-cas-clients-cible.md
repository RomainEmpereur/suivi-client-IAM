# 0033 — Cas clients : un seul champ « cible / verticale »

Date : 2026-11-14

## Contexte
Dans les réglages Prospects, « cible » et « verticale » d'un cas client désignaient la même chose pour Romain : les personnes visées par les publicités.

## Décision
- Un seul champ « Cible / verticale (les personnes visées par les publicités) », stocké dans `case_studies.target`. La colonne `vertical` n'est plus utilisée (toujours NULL).
- Migration `0025_cas_clients_cible` (numéro partagé avec `0025_recherche_marche`, appliquées toutes deux en production ; tables distinctes) : la verticale déjà contenue dans la cible est abandonnée ; sinon elle est ajoutée entre parenthèses à la cible. Aucune donnée perdue.
- Le brief du plan et du pitch présente ce champ comme « cible / verticale (les personnes visées par les publicités) ».
