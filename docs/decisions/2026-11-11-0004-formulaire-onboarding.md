# 0004 — Formulaire d'onboarding en ligne (lot 2, première partie)

Date : 11 nov. 2026 · Statut : appliquée

## Source
Les 43 questions et les 8 sections du formulaire Google « Formulaire Onboarding » (export PDF du 11 nov. 2026),
reprises dans `packages/domain/src/onboarding.ts`. Les numéros 1 à 43 sont conservés.

## Ajustements de libellé
- Q3 : « (avril 2026) » retiré, car la date figée devient fausse pour les clients suivants. Libellé : « Revenus mensuels récurrents actuels ».
- Q41 : options reprises telles quelles (« 20 à 30 € / jour »…), bien que la question parle de budget mensuel.
- Fautes de frappe corrigées (« rend » → « rendent », « ect » → « etc. », « Linkedin » → « LinkedIn »).

## Ajouts du §7 (marqués « Nouveau »)
Journée de l'avatar ; ce qui retient de changer (habitude) ; ce qui inquiète (anxiété) ; histoire du fondateur
(pourquoi, moment précis, échec) ; chiffres unitaires (ticket mensuel, durée de vie, marge brute, closing en démo,
capacité de RDV par semaine) ; cas client chiffré et accord pour le nommer. Tous obligatoires.

## Comportement
- Sauvegarde champ par champ ; historique complet dans `onboarding_answer_history`.
- Envoi possible seulement quand toutes les obligatoires sont remplies ; ensuite tout est en lecture seule.
- L'agence rouvre une section (et met éventuellement une question en évidence) avec un message obligatoire.
  Seule cette section redevient modifiable ; le complément envoyé la referme.
- Les réponses modifiées après la première soumission sont signalées en vue agence avec la valeur d'avant.
- L'agence ne peut pas répondre à la place du client.
- Les chiffres unitaires alimentent `clients.unit_economics_json`. Le plafond du coût par RDV se calcule dès que
  la **part acceptable** est fixée par l'agence (édition agence à venir ; en attendant, en base).
- Pas d'email à l'envoi (§19) : la console agence affiche l'état « À remplir / Envoyé / Complément demandé ».

## Reste à faire pour clore le lot 2
Dépôt des ressources (R2), édition des livrables et des tâches par l'agence depuis l'interface,
commentaires client sur un livrable à relire.
