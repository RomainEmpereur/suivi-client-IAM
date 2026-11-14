# 0034 — Prospects : proposition commerciale et Google Doc

Date : 2026-11-14

## Contexte
Avant le R2, Romain présente une proposition commerciale. L'offre est presque toujours la même (mise en place, puis paiement au résultat après 30 démos avec l'avatar client) ; seules les parties propres au prospect changent. Il veut un Google Doc, téléchargeable en PDF.

## Décision
- Nouveau document « proposition » (migration 0026 : contrainte élargie, table reconstruite à l'identique ; colonnes `gdoc_*`). Il s'ouvre une fois le plan validé, dans l'onglet R2.
- Modèle markdown réglable (Prospects → Réglages, `prospects_proposition_modele`, modèle par défaut dans `DEFAULT_PROPOSAL_TEMPLATE`). Claude ne rédige que six parties (`SITUATION`, `OBJECTIFS`, `DEJA_ESSAYE`, `PLAN`, `CAS_CLIENT`, `PROCHAINES_ETAPES`) à partir de l'analyse, de la recherche, du plan et du pitch validés ; prompt `docs/prospects/prompts/proposition.md`.
- Le code remplit l'identité, la date et **les prix** (`prospects_proposition_offre` : mise en place, montant au résultat, condition ; par défaut 1 500 € et 1 500 € après 30 démos avec l'avatar client). Claude n'écrit jamais un prix.
- Une partie manquante devient « [à compléter] » et bloque la validation jusqu'à correction à la main.
- Google Doc : après validation, « Créer le Google Doc » met une demande en file (`pr~gdoc`). La tâche planifiée crée le document dans le dossier Drive réglé (`prospects_drive_dossier`) à partir du HTML fourni par le brief (conversion Drive), puis dépose son lien. La fiche affiche « Ouvrir le Google Doc » et « Télécharger en PDF » (export Google). C'est une écriture Drive de plus pour la tâche planifiée : son prompt l'autorise explicitement, dans ce seul dossier.
- Rien n'est envoyé au prospect depuis l'espace.

## Mise à jour (14 novembre, même jour)
Le modèle par défaut reprend désormais la proposition réelle de Romain (IREN × Obsidian, 29 septembre 2026), séquences de nurturing en email seulement (plus de SMS). Claude ne remplit plus que quatre champs (`ENTREPRISE`, `LOGICIEL`, `CONTACTS`, `CIBLE`) ; le code insère la date et les prix (total, mise en place, au résultat, condition) ; `{{DEMARRAGE}}` (date du kick-off) reste « [à compléter] » et Romain la saisit avant validation. Les tableaux du modèle sont rendus dans le Google Doc (en-tête bleu marine).
Ajout au modèle par défaut (même jour) : ce qui compte comme un rendez-vous (réservé seul par le prospect, ou fixé lors du rappel par l'équipe du client, chaque lead étant rappelé dans les 5 minutes) et quand il est validé (prospect conforme à l'avatar client ; l'absence d'urgence ou d'achat ne l'invalide pas : l'agence garantit la qualité des prospects, pas la vente).
