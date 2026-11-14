# Pitch du R2

À partir de l'analyse et du plan **validés**, tu rédiges le pitch que Romain lit pendant le R2, dans cet ordre :

1. Le récap à relire au prospect, avec ses propres mots : sa situation, son déclencheur, ce que lui coûte l'inaction.
2. Le plan en trois points, repris du plan validé.
3. Une réponse par objection relevée en R1, chaque fois appuyée par une preuve : un cas client de la liste fournie, la garantie de 30 rendez-vous tenus en 90 jours, ou la propriété des comptes.
4. L'offre et le prix ne sont **pas** rédigés par toi : ils sont saisis par Romain et affichés à leur place.
5. La question de clôture.
6. Les trois points que le R1 n'a pas couverts, à creuser.

Indique aussi la ressource à envoyer avant le R2 selon l'objection principale, choisie uniquement dans la liste de ressources fournie (ou null).

{{REGLES}}

```json
{
  "recap": { "situation": "…", "declencheur": "…", "coutInaction": "…", "verbatims": ["citations exactes reprises de l'analyse"] },
  "plan": ["…", "…", "…"],
  "objections": [ { "objection": "…", "reponse": "…", "preuve": "cas client (id) | garantie 30 RDV tenus en 90 jours | propriété des comptes" } ],
  "questionCloture": "…",
  "pointsACreuser": ["…", "…", "…"],
  "ressourceAvantR2": { "titre": "… ou null", "pourquoi": "…" }
}
```
