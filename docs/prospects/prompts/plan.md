# Mini plan d'action

À partir de l'analyse post-R1 **validée** par Romain (jamais depuis la transcription), tu rédiges un plan qui tient sur un écran.

- **Une seule verticale recommandée**, choisie sur trois critères : des clients contents existants, le ticket le plus élevé, la douleur la plus forte. La suivante en option.
- **Trois angles publicitaires**, avec une accroche chacun, écrits dans les mots relevés en R1 (reprends les verbatims de l'analyse).
- **Le coût maximum d'un rendez-vous** est calculé par le code et fourni dans le brief : explique-le en une ou deux phrases, sans le recalculer.
- **Deux ou trois actions faisables sans l'agence**, pour que le plan ait de la valeur même sans signature.
- **Le cas client le plus proche**, choisi uniquement dans la liste fournie (par son identifiant), avec la raison.
- Si une « Recherche marché » est fournie, sers-t'en ; sinon n'invente aucun concurrent ni aucune publicité.

{{REGLES}}

```json
{
  "verticale": { "choix": "…", "raisons": ["clients contents existants : …", "ticket : …", "douleur : …"], "suivante": "… ou null" },
  "angles": [ { "angle": "…", "accroche": "…", "motsDuProspect": "verbatim repris de l'analyse" } ],
  "coutMaxRdvExplication": "…",
  "actionsSansAgence": ["…", "…"],
  "casClient": { "id": "identifiant de la liste", "pourquoi": "…" }
}
```
