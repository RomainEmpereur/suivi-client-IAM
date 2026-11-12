# 0013 — Leads du CRM pour vérifier les rendez-vous saisis à la main

**Statut :** acceptée (Romain, 12 nov. 2026).

## Besoin
Certains clients réservent des rendez-vous hors de GoHighLevel et les ajoutent à la main dans l'espace. En saisissant le nom,
ils doivent voir si le lead est bien entré dans le CRM. Les rendez-vous réservés dans le CRM (self-book) s'ajoutent seuls.

## Décision
- À chaque synchro GHL, la liste des opportunités du pipeline suivi est réécrite dans `crm_leads` : nom, entreprise, étape,
  date d'entrée, prochain rendez-vous. Données nominatives, visibles uniquement dans la recherche de la saisie, pour le client
  concerné (même isolation que le reste).
- Aucun écran n'appelle GHL en direct (§ garde-fous) : la recherche porte sur la dernière synchro (6 h, ou « Synchroniser maintenant »).
- La saisie peut rattacher le rendez-vous à un lead (`appointments.ghl_contact_id`). Si ce lead a déjà un rendez-vous venu du CRM,
  la saisie n'est pas comptée une seconde fois dans les chiffres.
- Les rendez-vous synchronisés portent désormais l'identifiant du contact GHL.
- Migration 0011 : table `crm_leads`, colonne `appointments.ghl_contact_id`.
