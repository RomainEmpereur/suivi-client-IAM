# 0029 — Prospects : trame complétée depuis la transcription, vérification de la fiche

Date : 2026-11-14

## Contexte
Romain ne note pas toujours tout pendant le R1. Il veut que la transcription collée complète la fiche, et que l'espace vérifie que tout est enregistré avant de passer à la suite.

## Décision
- L'analyse post-R1 rend un objet `trame` : pour chaque champ texte ou à choix de la trame (hors chiffres, déjà repris par `chiffres`, et hors dates), une valeur et la citation exacte qui la justifie.
- Au dépôt, le code ne reprend une valeur que si : le champ est vide (ou déjà déduit), la citation est trouvée mot pour mot dans la transcription, et, pour un choix, la valeur fait partie des options. Ce que Romain a saisi n'est jamais remplacé.
- Les champs déduits sont marqués dans les notes (`_origines`, `_verbatims`) et affichés « déduit de la transcription, à vérifier ». Ils ne servent jamais de source pour vérifier une citation. Un champ retouché par Romain redevient « saisi ».
- « Vérification de la fiche » (onglets R1 et Analyse) : chaque élément, saisi / corrigé / déduit de la transcription / manquant.
- Valider l'analyse avec des éléments manquants (hors issue et date du R2) exige une confirmation explicite (`confirmMissing`) : ils passent en « à confirmer en R2 ».
- « Analyser » enregistre d'abord la transcription collée si elle ne l'est pas encore.
