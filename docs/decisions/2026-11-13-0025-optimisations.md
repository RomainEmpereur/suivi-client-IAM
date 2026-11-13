# 0025 — Optimisations : reprise ciblée de pièces en ligne, mesurée avant / après

Date : 2026-11-13

## Contexte
Quand une campagne ne donne pas les résultats attendus, on ne refait pas toute la chaîne : on reprend une ou plusieurs pièces
(nouvelle vague d'ads, formulaire et qualification, landing, séquences, structure de campagne) et on mesure l'effet.

## Décision
- Tables `optimisations` (constat, hypothèse, consigne, statut, date de mise en ligne, verdict) et `optimisation_pieces` (une ligne par pièce reprise). Migration 0018.
- Création côté agence uniquement, depuis l'écran Optimisations ou depuis une recommandation d'analyse (« Créer une optimisation »).
  Une pièce ne peut être reprise que si elle est déjà rédigée dans la chaîne visée (principale ou verticale).
- Réécriture par Claude via la même file que le delivery : clé `<étape>~<id>` (ex. `s4~op_x`), mêmes URL de brief, de dépôt et d'échec.
  Le prompt de la tâche planifiée ne change pas. Le brief reprend celui de l'étape avec, en consigne prioritaire, le constat, l'hypothèse,
  la consigne et la version en ligne à reprendre, plus les chiffres de la semaine.
- Statuts : en préparation → prête (toutes les pièces validées par l'agence) → en ligne (date de mise en ligne saisie) → terminée (verdict) ; ou abandonnée.
- Mesure automatique : 14 jours avant la mise en ligne contre 14 jours à partir de la mise en ligne (bornés à hier), depuis `metrics_rollup`
  au niveau du compte. Coût par lead, coût par rendez-vous et taux de réservation comparés ; volumes affichés sans variation. Pas de donnée → « — ».
- Verdict de l'agence : « on garde » → chaque pièce devient la version de référence de l'étape (nouvelle version, validée) et le livrable du client
  est mis à jour, sans marquer les pièces aval « à revoir » ; « on revient » → le delivery ne change pas.
- Visible des deux côtés : le client voit l'optimisation dès qu'elle est prête (pièces validées), avec la mesure et la décision ; jamais la consigne interne ni les brouillons.
- Mise en ligne dans Meta, GoHighLevel ou la landing : faite par l'agence, jamais par l'espace ni par Claude.
