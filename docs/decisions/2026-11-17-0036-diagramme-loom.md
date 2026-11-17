# 0036 — Prospects : lien du diagramme présenté dans le Loom

Date : 2026-11-17

## Contexte
Pour chaque Loom personnalisé, Romain présente un diagramme animé publié comme artefact Claude (claude.ai/artifact/…). Il ne retrouvait pas ces liens : ils n'étaient rangés nulle part dans l'espace.

## Décision
- Migration 0027 : colonne `prospects.diagram_url`.
- Onglet « 3 · Plan et Loom » de la fiche prospect : champ « Diagramme présenté dans le Loom (lien de l'artefact Claude) » à côté du lien du Loom, enregistré avec lui, et bouton « Ouvrir le diagramme ».
- Le lien n'est jamais envoyé au prospect par l'espace ; un artefact reste privé tant que Romain ne le partage pas.
