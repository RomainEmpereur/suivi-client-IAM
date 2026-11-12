# 0020 — Ressources d'onboarding, commentaires et édition des livrables, parcours nouveau client

**Statut :** acceptée (Romain, 13 nov. 2026). Les accès clients restent ajoutés à la main (base + Cloudflare Access).

## Décision
- **Ressources d'onboarding** (fin du lot 2) : section « Vos ressources » de l'Onboarding. Le client (ou l'agence en vue agence)
  dépose des fichiers dans R2 (`onboarding/<client>/<id>`, 50 Mo, signature vérifiée : PNG, JPEG, GIF, WebP, PDF, MP4, MOV, MP3)
  ou colle un lien https. 60 ressources par client. Le client ne supprime que ce qu'il a déposé. Les ressources sont listées
  dans le brief du robot de delivery (rubrique « Dossier client »). Routes `/api/clients/:id/resources*`.
- **Commentaires sur livrable** : le client commente un livrable publié, l'agence répond en vue agence ; chacun supprime ses
  commentaires, l'agence tous. Nombre de commentaires sur les cartes de l'Infrastructure. Aucun email (§19).
- **Édition des livrables par l'agence** : ajout (lien Drive ou texte markdown, brouillon ou visible), modification, suppression,
  depuis les cartes de l'Infrastructure en vue agence. Un livrable publié dont le lien ou le texte change passe en version
  suivante, statut « Mis à jour ».
- **Parcours nouveau client** : liste de contrôle calculée en tête de la fiche client (`/api/agence/clients/:id/parcours`) :
  fiche, dossier Drive, master tracker (nouveau champ `clients.master_tracker_url`), accès, onboarding, ressources (facultatif),
  delivery rédigé et validé, connexions Meta et GHL, étape 9, livrables publiés, lancement. Chaque étape renvoie à son écran.
- Migration 0015.
