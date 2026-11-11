# 0005 — Déploiement : un seul Worker (API + interface intégrée) et une démo en ligne

Date : 11 nov. 2026 · Statut : appliquée · Modifie la décision 0002 (Pages + route /api/*)

## Contexte
Le compte Cloudflare est neuf : aucun domaine n'y est encore rattaché. Avec Pages pour l'interface et un Worker pour
l'API sur deux adresses `*.dev` différentes, il faudrait du CORS et deux applications Access. L'upload d'« assets »
de Workers est par ailleurs impossible depuis la session de build : le service d'upload utilise sa propre clé temporaire,
que le proxy de la session remplace.

## Décision
- **Un seul Worker** sert `/api/*` (Hono) et l'interface. L'interface compilée (≈ 70 Ko) est intégrée au script par
  `scripts/embed-web.mjs` (`npm run build:worker`) ; point d'entrée `api/src/worker.ts`. En local, rien ne change : Vite + `wrangler dev`.
- **Environnement `demo`** : `https://espace-obsidian-demo.obsidianpartners.workers.dev`, base D1 `espace-obsidian-demo`,
  données fictives uniquement. Le jeton Cloudflare Access y est **obligatoire** ; ensuite seulement, on peut choisir une identité
  fictive `*.demo.local`. Sans Access configuré, l'API refuse tout.
- **Environnement `production`** : même mécanique, domaine `espace.obsidianpartners.fr` à rattacher, aucune identité fictive.
- `preview_urls = false` : pas d'adresse secondaire qui échapperait à Access.
- En-têtes de sécurité sur l'interface : `X-Frame-Options: DENY`, `nosniff`, HSTS, `Referrer-Policy: same-origin`.

## Conséquence
L'interface n'est plus hébergée sur Pages. Le coût reste nul (plan Workers gratuit suffisant pour la démo ;
plan payant à 5 $/mois au lot 3 pour le cron).
