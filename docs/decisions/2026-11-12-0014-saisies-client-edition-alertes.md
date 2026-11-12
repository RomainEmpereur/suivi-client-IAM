# 0014 — Saisies du client, édition des clients, alertes quotidiennes, publication automatique

**Statut :** acceptée (Romain, 12 nov. 2026).

## Besoin
- L'encaissé et le ROAS ne viennent d'aucune source : c'est le client qui les renseigne à la main.
- Le statut des rendez-vous (honoré, absent, annulé) est renseigné **par le client** depuis son espace, pas par l'agence.
- L'agence crée et modifie ses clients depuis l'interface (plus de SQL).
- L'agence reçoit chaque jour, pour chaque client, les alertes qui demandent une action.
- Les analyses sont publiées automatiquement pour les clients où la case est cochée.
- Pas de page de mentions légales en v1 (écarte la demande du §16 « Prévoir une page mentions »).

## Décision
1. **Encaissements** (`cash_entries`, migration 0012) : date, montant, libellé. Le client les ajoute et les supprime ; l'agence aussi,
   depuis la vue agence. Ils alimentent `metrics_daily` par une ligne `encaissement_manuel` par jour (`source = 'manuel'`), jamais
   touchée par les synchros. Dès le premier encaissement, l'encaissé n'est plus « non mesuré » pour ce client. Sans saisie,
   l'encaissé et le ROAS restent « — » avec la raison « à saisir dans Encaissements ». Le MRR reste non mesuré.
2. **Statut des rendez-vous** : le client pose le statut (prévu, honoré, absent, annulé) de tous ses rendez-vous, CRM ou saisis.
   `status_source` vaut `client` ou `agence` ; dans les deux cas la synchro GHL ne l'écrase jamais. Le rendez-vous tenu
   compté dans les chiffres suit le statut effectif (celui posé dans l'espace, sinon celui de GHL). L'exclusion d'un rendez-vous
   (hors cible, avec motif) reste réservée à l'agence.
3. **Édition des clients** (vue agence) : création et modification du nom, statut, offre, dates (démarrage, lancement des campagnes),
   dossier Drive, devise et fuseau du compte publicitaire, seuils propres au client, et la case « publier automatiquement ».
   Toute modification est journalisée avec la valeur avant et après (§12).
4. **Publication automatique** : quand la case est cochée, une analyse déposée par la session dédiée est publiée aussitôt
   (synthèse client et recommandations). Sinon, rien ne change : l'agence relit et publie.
5. **Alertes quotidiennes** (vue agence uniquement, jamais visibles du client) : calculées après la synchro de 6 h pour chaque client
   suivi, sur les 7 derniers jours complets, et à la demande depuis la console. Règles :
   - synchro Meta ou GHL en échec / connexion cassée ;
   - dépense sans aucun rendez-vous sur 7 jours ;
   - publicité qui a dépensé sans rendez-vous (au-delà du plafond de coût par rendez-vous, à défaut 50 €) ;
   - CPM, CPC, CTR, coût par rendez-vous, taux d'annulation hors seuil (assez d'impressions pour être significatif) ;
   - campagnes à l'arrêt : aucune dépense depuis 3 jours alors qu'il y en avait la semaine d'avant ;
   - rendez-vous passés sans statut depuis plus de 2 jours (à rappeler au client) ;
   - tâches client en retard.
   Chaque calcul remplace les alertes du jour du client (idempotent). Aucune alerte n'invente un chiffre : une mesure absente
   ne déclenche rien.
