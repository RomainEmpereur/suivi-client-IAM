# Espace Obsidian Partners

L'espace client et agence d'Obsidian Partners : suivi de l'infrastructure, résultats quotidiens Meta + GoHighLevel,
recommandations, et compteur contractuel des rendez-vous validés. Spécification : `docs/cahier-des-charges.md`.

## Arborescence
```
api/              Worker Cloudflare (Hono) : routes, authentification, isolation
web/              Front Preact + Vite
packages/domain/  Code partagé : rendez-vous validé, formats FR, seuils, rollup
packages/meta/    Client API Meta (lot 3, lecture seule)
packages/ghl/     Client API GoHighLevel (lot 3, lecture seule)
jobs/             Synchronisation quotidienne et recommandations (lots 3 et 6)
db/migrations/    Migrations SQL numérotées, jamais modifiées après application
db/seed/          Générateur du jeu de démonstration (local uniquement)
docs/decisions/   Une note par décision structurante
tests/            Vitest : isolation, compteur, formats, tableau de bord
```

## Démarrer en local
Prérequis : Node 22 ou plus.
```bash
npm install
npm run db:migrate:local
npm run db:seed:local      # deux clients fictifs, marqués is_demo
npm run dev:api            # wrangler dev sur :8787
npm run dev:web            # Vite sur :5173, /api relayé vers :8787
```
Ouvrir http://localhost:5173 et choisir une identité de démonstration :
`agence@obsidian.demo.local`, `client@nordline.demo.local` (campagnes en cours), `client@pilotis.demo.local` (en production de livrables, une section d'onboarding rouverte) ou `client@atelier.demo.local` (onboarding à remplir).

## Tests
```bash
npm test          # 56 tests : isolation, brouillons, jetons, production, compteur, formats, onboarding
npm run typecheck
```

## Démo en ligne
`https://espace-obsidian-demo.obsidianpartners.workers.dev` — données fictives, protégée par Cloudflare Access.
```bash
npm run deploy:demo        # compile l'interface, l'intègre au Worker, déploie l'environnement demo
```
Variables pour wrangler : `CLOUDFLARE_ACCOUNT_ID` et `CLOUDFLARE_API_TOKEN` (jamais dans le dépôt).

## Déploiement (première fois)
1. `npx wrangler d1 create espace-obsidian`, puis reporter l'identifiant dans `api/wrangler.toml` (deux blocs).
2. `npx wrangler d1 migrations apply espace-obsidian --remote --env production` (depuis `api/`).
3. Cloudflare Access → application auto-hébergée sur `espace.obsidianpartners.fr`. Méthode : code à usage unique par email.
   Durée de session : 30 jours. Politique : liste des emails invités. Reporter le domaine d'équipe et l'AUD dans `[env.production.vars]`.
4. Rattacher le domaine `obsidianpartners.fr` au compte Cloudflare, puis décommenter `routes` (custom_domain) dans `[env.production]`.
5. `npm run deploy -w api` : compile l'interface, l'intègre au Worker et déploie (décision 0005).
6. Créer le compte agence (et ensuite chaque client) :
   ```bash
   npx wrangler d1 execute espace-obsidian --remote --env production --command "INSERT INTO users (id, email, role) VALUES ('usr_romain', '<email>', 'agence')"
   ```
   Un email doit aussi figurer dans la politique Access pour pouvoir se connecter.

Secrets (lots 3 et 6) : `wrangler secret put ANTHROPIC_API_KEY --env production`, ainsi que la clé de chiffrement des jetons.
Ils ne vont jamais dans le dépôt ni dans `wrangler.toml`. En local : `api/.dev.vars` (ignoré par git).
