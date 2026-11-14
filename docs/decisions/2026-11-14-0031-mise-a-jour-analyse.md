# 0031 — Prospects : « Mettre à jour » l'analyse depuis la fiche

Date : 2026-11-14 · acceptée (Romain).

## Contexte
Romain complète la fiche (trame, chiffres) après la rédaction de l'analyse post-R1. Faire réécrire l'analyse par Claude pour
reprendre quelques chiffres est trop lent (prochain passage) et change aussi le texte.

## Décision
- Bouton « Mettre à jour » à côté de « Faire réécrire » sur l'analyse post-R1 : le code reprend, sans réécriture par Claude,
  les chiffres de la fiche (`chiffres`, et les valeurs lisibles de `fiche`), les champs de la trame saisis par Romain (`trame`,
  sans citation puisque c'est sa saisie ; décideurs dans `fiche`), recalcule le coût maximum et les contrôles (lignes
  « Calcul mis à jour » en tête des raisons du verdict) et retire de « À confirmer en R2 » les points désormais renseignés.
- Le verdict lui-même (jugement) ne change pas ; Romain le modifie s'il le souhaite. Les citations restent vérifiées.
- Brouillon : mis à jour sur place. Version validée : nouvelle version en brouillon, la validée est conservée.
- `refreshAnalyse` dans `packages/domain/src/prospects.ts`, route `POST /agence/prospects/:id/documents/analyse/refresh`.
