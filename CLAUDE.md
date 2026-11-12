# Espace client & agence Obsidian Partners — consignes de session

Lire `docs/cahier-des-charges.md` (il fait foi) et `docs/decisions/` avant toute session.

## Décisions figées
- Construction neuve, stack Cloudflare : un Worker (API Hono + interface Preact intégrée) + D1 + Access. Voir décisions 0001, 0002 et 0005.
- Démo en ligne : `https://espace-obsidian-demo.obsidianpartners.workers.dev` (env `demo`, données fictives, derrière Access). Déployer : `npm run deploy:demo`.
- Production : `https://espace-obsidian.obsidianpartners.workers.dev` (env `production`, base `espace-obsidian`, données réelles, Access réservé à l'agence). Déployer : `npm run deploy:production` — **toujours avec l'accord explicite de Romain**. Client réel chargé : « Obsidian Partners (I.A.M) », import ponctuel MCP du 11 nov. (décision 0006).
- Lots livrés : **0** (décision), **1** (socle : schéma, auth, rôles, bascule de vue, coquille des écrans sur données de démo).
- Gestion des rendez-vous livrée (décision 0006) : l'agence pose les statuts dans l'espace ; **un statut posé par l'agence n'est jamais écrasé** par un import ou une synchronisation.
- Lot 3, partie GHL construite (décision 0007) : client lecture seule `packages/ghl`, synchro `jobs/sync-daily`, jetons chiffrés (secret `TOKEN_ENCRYPTION_KEY`), cron 6 h Paris. Meta à brancher.
- Lot 2 en cours : formulaire d'onboarding (décision 0004) et édition agence des tâches et phases livrés. Restent les ressources (R2), l'édition des livrables, les commentaires sur livrable.
- Delivery piloté par l'espace (décision 0008) : rédaction dans le projet Claude, l'espace vérifie les conditions (onboarding + infos de base), enchaîne les étapes 0 à 8 du master prompt (`docs/delivery/master-prompt.md`, intégré par `scripts/embed-master-prompt.mjs`), prépare les briefs et suit la validation. Ressources non bloquantes.
- Delivery automatique (décision 0009) : « Lancer le delivery » met les étapes 0 à 7 en file ; une tâche planifiée Claude Code (abonnement, pas de clé API) les rédige via `/api/robot/*` (clé `DELIVERY_ROBOT_TOKEN`, hors Access sur ce seul chemin). La génération ne valide ni ne publie jamais : la validation agence publie la pièce client dans l'espace du client.
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
