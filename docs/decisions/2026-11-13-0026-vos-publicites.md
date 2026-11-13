# 0026 — Vos publicités : aperçu des publicités actives pour le client

Date : 2026-11-13

## Contexte
Le client veut voir les publicités qui tournent. La médiathèque Meta n'est pas partageable : elle exige un rôle sur le Business Manager.

## Décision
- Écran « Vos publicités » (client et agence) : uniquement les publicités **actives** (statut effectif ACTIVE). Brouillons, pré-lancement,
  pauses et publicités terminées ne sont jamais affichés.
- La synchro Meta quotidienne (lecture seule) lit en plus, pour chaque publicité active : nom, campagne, date de création, format, titre, texte,
  vignette (640 px) ou image, lien d'aperçu partageable (`preview_shareable_link`) et page Facebook (`actor_id`). Table `meta_ads_live`, réécrite à chaque passage.
  Un échec de cette lecture ne bloque jamais la synchro des chiffres. Les adresses d'images du CDN Meta sont temporaires : rafraîchies chaque jour.
- Chiffres de chaque publicité : 30 derniers jours (dépense, leads, coût par lead), depuis `metrics_rollup` niveau publicité. Pas de donnée → « — ».
- Lien « bibliothèque publicitaire Meta » (public, sans connexion) : `clients.facebook_page_id`, saisi dans la fiche client ou rempli
  automatiquement à la synchro (jamais écrasé s'il est saisi). Seul accès pour les clients sans jeton Meta (imports ponctuels).
- Migration 0019.
