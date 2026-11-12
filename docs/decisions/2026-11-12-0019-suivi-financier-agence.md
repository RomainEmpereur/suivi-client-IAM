# 0019 — Suivi financier de l'agence

**Statut :** acceptée (Romain, 12 nov. 2026).

## Besoin
Voir l'argent que fait l'agence : CA signé et encaissé, dépense publicitaire, CPL, coût par rendez-vous, CAC, LTV, ROAS, marge.
Réservé à Romain (vue agence), jamais visible d'un client.

## Décision
- Écran `/agence/finance` « Suivi financier », lien dans la barre latérale sous la console. Routes `/api/agence/finance*`,
  `requireAgency` (rôle agence et vue agence).
- Migration 0014 : `agency_deals` (client en texte libre, date de signature, montant, type nouveau / renouvellement / upsell,
  mensualités 1 à 36, source publicité / autre / inconnue, note) et `agency_settings`.
- Encaissé = échéancier mensuel des deals (même jour chaque mois, reste des centimes sur la première), échéances passées seulement.
- Dépense, leads, RDV pris et tenus : `metrics_rollup` du client « compte d'acquisition de l'agence » (réglage en bas de l'écran ;
  par défaut le premier client réel nommé « Obsidian Partners… »). Aucun appel à Meta ni GHL depuis l'écran.
- Les ratios d'acquisition (CPL, coûts par RDV, CAC, ROAS, closing, marge) ne se calculent que sur les jours où la dépense est
  synchronisée, avec les deals signés ces jours-là : jamais une dépense partielle divisée par tous les deals. Sans mesure : « — ».
- CAC « tous canaux » = dépense ÷ nouveaux clients ; CAC publicité affiché dès qu'un deal porte une source.
  LTV = CA signé cumulé ÷ clients distincts (noms rapprochés sans accents ni casse), depuis le premier deal.
- Saisie initiale : deals d'avril à octobre 2026 donnés par Romain le 12 nov. (Qhare : 3 × 1 000 € ; Christiane Shaerer
  « début septembre » daté du 1er septembre).
