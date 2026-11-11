# 0001 — Lot 0 : construction neuve plutôt que reprise de Leadflows

Date : 11 nov. 2026 · Statut : appliquée par défaut (§20, case 1 non cochée)

## Constat
Le dépôt Leadflows n'est pas accessible depuis la session de build : le seul dépôt GitHub visible pour le
compte est `gregory-frison-cgp`. Rien ne permet d'inspecter sa stack ni la qualité du code.

## Décision
Construction neuve selon la §5 (Cloudflare Pages + Workers + D1 + Access). La structure fonctionnelle de
Leadflows (barre latérale, bascule « Vue client / ← Agence », cartes de KPI, recommandations) est reprise
d'après le cahier des charges et les captures décrites, pas d'après le code.

## Pour revenir dessus
Si le dépôt Leadflows devient accessible, l'inspecter avant le lot 2. Le coût de bascule est faible tant
que seuls le socle et les écrans de démonstration existent.
