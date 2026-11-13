# Espace client & agence Obsidian Partners — consignes de session

Lire `docs/cahier-des-charges.md` (il fait foi) et `docs/decisions/` avant toute session.

## Décisions figées
- Construction neuve, stack Cloudflare : un Worker (API Hono + interface Preact intégrée) + D1 + Access. Voir décisions 0001, 0002 et 0005.
- Démo en ligne : `https://espace-obsidian-demo.obsidianpartners.workers.dev` (env `demo`, données fictives, derrière Access). Déployer : `npm run deploy:demo`.
- Production : `https://espace-obsidian.obsidianpartners.workers.dev` (env `production`, base `espace-obsidian`, données réelles, Access réservé à l'agence). Déployer : `npm run deploy:production` — **toujours avec l'accord explicite de Romain**. Client réel chargé : « Obsidian Partners (I.A.M) », import ponctuel MCP du 11 nov. (décision 0006).
- Lots livrés : **0** (décision), **1** (socle : schéma, auth, rôles, bascule de vue, coquille des écrans sur données de démo).
- Gestion des rendez-vous livrée (décision 0006) : l'agence pose les statuts dans l'espace ; **un statut posé par l'agence n'est jamais écrasé** par un import ou une synchronisation.
- Lot 3, partie GHL construite (décision 0007) : client lecture seule `packages/ghl`, synchro `jobs/sync-daily`, jetons chiffrés (secret `TOKEN_ENCRYPTION_KEY`), cron 6 h Paris.
- Lot 3, partie Meta construite (décision 0010) : client lecture seule `packages/meta`, synchro `jobs/sync-daily/src/meta.ts` rapprochée du total du compte chaque jour, conversion BCE, jeton système saisi dans Connexions.
- Lot 2 en cours : formulaire d'onboarding (décision 0004) et édition agence des tâches et phases livrés. Ressources (R2), édition des livrables et commentaires livrés (décision 0020).
- Delivery piloté par l'espace (décision 0008) : rédaction dans le projet Claude, l'espace vérifie les conditions (onboarding + infos de base), enchaîne les étapes 0 à 8 du master prompt (`docs/delivery/master-prompt.md`, intégré par `scripts/embed-master-prompt.mjs`), prépare les briefs et suit la validation. Ressources non bloquantes.
- Delivery automatique (décision 0009) : « Lancer le delivery » met les étapes 0 à 7 en file ; une tâche planifiée Claude Code (abonnement, pas de clé API) les rédige via `/api/robot/*` (clé `DELIVERY_ROBOT_TOKEN`, hors Access sur ce seul chemin). La génération ne valide ni ne publie jamais : la validation agence publie la pièce client dans l'espace du client.
- Pilotage, analyse ponctuelle (décision 0011) : l'agence lance « Analyser mes campagnes » sur une période ; la session dédiée rédige synthèse et au plus six recommandations à partir d'un instantané figé (`analyses.data_json`) et de Meta en lecture seule ; l'agence relit et publie.
- Lot 5 Pilotage livré (blocs 02 à 06) : `packages/domain/src/pilotage.ts` (16 KPI et verdicts, funnel, granularité), route `/clients/:id/pilotage` (chiffres de metrics_rollup, libellés seuls depuis metrics_daily), repères `funnel_events` saisis par l'agence. Même écran pour le client, en lecture.
- Lot 7, Rapport et Feedback livrés : rapport hebdo/mensuel figé (`reports.snapshot_json`), analyse pré-remplie depuis les recommandations, publication par l'agence (`sent_at` = date de publication, aucun email), impression PDF par le navigateur. Feedback client avec contexte joint (7 j, connexions, recos), réponse et statut agence, thèmes récurrents dans la console. Pièces jointes = liens https tant que R2 n'est pas branché.
- Guides : rédaction agence (`/agence/guides`, markdown + captures en lien https), communs ou épinglés par client, brouillon / publié, lecture notée (`guide_reads`). Sources des guides rédigés par Claude : `docs/guides/*.md`, importés en brouillon par `scripts/guides-sql.mjs` (jamais d'écrasement). PDF des guides dans R2 (binding `FILES`, PDF vérifié, 30 Mo max), servi par l'API avec les mêmes droits que le guide. Vidéos intégrées par `@[titre](lien)` sur une ligne seule, hôtes autorisés uniquement (Tella, Loom, YouTube, Vimeo).
- Décision 0012 : seuils par défaut larges (B2B, lancement), pas de compteur contractuel affiché (liste des rendez-vous seulement), rendez-vous saisis à la main comptés dans les chiffres (`api/src/manual-appointments.ts`, lignes `saisie_manuelle`, jamais touchées par la synchro GHL).
- Décision 0013 : leads du pipeline GHL copiés dans `crm_leads` à chaque synchro, pour vérifier un nom à la saisie manuelle d'un rendez-vous ; une saisie rattachée à un lead qui a déjà son RDV CRM n'est pas comptée deux fois.
- Décision 0014 : l'encaissé est saisi à la main par le client (`cash_entries`, page Encaissements, lignes `encaissement_manuel`) ; le client pose le statut de ses rendez-vous (`status_source = 'client'`, jamais écrasé par GHL, tenus recalculés par `refreshHeldFromAppointments`) ; fiche client agence (`/agence/clients/:id`, création, seuils, publication automatique, audit avant/après) ; alertes quotidiennes agence (`api/src/alerts.ts`, après la synchro de 6 h, jamais visibles du client) ; publication automatique des analyses si la case est cochée. Pas de page de mentions légales.
- Décision 0015 : retours clients = texte + pièces jointes R2 (5 fichiers, 25 Mo, signature vérifiée), pas de discussion (note agence facultative), boîte « Retours clients à traiter » dans la console ; rapport enrichi (ratios, série par jour, campagnes, publicités) figé dans le snapshot.
- Décision 0016 : master prompt — bonus, garantie, rareté, urgence seulement si cités dans l'onboarding ; « Visuels de la VSL » en ```html video ; landing en ```html page avec règles de design ; scripts d'ads en paragraphes, 1 min max, CTA = la présentation vidéo. Les blocs ```html s'affichent en iframe isolée (`web/src/markdown.ts`). Chaque brief joint règles d'or et garde-fous.
- Décision 0023 : « Reprise par Claude » sur un livrable rédigé dans l'espace : commentaires du client cochés → consigne de reprise prioritaire de l'étape (modifier uniquement ce qui est demandé) → nouvelle version à valider dans Delivery, publiée à la validation.
- Décision 0024 : verticales (clé d'étape `s1c@<id>`, table `verticals`, `clients.verticals_enabled`, `deliverables.vertical_id`, migration 0017).
- Décision 0025 : optimisations (tables `optimisations` et `optimisation_pieces`, clé robot `s4~<id>`, mesure 14 j avant / après, verdict garder ou revenir, migration 0018).
- Décision 0026 : écran « Vos publicités » (publicités actives uniquement, table `meta_ads_live` réécrite par la synchro Meta, lien bibliothèque via `clients.facebook_page_id`, migration 0019).
- Décision 0022 : page « Demandes clients » (commentaires client à traiter + retours ouverts), compteur animé dans la barre latérale, badge urgent sur les cartes ; `deliverable_comments.handled_at` (migration 0016), une réponse de l'agence traite la demande.
- Décision 0021 : leads Meta = prospects des formulaires instantanés uniquement (`onsite_conversion.lead_grouped`), jamais le total `lead` ni le pixel.
- Décision 0020 : ressources d'onboarding dans R2 (section « Vos ressources »), commentaires client sur livrable, ajout/modification/suppression des livrables par l'agence, parcours nouveau client dans la fiche (`master_tracker_url`, migration 0015). Accès clients ajoutés à la main.
- Décision 0019 : suivi financier agence (`/agence/finance`, vue agence seule) : deals saisis (`agency_deals`, migration 0014), dépense/leads/RDV du compte d'acquisition choisi ; ratios calculés seulement sur les jours où la dépense est synchronisée.
- Décision 0018 : étape 9 « Tracking et connexions » en fin de chaîne (pixel, origine des leads, champs GHL du formulaire Meta, vérification des connexions) ; validable seulement avec Meta et GHL « ok ».
- Décision 0017 : intégrations de la landing — repères `<!-- OBSIDIAN:VSL|CALENDRIER:DEBUT/FIN -->` exigés par le master prompt ; codes Wistia et GHL saisis dans l'étape 3 (`delivery_steps.integrations_json`) et insérés par `applyIntegrations` (domain), sans régénération ; « Copier le code final ». Validation client reportée.
- Le formulaire se définit **uniquement** dans `packages/domain/src/onboarding.ts` ; les clés de question sont stables (jamais renommées).
- Défauts §20 appliqués : décision 0003.
- Le rendez-vous validé se définit **uniquement** dans `packages/domain/src/appointments.ts`.
- `metrics_daily` est la source unique des chiffres ; les écrans lisent `metrics_rollup`. Aucun écran n'appelle Meta ni GHL.
- Isolation : toute route client passe par `api/src/scope.ts` ; ce qui sort de l'API passe par `api/src/serialize.ts`.

## Garde-fous (§19)
- **Aucune écriture dans Meta.** Le client API ne doit même pas exposer de méthode d'écriture.
- **Aucune écriture dans GoHighLevel** sans décision explicite dans `docs/decisions/`. Par défaut, lecture seule.
- **Aucun email envoyé** par l'application en v1.
- **Aucun chiffre inventé.** Une absence de mesure s'affiche « — » avec sa raison, jamais 0.
- **Aucune donnée de démonstration en production** (`clients.is_demo = 1` refusé par l'API en production ; seed en local uniquement).
- **Pas de secret écrit par Claude Code.** Jetons saisis par Romain, via `wrangler secret put`. Un secret dans le dépôt ou un journal est un défaut bloquant.
- **Pas de migration rétroactive.** Une migration appliquée n'est jamais modifiée : on en ajoute une nouvelle.
- **Pas de refonte non demandée.** Proposer dans `docs/decisions/` et attendre l'accord.
- **Le cahier des charges fait foi** jusqu'à modification explicite.

## Commandes
- `npm test` · `npm run typecheck` · `npm run build`
- Local : `npm run db:migrate:local && npm run db:seed:local`, puis `npm run dev:api` et `npm run dev:web` → http://localhost:5173
