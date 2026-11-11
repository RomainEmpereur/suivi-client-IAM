# Reprise GoHighLevel des clients — réglage validé par Romain (12 nov. 2026)

Lecture seule des pipelines, 12 nov. 2026. Pour chaque client : le pipeline lu et affiché, l'étape qui vaut
« R1 planifiée », les étapes qui prouvent que l'appel a eu lieu (→ rendez-vous honoré), l'étape no-show (→ absent),
et les étapes gagnées (→ vente). Les rendez-vous passés sans indice restent « à renseigner ».

| Client | Pipeline | R1 planifiée | Après appel (→ honoré) | No-show | Gagné |
| --- | --- | --- | --- | --- | --- |
| CRM Qhare | 1. Pipeline de vente M.A.P | R1 / Démo planifiée | Follow up sur le R1, R2 planifié, Follow up sur le R2, Deal closé, Deal perdu | — | Deal closé |
| Ċawla Studio | 1. Pipeline de vente M.A.P | R1 / Démo planifiée | idem Qhare | — | Deal closé |
| Toolkit | 1. Pipeline de vente M.A.P | R1 / Démo planifiée | idem Qhare | — | Deal closé |
| Vistaflow | 1. Sales Pipeline | Rendez-vous R1 planifié | Rendez-vous de follow-up, Deal lost, Deal closé | No Show | Deal closé |
| Invoicing.Plus | 1. Sales Pipeline Invoicing Plus | audit planifié | Follow up à faire, Deal closé, Deal perdu | — | Deal closé |
| Koverio | 1. Sales Pipeline (les pipelines Hiring et Onboarding sont ignorés) | Strategy Session Booked | Follow Up Call Booked, Deal Follow-Up, Deposit Taken, Deal Closed | No Show | Deposit Taken, Deal Closed |
| Civex | 1. Sales Pipeline - Militaires **et** 5. Sales Pipeline - Entreprises (deux cibles distinctes : les deux affichés) | Strategy Session Booked ; Audit planifié entreprises | Follow Up Call Booked, Deal Follow-Up, Deposit Taken, Deal Closed ; Deal closé, Deal perdu, Deal Closed | No Show (Militaires) | Deposit Taken, Deal Closed ; Deal closé, Deal Closed |
| Shopinzen | Pipeline de vente - IOC | Session de stratégie booké | Appel de follow-up booké, Deal Follow-Up, Acompte pris, Deal Closé | No-Show | Acompte pris, Deal Closé |
| Effinity | 1. Sales Pipeline | Audit planifié | Deal closé, Deal perdu, Pas qualifié en appel | — | Deal closé |

Points d'attention :
- « Deal perdu » est compté comme « appel tenu » : un deal se perd après un appel. Si vos setters passent aussi en
  « perdu » des prospects jamais appelés, il faut le retirer.
- Étapes placées AVANT le R1 dans le pipeline (« Follow up Setting » chez Effinity, « Follow up à faire » chez
  Civex Entreprises) : non comptées comme appel tenu.
- Calendriers : tous les calendriers du sous-compte seront lus, sauf indication contraire.

## Réponses de Romain
- « Deal perdu » vaut toujours « l'appel a eu lieu » (compté comme rendez-vous honoré).
- Civex : deux pipelines distincts, deux cibles ; les deux sont lus et affichés.

Le réglage est stocké par NOMS (`clients.ghl_config_json`, champs `pipelineNames`, `postCallStageNames`…) et résolu
en identifiants à chaque synchronisation : un nom renommé dans GHL bloque la synchronisation avec un message clair.
