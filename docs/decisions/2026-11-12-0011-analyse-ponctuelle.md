# 0011 — Pilotage : analyse ponctuelle des campagnes, à la demande

**Statut :** acceptée (Romain, 12 nov. 2026). Modifie le §14 du cahier des charges (recommandations quotidiennes rédigées
par l'API Anthropic à 6 h) : les recommandations sont désormais **ponctuelles**, à la demande de l'agence.

## Décision
- Bloc 01 du Pilotage : « Analyser mes campagnes » + période (7, 14, 30 jours ou dates libres, close à hier). **Agence uniquement.**
- La demande part en file (`analyses`). La session dédiée de la delivery (abonnement Claude, connecteur Meta en lecture seule)
  la traite au passage suivant (au plus une heure, 7 h – 21 h) via `/api/robot/analyses/*`, même clé que la delivery.
- Données : un **instantané figé** des chiffres de l'espace sur la période et la précédente (totaux, dérivés, jours, campagnes,
  publicités, rendez-vous par statut, seuils, économie unitaire), enregistré dans `analyses.data_json` ; plus la lecture seule des
  publicités dans Meta et de la page de destination. Aucun chiffre hors de ces sources.
- Résultat : synthèse interne, synthèse client, **au plus six** recommandations (gravité, titre = action, 2 à 4 phrases, version client).
- **Relecture et publication par l'agence** (§10 du cahier) : réécriture de la version client, recommandation traitée / ignorée,
  publication explicite avec confirmation. Une recommandation ignorée n'est jamais publiée. Le client ne voit que la version client.
- Migration 0010 : table `analyses`, colonne `recommendations.analysis_id`.
