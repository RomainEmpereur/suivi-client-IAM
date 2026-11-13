# 0023 — Reprise d'un livrable par Claude à partir des commentaires du client

**Statut :** acceptée (Romain, 13 nov. 2026).

## Décision
- Sur la page d'un livrable rédigé dans l'espace (origine `genere`, étape de delivery dans `generation_json`), la vue agence
  propose « Reprise par Claude » : l'agence coche les commentaires du client à prendre en compte (ceux à traiter sont cochés) et
  peut ajouter une précision.
- Le lancement remet l'étape de delivery en file avec une consigne de reprise prioritaire : les retours du client cités mot pour
  mot, l'ordre de ne modifier que les éléments visés et de garder le reste à l'identique, de refuser ce qui contredit le master
  prompt (prix, chiffre non sourcé, garantie ou urgence non citées) et de lister les modifications. Le brief joint déjà la
  version actuelle à reprendre. Les commentaires choisis passent « traités ».
- Claude dépose la nouvelle version au passage suivant du robot ; l'étape passe « à valider ». La page du livrable signale la
  version proposée avec un lien vers l'étape dans Delivery. La validation de l'agence la publie : version suivante,
  « Mis à jour ». Rien n'est publié sans validation.
- Livrables hors delivery (liens Drive, documents ajoutés à la main) : pas de reprise par Claude, modification manuelle.
- Comme toute pièce amont modifiée, une nouvelle version d'une étape fait passer les étapes suivantes « à revoir ».
