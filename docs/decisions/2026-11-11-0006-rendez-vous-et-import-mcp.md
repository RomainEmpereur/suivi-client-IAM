# 0006 — Source et statut des rendez-vous ; import ponctuel par MCP

Date : 11 nov. 2026 · Statut : appliquée (réponses de Romain du 11 nov. aux questions §20 n° 3 et 4)

## Réponses de Romain
- Le suivi du pipeline GHL n'est pas toujours tenu à jour.
- **Source des rendez-vous** : soit le client les ajoute à la main dans l'espace, soit ils sont repris dès qu'un prospect
  arrive à l'étape « R1 planifiée » du pipeline GHL du client (chez Obsidian : « Rendez-vous planifié avec Romain »,
  pipeline « Setter Shirley »).
- **Statut présent / absent** : c'est Romain qui le passe, à la main.
- **Pipeline affiché** pour Obsidian Partners : « Setter Shirley Pipeline de Vente ».

## Conséquences
1. L'espace doit permettre à l'agence de **passer un rendez-vous en honoré / absent / annulé / hors cible** (avec motif),
   et au client d'**ajouter** un rendez-vous. Le statut saisi dans l'espace prime sur GHL et se journalise (`audit_log`).
   → à construire (lot 4, avant toute mise en production avec un client sous contrat).
2. Tant que le statut n'est pas saisi, un rendez-vous passé reste « prévu — statut à renseigner » et ne compte pas.
3. Règle d'import depuis GHL, dans l'ordre :
   annulé dans le calendrier → annulé ; `noshow` ou étape « No-show » → absent ;
   `showed` ou étape d'après appel (« Disqualifié en discovery », « Qualifié follow-up », « Closé », « Deal perdu ») → honoré ;
   sinon → prévu. Un rendez-vous futur n'est jamais « honoré ».
   Point à trancher : un prospect « Disqualifié en discovery » s'est présenté ; compte-t-il dans les 30 ? Par défaut oui,
   l'agence peut l'exclure comme « hors cible ».

## Import ponctuel par MCP (transitoire)
- Le détail Meta **jour × publicité** renvoyé en masse par le connecteur MCP est faux (44 publicités sur 46 à zéro) et
  omet les publicités supprimées (213 € sur 90 jours). Le détail **jour × campagne** est exact : il retombe au centime
  sur le total du compte (1 525,47 €, 86 889 impressions, 1 391 clics, 112 leads).
- L'import ponctuel stocke donc une ligne par **jour × campagne** dans `metrics_daily`, avec `ad_id = 'campagne:<id>'`
  et `source = 'mcp'`, plus une ligne « Non rattaché » pour les contacts et rendez-vous sans campagne.
  Le lot 3 (API Meta avec jeton système) remplacera ces lignes par le vrai détail par publicité.
- Script déterministe `scripts/import-mcp.ts` : aucun chiffre saisi à la main ; il refuse de produire le SQL si le total
  de dépense ne correspond pas au total du compte.
- L'encaissé n'est pas lu (paiements GHL non importés) : `clients.unmeasured_json` (migration 0003) le marque
  « Non synchronisé », affiché « — » et non « 0 € ».
- Les fichiers d'export contiennent des données personnelles : ils restent hors du dépôt.

## Pourquoi pas une lecture MCP planifiée comme mécanisme définitif
Données groupées non fiables (constat ci-dessus), connecteur Meta capable d'écrire, coût par passage, dépendance à une
connexion personnelle. Retenu : jetons de lecture et Worker cron (lot 3) ; MCP pour l'exploration et les imports ponctuels.

## Mise en œuvre (12 nov. 2026)
- Écran **Rendez-vous** (barre latérale) : filtres « Tous / À renseigner / À venir », bandeau du nombre de rendez-vous
  passés sans statut.
- **Agence** : statut par liste déroulante (prévu, honoré, absent, annulé ; honoré et absent interdits pour un rendez-vous
  futur), exclusion du compteur avec motif obligatoire, réintégration. `PATCH /api/clients/:id/appointments/:rdv`.
- **Client et agence** : ajout d'un rendez-vous (« prévu », origine `saisie`). `POST /api/clients/:id/appointments`.
  Le client ne pose jamais de statut ; la vue client reste en lecture seule.
- Migration 0004 : `origin`, `created_by_user_id`, `status_source` (`ghl` | `agence` | `client`), `status_updated_at/by`.
- Chaque changement est journalisé (`audit_log`, actions `rdv_statut` et `rdv_ajout`, avant / après).
- **Un statut posé par l'agence n'est jamais écrasé** : l'import (et la future synchronisation) fait un `ON CONFLICT … DO UPDATE`
  qui conserve statut, inclusion et motif quand `status_source = 'agence'`, et ne supprime plus aucun rendez-vous.

## Reprise des clients existants (12 nov. 2026)
- 13 espaces créés à la demande de Romain (liste fermée) : CRM Qhare, Vistaflow, Ċawla Studio, Toolkit, Invoicing.Plus
  (compte Meta « Admin Plus Pub »), Koverio, Civex, Shopinzen, Effinity, Ecommercio (compte « Soft4One »),
  NWD Production (compte « MyDataNest », en bahts), EA Concept (compte « 103Leads »), Euroinfo (en production, sans chiffres).
- Meta : jour × campagne + ligne « supprimées ou archivées », contrôle au centime ET jour par jour (dépense, impressions,
  clics, leads, vues de page) contre le total du compte. Le connecteur MCP ne remplit parfois que la première campagne
  d'un appel groupé (Civex) : relecture campagne par campagne, puis contrôle.
- Devises : valeur d'origine, devise et taux conservés ; conversion au taux de référence BCE du jour
  (api.frankfurter.dev), dernier taux publié pour les jours sans cotation.
- CRM : colonnes marquées « non synchronisées » (affichées « — ») jusqu'à la reprise GHL, après validation par Romain
  des étapes de chaque pipeline (R1 planifiée, après appel, no-show, gagné).
