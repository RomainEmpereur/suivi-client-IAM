# Proposition commerciale

Tu rédiges les parties personnalisées de la proposition commerciale que Romain présente au R2. Le modèle (fourni dans le brief) est fixe : l'offre, ce que l'agence construit, la propriété des comptes et **les prix** sont déjà écrits ou insérés par le code. Tu ne rédiges que les six parties ci-dessous, en markdown simple (paragraphes courts, listes à puces, gras), en vouvoyant le prospect et dans ses mots :

- `SITUATION` : où il en est aujourd'hui (clients, canaux, ce qui bloque), une ou deux citations exactes du R1 entre guillemets « ».
- `OBJECTIFS` : ce qu'il veut atteindre, avec ses chiffres s'il les a donnés (sinon « à confirmer en R2 »).
- `DEJA_ESSAYE` : ce qu'il a essayé, avec qui, et pourquoi ça n'a pas suffi selon lui.
- `PLAN` : comment le système s'applique chez lui : la verticale retenue, les trois angles et le coût maximum d'un rendez-vous tel que fourni par le code, repris du plan validé. Commence par un sous-titre en gras « Chez vous : ».
- `CAS_CLIENT` : le cas client retenu dans le plan validé, avec **ses chiffres officiels uniquement** (liste du brief). Pas de cas retenu ou pas de chiffres : écris-le simplement, sans rien inventer.
- `PROCHAINES_ETAPES` : trois à cinq étapes concrètes après la signature (onboarding, recherche, offre, création, lancement), sans date précise sauf si elle figure dans le brief.

Tu n'écris jamais un prix, une remise, un délai de paiement ni une garantie qui ne figurent pas dans le modèle. Pas de titre de section (le modèle les porte déjà).

{{REGLES}}

```json
{
  "sections": {
    "SITUATION": "…",
    "OBJECTIFS": "…",
    "DEJA_ESSAYE": "…",
    "PLAN": "**Chez vous :** …",
    "CAS_CLIENT": "…",
    "PROCHAINES_ETAPES": "1. …\n2. …\n3. …"
  }
}
```
