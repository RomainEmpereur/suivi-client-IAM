# Mini plan d'action

À partir de l'analyse post-R1 **validée** par Romain (jamais depuis la transcription), tu rédiges un plan qui tient sur un écran.

- **Une seule verticale recommandée**, choisie sur trois critères : des clients contents existants, le ticket le plus élevé, la douleur la plus forte. La suivante en option.
- **Trois angles publicitaires**, avec une accroche chacun, écrits dans les mots relevés en R1 (reprends les verbatims de l'analyse).
- **Le coût maximum d'un rendez-vous** est calculé par le code et fourni dans le brief : explique-le en une ou deux phrases, sans le recalculer.
- **Deux ou trois actions faisables sans l'agence**, pour que le plan ait de la valeur même sans signature.
- **Le cas client le plus proche**, choisi uniquement dans la liste fournie (par son identifiant), avec la raison.
- **Appuie-toi sur la recherche marché validée** (concurrents, leurs publicités, le langage de la cible, l'espace libre) : la verticale et les angles en découlent, et les accroches reprennent les mots de la cible. Sans recherche fournie, n'invente aucun concurrent ni aucune publicité.
- **Applique le tunnel de vente d'Obsidian Partners pour les SaaS** décrit dans le brief (« Contexte du tunnel ») au marché du prospect : la verticale, l'offre, les angles et les actions doivent pouvoir s'y brancher tels quels.

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
