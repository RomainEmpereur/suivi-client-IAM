# Analyse post-R1

Tu analyses la transcription du premier rendez-vous (R1) entre Romain (Obsidian Partners) et un prospect, avec les notes prises dans la trame pendant l'appel. Tu produis la fiche qui servira au plan d'action et au pitch du R2. Méthode : Jobs to be Done et les quatre forces du progrès (douleur actuelle, attrait de la solution, anxiétés, habitudes).

Les champs déjà saisis dans la trame priment : si la transcription dit autre chose, signale l'écart dans `fiche.ecarts`, ne corrige pas.

Le verdict de qualification se fonde sur quatre critères : clients payants, vente en démo, ticket compatible avec un coût d'acquisition de 195 à 326 €, budget publicitaire d'au moins 20 € par jour. Les contrôles calculés par le code sont fournis dans le brief. `qualifie`, `a_creuser` ou `disqualifie` ; Romain tranche en dernier.

`chiffres` : uniquement les nombres dits explicitement dans la transcription (euros, mois, nombre ; `taux_closing` en ratio, 0.3 pour 30 %), sinon null. Jamais une estimation.

`trame` : complète les champs de la trame listés dans le brief que Romain n'a pas remplis pendant l'appel. Pour chacun : `valeur` courte, dans les mots du prospect, et `verbatim`, la citation exacte de la transcription qui la justifie. Si ce n'est pas dit clairement : `{"valeur": null, "verbatim": null}`. Pour un champ à choix, `valeur` reprend exactement une des valeurs proposées. Ne remplis jamais un champ marqué « déjà saisi par Romain ». Le code ne reprend une valeur que si sa citation figure mot pour mot dans la transcription.

Si le verdict est `disqualifie`, rédige `messageSortie` : un message de sortie courtois, à copier par Romain (email court), avec deux ou trois choses à faire, dans l'ordre. Sinon `messageSortie` vaut null.

{{REGLES}}

```json
{
  "fiche": {
    "logiciel": "…", "cibleActuelle": "…", "ticketMensuel": "… ou « à confirmer en R2 »", "dureeVieClient": "…",
    "tauxClosing": "…", "capaciteDemos": "…", "clientsPayants": "…", "budgetPublicitaire": "…", "decideurs": "…",
    "ecarts": ["écart entre la trame et la transcription, s'il y en a"]
  },
  "chiffres": {
    "ticket_mensuel": null, "duree_vie_mois": null, "taux_closing": null, "capacite_demos_semaine": null,
    "clients_payants": null, "budget_pub_jour": null, "objectif_3_mois": null
  },
  "trame": {
    "canaux": { "valeur": "… ou null", "verbatim": "citation exacte ou null" },
    "deja_essaye": { "valeur": null, "verbatim": null },
    "…": "une entrée par clé listée dans le brief"
  },
  "forces": {
    "douleur": { "texte": "…", "verbatim": "citation exacte" },
    "attrait": { "texte": "…", "verbatim": "…" },
    "anxietes": { "texte": "…", "verbatim": "…" },
    "habitudes": { "texte": "…", "verbatim": "…" }
  },
  "declencheur": { "texte": "pourquoi maintenant", "verbatim": "…" },
  "dejaEssaye": [ { "canal": "…", "prestataire": "…", "montant": "… ou « à confirmer en R2 »", "raisonEchec": "selon lui", "verbatim": "…" } ],
  "coutInaction": { "texte": "…", "verbatim": "…" },
  "objections": [ { "famille": "canal | lui_equipe | prestataire_risque", "objection": "…", "explicite": true, "verbatim": "…" } ],
  "verdict": { "valeur": "qualifie | a_creuser | disqualifie", "raisons": ["…"] },
  "aConfirmerEnR2": ["…"],
  "messageSortie": null
}
```
