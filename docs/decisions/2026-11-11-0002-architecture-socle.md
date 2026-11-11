# 0002 — Choix d'architecture du socle (lot 1)

Date : 11 nov. 2026 · Statut : appliquée

- **Front** : Preact + Vite + TypeScript, rendu côté client, routage maison (≈ 30 lignes), aucune bibliothèque
  de composants, graphiques en SVG. Bundle ≈ 18 Ko gzip.
- **API** : Worker Cloudflare avec Hono. Production : front sur Pages, `/api/*` routé vers le Worker sur le
  **même domaine**, protégé par une seule application Cloudflare Access.
- **Identité** : jeton `Cf-Access-Jwt-Assertion` vérifié (signature, émetteur, audience) avec `jose`.
  En développement et en test seulement, l'en-tête `X-Dev-User` remplace Access ; il est ignoré en production.
- **Isolation** : middleware `scopeClient` sur toutes les routes `/clients/:clientId/*`. Un client qui vise
  un autre identifiant reçoit un 404 identique à celui d'un identifiant inexistant.
- **Bascule de vue** : en-tête `X-View: client`, pris en compte uniquement pour l'agence ; le serveur applique
  alors les mêmes sérialiseurs que pour un client et refuse toute écriture.
- **Paquet `packages/domain`** (ajout à l'arborescence §5) : code partagé front / API / jobs. Il contient la
  définition unique du rendez-vous validé, les formats français, les seuils et le rollup.
- **`metrics_rollup`** : une ligne par (client, jour, niveau, entité) ; les écrans somment des jours.
  Les ratios (CTR, CPC…) se dérivent des sommes à l'affichage, ce qui ne coûte rien.
- **Tables ajoutées au modèle §6** : `phases`, `deliverable_comments`, `onboarding_answer_history`,
  `onboarding_reopenings`, `guide_reads`, `pipeline_snapshot`, `contact_sources_daily`.
  `guides.client_id` et `audit_log.client_id` peuvent être NULL (guide commun, action hors client).
- **Production assistée (après v1)** : `deliverables.origin` (`manuel` | `genere`) et `generation_json` sont
  réservés dès maintenant ; rien n'est généré en v1.
- **Tests** : vitest sur l'API réelle et la migration réelle, via un adaptateur D1 sur `node:sqlite`
  (pas de dépendance à workerd pour tester).
