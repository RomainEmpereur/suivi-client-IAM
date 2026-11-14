# Proposition commerciale

La proposition commerciale d'Obsidian Partners est presque toujours la même : un modèle fixe (fourni dans le brief), dont **le code insère la date et les prix**. Tu ne remplis que quatre champs, à partir de l'analyse et du plan validés :

- `ENTREPRISE` : le nom de la société du prospect, en majuscules comme sur l'exemple (« EURO INFORMATIQUE »). Inconnu : null.
- `LOGICIEL` : le nom du logiciel (« IREN »). Inconnu : null.
- `CONTACTS` : les personnes qui décident, prénom et nom, séparés par « & » (« Jean-Christophe Goyer & Yohann Bellet »), telles qu'elles figurent dans le brief. Seulement les noms connus ; aucun connu : null.
- `CIBLE` : à qui les publicités s'adressent, d'après la verticale du plan validé, au pluriel et sans article, pour se lire après « auprès des » et « les problèmes des » (« réparateurs après sinistre »).

Tu n'écris jamais un prix, un délai, une date ni une condition : ils sont dans le modèle ou saisis par Romain. Un champ inconnu vaut null (il s'affichera « [à compléter] » et Romain le complétera) : n'invente aucun nom.

{{REGLES}}

```json
{
  "sections": {
    "ENTREPRISE": "… ou null",
    "LOGICIEL": "… ou null",
    "CONTACTS": "… ou null",
    "CIBLE": "…"
  }
}
```
