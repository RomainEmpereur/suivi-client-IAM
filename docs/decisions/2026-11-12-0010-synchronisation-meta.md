# 0010 — Synchronisation Meta (lot 3, partie Meta)

**Statut :** acceptée (Romain, 12 nov. 2026 : jeton d'utilisateur système `ads_read` créé dans son Business Manager).

## Décision
- Client `packages/meta` **en lecture seule** : GET uniquement, vers graph.facebook.com uniquement, jeton en en-tête (jamais dans une URL).
  Aucune méthode d'écriture n'existe (un test le vérifie).
- Jeton : un utilisateur système du Business Manager de l'agence, comptes publicitaires des clients affectés en lecture
  (« Voir les performances »). Saisi par Romain dans Connexions (chiffré, secret `TOKEN_ENCRYPTION_KEY`), testé à l'enregistrement.
- Synchro (`jobs/sync-daily/src/meta.ts`) : insights par publicité et par jour (publicités supprimées et archivées comprises),
  fuseau du compte. Fenêtre quotidienne : 30 derniers jours ; reprise d'historique par tranches de 31 jours.
- **Contrôle** : chaque jour, la somme des publicités est rapprochée du total du compte. Un écart positif va dans la ligne
  « Campagnes supprimées ou archivées » ; si les publicités dépassent le total, rien n'est écrit et la synchro échoue.
- Devise : conversion en euros au taux BCE du jour (api.frankfurter.dev, dernier taux publié avant le jour) ; montant d'origine conservé.
- Écriture idempotente en une transaction : mesures Meta de la fenêtre remises à zéro puis réécrites ; mesures CRM (GHL) intactes ;
  lignes devenues vides (anciens imports ponctuels par campagne) supprimées ; rollup de la fenêtre recalculé.
- Cron 6 h Paris : Meta puis GHL pour chaque client ; le bouton « Synchroniser maintenant » fait de même.
