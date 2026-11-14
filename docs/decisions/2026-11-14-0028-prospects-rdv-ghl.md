# 0028 — Prospects : rendez-vous à venir depuis GoHighLevel

Date : 2026-11-14

## Contexte
Les R1 sont pris dans le GoHighLevel du sous-compte Obsidian Partners (I.A.M), déjà synchronisé chaque matin comme celui d'un client (table `appointments`, lecture seule). Romain veut les voir dans Prospects sans ressaisie.

## Décision
- Réglage `prospects_ghl_client_id` (Prospects → Réglages), initialisé à `cl_obsidian_iam` par la migration 0023.
- L'écran Prospects affiche les rendez-vous de ce client à partir du jour même, non annulés et sans fiche : date, contact, source et étape GHL (depuis `crm_leads`).
- « Créer la fiche » crée le prospect avec le nom, la date du R1 et la source (Facebook / Instagram → publicité ; parrainage → recommandation ; sinon autre). La fiche garde la référence (`prospects.appointment_id`, unique) : le rendez-vous quitte la liste.
- Aucune écriture dans GoHighLevel, aucun appel GHL en direct depuis l'écran : la liste suit la synchro (matin, ou lancée à la main).
- La date du R1 de la fiche n'est pas resynchronisée si le rendez-vous est déplacé dans GHL : elle se corrige dans l'onglet R1.
