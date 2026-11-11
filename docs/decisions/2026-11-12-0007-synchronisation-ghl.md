# 0007 — Lot 3, partie GoHighLevel : synchronisation quotidienne

Date : 12 nov. 2026 · Statut : construite et testée ; mise en production soumise à l'accord de Romain

## Choix
- **Client GHL en lecture seule** (`packages/ghl`) : uniquement des lectures (sous-compte, pipelines, calendriers,
  opportunités paginées, rendez-vous) ; toute méthode HTTP autre que GET est impossible ; réessais bornés sur 429/5xx ;
  messages d'erreur sans jeton.
- **Jeton par sous-compte**, chiffré au repos en AES-GCM avec le secret Worker `TOKEN_ENCRYPTION_KEY`
  (32 octets générés par Romain), saisi par l'agence dans l'écran Connexions, testé à l'enregistrement, jamais renvoyé.
- **Réglages par client** (`clients.ghl_config_json`, migration 0005) : pipelines lus, pipeline affiché, calendriers,
  étapes « après appel », « no-show », « gagné », préfixes de titres de tests.
- **Règles partagées** avec l'import (`packages/domain/src/ghl-rules.ts`) : statut des rendez-vous (décision 0006),
  attribution par `utmAdId`, puis campagne, puis « non rattaché ».
- **Idempotence** : sur la fenêtre (30 derniers jours par défaut), les colonnes CRM de `metrics_daily` sont remises à zéro
  puis réécrites ; la dépense et les autres colonnes Meta ne sont jamais touchées ; les rendez-vous sont mis à jour sans
  jamais remplacer un statut posé par l'agence ; rollup recalculé sur la fenêtre.
- **Orchestration** (`jobs/sync-daily/src/run.ts`) : client par client, échec isolé, ligne `sync_runs`, connexion passée en
  « en panne » avec une phrase pour le client (jeton retiré ou échec ponctuel). Reprise manuelle : bouton agence
  « Synchroniser maintenant » (`POST /api/clients/:id/sync`, dates optionnelles).
- **Cron** : 4 h et 5 h UTC, travail effectif seulement à 6 h heure de Paris.

## Vérification sur données réelles (11–12 nov.)
Synchronisation réelle de janvier à novembre 2026 sur une copie locale chargée de l'import MCP : contacts 627 = 627,
RDV honorés 68 = 68, ventes 15 = 15, dépense inchangée ; RDV pris 107 contre 106 (la réservation fantaisiste exclue à la
main lors de l'import ; à exclure dans l'écran Rendez-vous, ce qui la protège ensuite).

## Limites connues
- Paiements GHL non lus : le jeton actuel n'a pas les droits `payments` (encaissé « — »).
- Le statut « dernier rendez-vous du contact » est évalué sur les rendez-vous lus dans la fenêtre.
- Meta reste à brancher (jeton système en attente de la double validation du portefeuille).
