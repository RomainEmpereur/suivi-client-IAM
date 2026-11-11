# Cahier des charges — Espace client & agence Obsidian Partners

Nov 11, 2026 · @romainauroux · document destiné à être déposé à la racine d'un dépôt et lu par Claude Code

## 1. Contexte et objectif

Obsidian Partners construit et pilote des infrastructures d'acquisition Meta pour des éditeurs de logiciels B2B. Ce projet remplace les Google Sheets « Suivi projet », les dossiers Drive et les points par email par un espace en ligne unique, utilisé à la fois par l'agence et par chaque client.

Trois usages, dans cet ordre de priorité :

1. **Le client sait où en est son infrastructure** sans avoir à demander : ce qui est fait, ce qui est en cours, ce qu'on attend de lui.
2. **Le client voit ses résultats** mis à jour chaque matin, avec l'analyse et les recommandations du jour, et peut en sortir un rapport PDF.
3. **L'agence pilote tous ses clients depuis un seul écran** : avancement de la production, santé des connexions, coût par rendez-vous par créative, compteur de rendez-vous validés.

Contrainte commerciale qui pèse sur le produit : l'offre standard est de 1 500 € à la mise en place puis 1 500 € une fois 30 rendez-vous validés atteints sur 90 jours. Le compteur de rendez-vous validés doit donc être visible, daté et incontestable des deux côtés. C'est la donnée la plus sensible du produit.

L'espace est en français, utilisé sur ordinateur en priorité, et doit rester lisible sur mobile.

## 2. Point de départ : partir de la base Leadflows

**Première chose à faire avant d'écrire une ligne de code.** Un espace du même type tourne déjà sur `app.leadflows.fr` : même barre latérale (Accueil → Tableau de bord, Pilotage, Rapport mensuel, Factures, Démarrage et aide → Onboarding, Guides), même bascule « Vue client / ← Agence », mêmes cartes de KPI, même moteur de recommandations quotidiennes.

Ce cahier des charges décrit l'espace Obsidian Partners en reprenant cette structure. Deux chemins possibles :

- **Si le dépôt Leadflows est disponible** : le dupliquer, puis l'adapter (marque, livrables d'infrastructure, onboarding SaaS, espace feedback, écran Connexions). C'est le chemin par défaut. Les sections 6 à 15 servent alors de liste d'écarts à combler, pas de spécification à implémenter de zéro.
- **Si le dépôt n'est pas réutilisable** (stack incompatible, code non maintenable, instance tierce) : construire à neuf selon la section 5.

Claude Code doit trancher ce point en premier, en inspectant le dépôt Leadflows, et dire laquelle des deux voies il prend avant de commencer.

Ce qui change par rapport à Leadflows, quoi qu'il arrive :

| Leadflows | Obsidian Partners |
| --- | --- |
| Vente de leads par verticale | Infrastructure d'acquisition pour un éditeur SaaS |
| Pas de phase de production de livrables | Onboarding → offre → landing → VSL → ads → séquences, suivis dans l'espace |
| Pas d'espace de réclamation | Espace feedback qui alimente les recommandations |
| Connexions implicites | Écran Connexions avec état de santé Meta, GHL, pixel, domaine, calendrier |
| Compteur de rendez-vous non contractuel | Compteur « rendez-vous validés X / 30 » adossé au solde de 1 500 € |

## 3. Périmètre

### Dans la v1

Les huit écrans client (onboarding, tableau de bord, pilotage, infrastructure, rapport, connexions, feedback, guides), la vue agence multi-clients, le job de synchronisation quotidien Meta + GoHighLevel, le moteur de recommandations, et le circuit de validation agence → client sur chaque livrable.

### Dans un second temps, après la v1

La **production assistée des livrables** : Claude qui rédige l'offre de trafic froid, le script de VSL, les scripts d'ads et les séquences à partir de l'onboarding stocké. En v1, l'espace stocke l'onboarding, affiche les livrables et suit leur avancement ; la rédaction se fait toujours dans un projet Claude à côté, et Romain dépose le livrable fini dans l'espace. La v1 doit donc prévoir dès maintenant, dans le modèle de données et dans l'API, la place d'un livrable généré automatiquement — mais rien n'est généré en v1.

Autres sujets reportés : facturation et paiement en ligne, espace multi-utilisateurs côté client, notifications push, application mobile, traduction en anglais.

### Hors périmètre, définitivement

- L'espace ne remplace pas GoHighLevel ni le gestionnaire de publicités Meta. Il les lit, il ne les administre pas.
- Aucune écriture dans Meta depuis l'espace : pas de changement de budget, pas de mise en pause, pas de publication. Les recommandations disent quoi faire ; Romain le fait dans Meta.
- L'écriture dans GoHighLevel se limite, et seulement si la section 20 le valide, à l'ajout d'une note ou d'une étiquette sur un contact.

### Volumétrie à prévoir

10 à 25 clients actifs, 1 à 3 utilisateurs par client, 2 ans d'historique quotidien, 50 à 300 publicités par client et par mois. Rien ici ne justifie une architecture distribuée.

## 4. Rôles, authentification et bascule de vue

### Deux rôles

|  | Agence (Romain) | Client |
| --- | --- | --- |
| Clients visibles | Tous, via un sélecteur | Le sien uniquement |
| Livrables | Voit les brouillons, publie | Voit les livrables publiés seulement |
| Recommandations | Voit tout, y compris les notes internes | Voit les recommandations publiées |
| Onboarding | Lit, relance, rouvre | Remplit, modifie tant que non verrouillé |
| Guides, seuils, tâches | Crée et modifie | Lit, coche ce qui lui incombe |
| Feedback | Reçoit, répond, clôt | Dépose, suit |
| Connexions | Voit les jetons et les erreurs techniques | Voit un état vert / orange / rouge et quoi faire |

### Authentification

Connexion par email et code à usage unique, sans mot de passe à retenir. Pas d'inscription libre : Romain crée le client et invite l'adresse. Session de 30 jours, déconnexion explicite disponible.

Si la stack retenue est Cloudflare, Cloudflare Access assure cette connexion sans code d'authentification à écrire ; l'application lit l'identité dans le jeton signé et ne sert que les données du client correspondant. Si la stack retenue est Supabase, Auth + RLS, avec une politique par ligne sur `client_id`.

Dans les deux cas, la règle est la même : **l'isolation des données est vérifiée côté serveur à chaque requête**, jamais par ce que le navigateur envoie. Un client qui change l'identifiant dans l'URL reçoit une erreur, pas les données d'un autre.

### Bascule vue agence / vue client

Reprise de Leadflows : un bandeau ambre en haut de la barre latérale, visible uniquement pour l'agence, indiquant la vue active et permettant de revenir. En vue client, Romain voit exactement ce que le client voit, y compris la disparition des brouillons. Les mentions « Vue agence : les guides en brouillon ne sont pas visibles par le client » restent affichées en vue agence, en gris, sous le contenu concerné.

La bascule ne change rien aux droits d'écriture : en vue client, l'interface est en lecture seule.

## 5. Stack et hébergement

Si la base Leadflows est réutilisée, sa stack l'emporte sur ce qui suit. Sinon :

| Brique | Choix | Pourquoi |
| --- | --- | --- |
| Hébergement du front | Cloudflare Pages | Statique, gratuit, déploiement par `git push` |
| API et jobs | Cloudflare Workers, plan payant à 5 $/mois | Cron Triggers avec 30 s de CPU, suffisant pour boucler sur 25 comptes |
| Base de données | Cloudflare D1 (SQLite) | Dans le même compte, requêtes SQL ordinaires |
| Authentification | Cloudflare Access, code par email | Aucune authentification à écrire |
| Secrets | `wrangler secret put`, jamais en base ni dans le dépôt |  |
| Rédaction des recommandations | API Anthropic appelée depuis le Worker du cron | Le portail reste à jour sans intervention |
| Fichiers (PDF de guides, exports) | Cloudflare R2 | Pas de frais de sortie |

Alternative acceptable si une vraie base Postgres est préférée : Supabase (Pro, 25 $/mois, sans mise en pause) pour les données et l'authentification, front sur Cloudflare Pages. Ne pas mélanger les deux.

Front : TypeScript, un framework léger au choix de Claude Code, rendu côté client acceptable vu le nombre d'utilisateurs. Pas de dépendance à une bibliothèque de composants lourde ; les graphiques en SVG ou avec une bibliothèque légère.

### Arborescence attendue

```markdown
/CLAUDE.md              décisions figées, à lire avant toute session
/README.md              installation, variables, déploiement
/docs/cahier-des-charges.md   ce document
/docs/decisions/        une note par décision structurante, datée
/web/                   front
/api/                   Worker : routes, authentification, accès aux données
/jobs/sync-daily/       synchronisation quotidienne
/jobs/recos/            calcul des règles + rédaction
/packages/meta/         client API Meta Marketing
/packages/ghl/          client API GoHighLevel
/db/migrations/         migrations SQL numérotées, jamais modifiées après application
/db/seed/               jeu de données de démonstration
/tests/
```

Règles de travail : une migration par changement de schéma, jamais de modification d'une migration déjà appliquée. Un fichier `.dev.vars` ignoré par git pour le local. Toute décision structurante prise en cours de route s'écrit dans `/docs/decisions/` et se résume dans `CLAUDE.md`.

## 6. Modèle de données

Toutes les tables portent `client_id` sauf `clients` et `users`. Toutes portent `created_at` et `updated_at`. Les montants sont stockés en centimes, en euros, avec la devise d'origine et le taux conservés quand le compte publicitaire est dans une autre devise.

| Table | Contenu | Champs qui comptent |
| --- | --- | --- |
| `clients` | Un éditeur SaaS | nom, slug, logo, statut (prospect, onboarding, build, actif, pause, terminé), offre, date de démarrage, objectif de rendez-vous (30 par défaut), fenêtre en jours (90), seuils personnalisés |
| `users` | Personnes connectées | email, rôle (agence, client), client\_id, dernière connexion |
| `onboarding_answers` | Réponses au formulaire | section, numéro de question, question figée, réponse, auteur, date, statut (brouillon, soumis) |
| `onboarding_assets` | Ressources déposées | type (logo, charte, captures produit, témoignage, enregistrement, autre), fichier R2, description |
| `deliverables` | Les livrables de l'infrastructure | type (offre, landing, vsl\_script, vsl\_video, ads\_scripts, ads\_videos, sequences, tracking, campagne), titre, statut, version, lien externe, résumé pour le client, visible\_client (booléen), date de publication |
| `tasks` | Tâches de production et tâches client | libellé, description, responsable (agence, client), phase, statut (à faire, en cours, bloqué, fait), échéance, lien, deliverable\_id |
| `connections` | Accès techniques | type (meta, ghl, pixel, domaine, calendrier, mailing), identifiant externe, état (ok, dégradé, cassé, non configuré), dernier contrôle, message d'erreur, jeton chiffré |
| `metrics_daily` | Un enregistrement par jour, par client, par publicité | date, campaign\_id, adset\_id, ad\_id, noms, dépense, impressions, clics lien, vues de page, vues VSL, leads, rendez-vous pris, rendez-vous tenus, ventes, encaissé, source |
| `metrics_rollup` | Agrégats précalculés par période | période, niveau (client, campagne, publicité), tous les indicateurs dérivés |
| `appointments` | Un rendez-vous | date de prise, date du rendez-vous, statut (prévu, annulé, honoré, absent), origine (campagne, publicité), compte dans les 30 (booléen), motif si exclu |
| `recommendations` | Les analyses quotidiennes | date, gravité (info, à surveiller, à corriger), titre, corps, indicateurs cités, règle déclenchée, visible\_client, état (ouverte, traitée, ignorée) |
| `alerts` | État des seuils sur la période | indicateur, valeur, seuil, verdict (tenu, à surveiller, à corriger, non mesuré) |
| `reports` | Rapports générés | période, commentaire de l'agence, instantané JSON des chiffres, fichier PDF, date d'envoi |
| `feedback` | Réclamations et retours | catégorie (bug, résultat, demande, question), gravité, corps, pièces jointes, statut (nouveau, vu, en cours, résolu), réponse de l'agence |
| `guides` | Procédures | titre, type (PDF, vidéo, page), fichier ou URL, ordre, publié (booléen), lu par le client |
| `funnel_events` | Les changements de funnel annotés | date, libellé court, description — ils s'affichent en lignes verticales sur les graphiques d'évolution |
| `sync_runs` | Journal des synchronisations | source, début, fin, lignes écrites, erreurs |
| `audit_log` | Traçabilité | acteur, action, objet, avant, après |

### Deux règles non négociables

**La table `metrics_daily` est la source unique des chiffres.** Aucun écran ne requête Meta ou GHL en direct. Un chiffre affiché est un chiffre qui a été synchronisé, et chaque écran affiche la date de la dernière synchronisation.

**Un rendez-vous validé se définit une fois, dans le code, et jamais ailleurs.** Proposition par défaut, à confirmer en section 20 : un rendez-vous est validé s'il a eu lieu, n'a pas été annulé, et n'a pas été marqué hors cible par l'agence. Tant que le client n'a pas renseigné le statut dans GoHighLevel, le rendez-vous est compté comme prévu, pas comme validé, et l'écart apparaît explicitement.

## 7. Écran Onboarding

C'est la première chose que voit un nouveau client, et la porte d'entrée de toute la production. Tant qu'il n'est pas soumis, les autres écrans affichent un état vide expliquant ce qu'on attend.

### Le formulaire

Reprend les huit sections du formulaire Google existant (43 questions) : entreprise et contexte, le service, douleurs et bénéfices, le client idéal, offre et tarification, équipe et fonctionnement interne, positionnement et marché, objectifs et contraintes de campagne.

Ajouts par rapport au formulaire actuel, issus de ce qui a manqué sur les derniers clients :

- **Une scène de la journée de l'avatar**, pas une catégorie : ce qu'il fait à 8 h, ce qui l'agace, ce qu'il se dit.
- **Ce qui le retient de changer** et **ce qui l'inquiète** au moment de décider (les forces Anxiété et Habitude, absentes des formulaires classiques).
- **L'histoire du fondateur** : pourquoi il a créé ce produit, le moment précis, un échec dans l'histoire. Indispensable aux emails et à la VSL, jamais demandé à temps.
- **Les chiffres unitaires** : ticket moyen, durée de vie d'un client, marge brute, taux de closing en démo, capacité de rendez-vous par semaine. Ils servent au contrôle économique de la section 20.
- **Un cas client chiffré** et l'accord de le nommer.

Comportement : sauvegarde automatique à chaque champ, reprise possible plus tard, barre d'avancement par section, questions obligatoires signalées, envoi possible seulement quand les obligatoires sont remplies.

### Les ressources

Une zone de dépôt séparée, avec une liste de ce qui est attendu et son état : logo vectoriel, codes couleurs et police, captures du produit et du tableau de bord, témoignages et avis, enregistrements de calls de vente, accès au site. Chaque élément manquant reste visible en rouge tant qu'il n'est pas fourni — c'est ce qui a bloqué les montages de NWD et d'Euroinfo.

### Verrouillage et relance

À l'envoi, le formulaire passe en lecture seule pour le client et une notification part vers l'agence. Romain peut rouvrir une section précise pour demander un complément : seule cette section redevient modifiable, avec sa question en évidence et un message explicite.

Chaque réponse garde son historique. Une réponse modifiée après le début de la production apparaît en vue agence avec la mention de ce qui a changé, pour que les livrables déjà écrits soient revus.

## 8. Écran Tableau de bord

L'écran d'accueil du client. Il répond à une seule question : où j'en suis en ce moment. Il ne cherche pas à tout montrer — le détail est dans Pilotage.

**En-tête** : titre, phrase rappelant que les publicités Meta et le CRM sont réunis, date de la dernière synchronisation, sélecteur de période (7 j / 30 j / 90 j), bouton « Pilotage détaillé » qui bascule sur l'écran suivant avec la même période.

**Bandeau d'avancement**, tant que l'infrastructure n'est pas terminée : « Onboarding en cours · 3/10 · prochaine étape : contrat signé », cliquable vers l'écran Infrastructure. Il disparaît une fois les campagnes lancées, remplacé par le compteur de rendez-vous validés.

**Cartes d'indicateurs**, une ligne de cinq puis une ligne de trois : dépense publicitaire, leads Meta, clics sur le lien, nouveaux contacts CRM, rendez-vous pris, présence aux rendez-vous, ventes gagnées, encaissé. Chaque carte porte sa valeur, sa variation par rapport à la période précédente, et une mention secondaire (CTR, coût par rendez-vous, rendez-vous à venir).

Une carte sans donnée affiche un tiret et la raison, jamais zéro : « statuts non renseignés dans GHL » vaut mieux qu'un taux de présence à 0 %, qui ferait croire à un échec.

**Deux graphiques côte à côte**, par jour sur la période : dépense et leads d'un côté, nouveaux contacts et rendez-vous pris de l'autre. Barres, deux séries, légende sous le graphique.

**Tableau des campagnes** sur la période : campagne, dépense, clics, leads, coût par lead. Trié par dépense décroissante.

**Pipeline** : les étapes du pipeline GoHighLevel avec le nombre d'opportunités ouvertes et une barre proportionnelle. En dessous, les sources des contacts sur 90 jours.

**Compteur contractuel**, affiché dès le lancement des campagnes et jusqu'à la fin de la fenêtre : « Rendez-vous validés : 14 / 30 · 62 jours restants sur 90 ». Au survol, la définition exacte d'un rendez-vous validé et le lien vers la liste datée. C'est le seul endroit du produit où la définition doit être accessible en un clic.

## 9. Écran Pilotage

L'écran de travail. Six blocs numérotés, dans cet ordre.

**Barre de période** en haut : raccourcis 7 j, 14 j, 30 j, 90 j, « Ce mois », « Mois dernier », « Tout », plus les jalons de funnel enregistrés (« Depuis la VSL directe »), deux champs de dates libres, granularité jour / semaine / mois, case « vs période précédente », et le sélecteur de devise si le compte publicitaire n'est pas en euros.

**01 · Recommandations du jour.** Une carte par recommandation, avec une pastille de gravité (information, à surveiller, à corriger), un titre qui dit l'action, et deux à quatre phrases qui donnent les chiffres, le seuil dépassé et le geste exact à faire. À droite, la colonne « Alertes automatiques sur la période » : un encadré par seuil franchi, avec la valeur, l'objectif et une phrase expliquant pourquoi ce seuil compte. Chaque recommandation peut être marquée traitée ou ignorée, avec la date.

**02 · KPI clés.** Une grille de cartes, chacune avec sa valeur, sa variation et la valeur de la période précédente, et pour celles qui ont un seuil, une pastille : objectif tenu, à surveiller, à corriger, non mesuré. Indicateurs : dépense, rendez-vous réservés, coût par rendez-vous, visiteur → rendez-vous, nouveaux clients, chiffre d'affaires encaissé, ROAS encaissé, coût d'acquisition, clics, CTR, CPC, CPM, vues de VSL, taux d'annulation, taux de présence, MRR ajouté.

**03 · Du clic à la vente.** Le funnel en barres horizontales, échelle logarithmique : impressions, clics, pages chargées, vues de VSL, rendez-vous réservés, rendez-vous tenus, nouveaux clients. À droite de chaque palier, le taux de passage avec sa pastille de verdict. Sous le funnel, une ligne de coûts : par clic, par visiteur, par rendez-vous, par client.

**04 · Évolution.** Un graphique par indicateur, sélectionnable par onglets, avec la période précédente en pointillés et **des lignes verticales annotées aux changements de funnel** (« VSL directe », « calendrier simplifié », « iClosed + pubs IA »). Ces repères viennent de la table `funnel_events` et sont saisis par l'agence : sans eux, personne ne sait pourquoi une courbe décroche. En dessous, trois graphiques permanents : CPM, CTR et CPC, avec leur seuil en pointillé.

**05 · Campagnes.** Un tableau triable par colonne : campagne, budget par jour, dépense, impressions, CPM, clics, CTR, CPC, visiteurs, coût par visiteur, vues de VSL, opt-ins, rendez-vous.

**06 · Publicités.** Le tableau le plus important du produit, celui qui décide quoi couper. Une ligne par publicité avec son ensemble et son statut : dépense, impressions, CPM, CTR, CPC, visiteurs, coût par visiteur, vues de VSL, rendez-vous, **coût par rendez-vous**, taux de ThruPlay. Filtres « seulement celles qui ont dépensé » et « actives seulement ». Tri par défaut sur la dépense.

Une règle de lecture à appliquer partout : une publicité qui a dépensé sans produire un seul rendez-vous s'affiche en rouge avec le montant dépensé, pas avec un tiret. Sur le compte d'Obsidian, 1 755 € sont partis sur des créatives sans aucun rendez-vous sans que rien ne l'ait signalé.

## 10. Écran Infrastructure

L'écran qui remplace les Google Sheets « Suivi projet » et les relances par email. Il montre la chaîne de production dans l'ordre, ce qui est livré, et ce qu'on attend du client.

### La chaîne, en haut

Une frise horizontale des huit phases, chacune avec son état (à venir, en cours, livré, validé) : onboarding, offre de trafic froid, landing page, VSL, publicités vidéo, séquences, branchements et recette, lancement. La phase en cours est mise en avant avec sa date de début et ce qui la bloque s'il y a lieu.

### Les livrables, au centre

Une carte par livrable : titre, type, statut, date de publication, résumé de deux lignes écrit pour le client, et un bouton d'accès. L'accès est un lien externe (Google Doc, page publiée, vidéo, dossier Drive) ou un fichier déposé — l'espace ne fait pas d'éditeur de documents.

Quatre statuts seulement, pour que le client comprenne sans explication :

| Statut | Visible par le client | Ce que ça veut dire |
| --- | --- | --- |
| En préparation | Oui, sans accès au contenu | On y travaille |
| À relire | Oui, avec accès | Le client peut lire et commenter |
| Validé | Oui, avec accès | Figé, c'est la version de référence |
| Mis à jour | Oui, avec accès | Une nouvelle version remplace la précédente, l'ancienne reste accessible |

Les brouillons de l'agence n'existent pas pour le client : tant que Romain n'a pas publié, la carte affiche « en préparation » et rien d'autre. C'est le circuit de validation de la section 12.

Sur un livrable à relire, le client peut déposer un commentaire daté. Ces commentaires remontent dans la vue agence et dans l'espace feedback — ils ne modifient jamais le livrable.

### Les tâches, à droite

Deux colonnes séparées, parce que la confusion sur qui fait quoi est la première cause de retard : « Ce qu'on fait » et « Ce que vous faites ». Les tâches du client sont cochables par lui, portent une échéance et, quand c'est pertinent, un lien direct vers le guide correspondant (« Donner vos accès Meta » renvoie au guide pas-à-pas).

Une tâche client en retard apparaît en haut de son tableau de bord. Pas de notification email en v1.

## 11. Rapport, Connexions, Feedback, Guides

### Rapport

Un tableau comparant la période en cours à la précédente, ligne par indicateur, avec l'évolution en pourcentage : dépense, clics, leads, nouveaux contacts, rendez-vous pris, rendez-vous honorés, ventes, encaissé. Choix hebdomadaire ou mensuel.

Sous le tableau, un champ libre « Analyse et prochaines actions », pré-rempli par une synthèse des recommandations de la période, que Romain relit et modifie. Puis un bouton « Imprimer / PDF » qui produit une page propre, en-tête du client, pied de page Obsidian Partners.

Le rapport est figé à sa génération : il garde l'instantané des chiffres, pour qu'un rapport de novembre ne change pas quand les données se mettent à jour.

### Connexions

Une ligne par connexion, avec un état vert, orange ou rouge, la date du dernier contrôle, et en cas de problème une phrase qui dit quoi faire et un lien vers le guide.

À vérifier : accès au compte publicitaire Meta et validité du jeton, pixel et événements reçus dans les 24 h, API GoHighLevel et sous-compte, calendrier branché et créneaux ouverts, domaine et page publiée accessible, envoi d'emails configuré, formulaire instantané ou landing relié au CRM.

Côté agence, la même liste affiche en plus l'erreur technique, la date d'expiration du jeton et un bouton de test manuel.

Une connexion cassée bloque la synchronisation et doit donc apparaître aussi en haut du tableau de bord, sinon le client conclut à de mauvais résultats alors que la mesure est en panne.

### Feedback et réclamations

Un formulaire court : catégorie (bug, résultat décevant, demande, question), gravité, description, pièces jointes. Puis la liste des retours du client avec leur statut et la réponse de l'agence.

Deux règles de traitement :

- Un retour déclenche une entrée dans la vue agence avec le contexte automatiquement joint : chiffres des 7 derniers jours, état des connexions, dernières recommandations. Romain répond sans avoir à chercher.
- Les retours récurrents sur un même thème remontent dans la synthèse hebdomadaire de l'agence. C'est le mécanisme qui remplace la boucle des « 3 points manquants » aujourd'hui dispersée dans les documents.

### Guides

Une grille de cartes, une par procédure, en PDF ou en page : créer son portefeuille business et son compte publicitaire, donner ses accès Meta, prise en main du CRM, mettre à jour ses rendez-vous (présent, absent, vendu), donner l'accès au nom de domaine, tourner ses vidéos publicitaires, régler une facture.

Les guides sont communs à tous les clients, avec possibilité d'en épingler un pour un client précis. Un guide en brouillon n'est pas visible côté client, et la vue agence l'indique.

Le guide « mettre à jour ses rendez-vous » est le plus important du lot : sans lui, les statuts restent vides et le taux de présence, le ROAS et le compteur des 30 rendez-vous ne se calculent pas.

## 12. Vue agence

La vue agence ajoute deux écrans aux écrans client, et le circuit de publication.

### Console multi-clients

Un tableau, une ligne par client, trié par ce qui demande une action. Colonnes : client, offre, phase en cours, jours depuis le démarrage, compteur de rendez-vous validés sur l'objectif, dépense sur 7 jours, coût par rendez-vous sur 7 jours, état des connexions, recommandations non traitées, retours ouverts, tâches client en retard.

Une ligne passe en rouge sur trois conditions : une connexion cassée, aucun rendez-vous depuis 7 jours alors que la dépense tourne, ou une tâche client bloquante en retard de plus de 5 jours.

En haut, trois chiffres d'agence : dépense totale pilotée sur 30 jours, coût moyen par rendez-vous, nombre de clients dont le compteur est en retard sur le rythme nécessaire pour atteindre 30 rendez-vous dans la fenêtre.

### Circuit de publication

Chaque livrable, chaque recommandation et chaque guide a deux états : interne et publié. Romain travaille en interne, puis publie. La publication est un acte explicite, avec un bouton et une confirmation ; rien ne devient visible par un effet de bord.

Pour une recommandation, la publication peut s'accompagner d'une réécriture : la version interne peut dire « couper Ads 11 1, 10 € pour 0 rendez-vous », la version client dit la même chose en langage client. Les deux versions sont conservées.

Une case « publier automatiquement les recommandations » existe par client, désactivée par défaut. Tant qu'elle est désactivée, le client voit ses chiffres mais pas l'analyse tant que Romain ne l'a pas relue.

### Édition

Depuis la vue agence, Romain crée et modifie : clients, livrables, tâches, guides, jalons de funnel, seuils par client, et la définition de ce qui compte comme rendez-vous validé. Toute modification d'un seuil ou du compteur est journalisée dans `audit_log` avec la valeur avant et après.

## 13. Synchronisation quotidienne

Un job unique, déclenché par cron à 6 h 00 heure de Paris, qui boucle sur les clients actifs. Pour chaque client, dans l'ordre : Meta, puis GoHighLevel, puis calcul des agrégats, puis règles, puis rédaction des recommandations.

### Meta

API Marketing, niveau publicité, décomposition par jour. Jeton d'utilisateur système longue durée créé dans le Business Manager du client via l'accès partenaire ; cette création fait partie de l'onboarding technique et apparaît dans les tâches.

Champs : dépense, impressions, clics sur le lien, CTR, CPC, CPM, vues de page de destination, ThruPlay, actions de conversion et leurs valeurs, plus budget et statut au niveau campagne, ensemble et publicité. Récupérer l'identifiant numérique de la publicité en plus de son nom : sur le compte d'Obsidian, 1 289 € sont devenus non rattachables parce que `utm_content` portait l'identifiant et non le nom.

Fenêtre : les 7 derniers jours réécrits à chaque passage, parce que Meta consolide ses chiffres a posteriori. Au-delà, on ne touche plus.

### GoHighLevel

Jeton d'intégration privée par sous-compte. Récupérer : contacts créés avec leur source et leurs UTM, opportunités avec leur étape et leur statut, rendez-vous avec leur date de prise, leur date de tenue, leur statut et leur annulation, paiements enregistrés.

La jonction entre un lead Meta et un contact GHL se fait par UTM, à défaut par email, à défaut par téléphone. Les contacts non rattachables sont comptés et affichés — ils ne disparaissent pas silencieusement.

### Robustesse

- **Idempotent** : relancer le job deux fois ne double aucune ligne. Clé unique sur (client, date, identifiant de publicité).
- **Isolé par client** : l'échec d'un client n'empêche pas les autres. Un échec écrit une ligne dans `sync_runs` et bascule la connexion concernée en rouge.
- **Reprise manuelle** : une commande permet de rejouer un client ou une plage de dates, depuis la vue agence et en ligne de commande.
- **Limites d'appel** : respecter les quotas Meta, réessayer avec un délai croissant, ne jamais boucler indéfiniment.
- **Devises** : si le compte est dans une autre devise que l'euro, stocker la valeur d'origine, la devise et le taux du jour. Un client est en bahts, le cas se reproduira.

### Ce que le job ne fait pas

Il ne crée rien, ne modifie rien dans Meta ni dans GHL, et n'envoie aucun email. Il lit, calcule et écrit dans la base.

## 14. Moteur de recommandations

Deux étages, et l'ordre compte. **Les règles sont déterministes et calculées en SQL ; le modèle ne sert qu'à rédiger.** Un modèle qui déciderait seul quoi couper produirait des conseils différents d'un jour à l'autre sur les mêmes chiffres.

### Étage 1 : les règles

Chaque règle est une requête qui renvoie zéro ou plusieurs déclenchements, avec les chiffres qui l'ont déclenchée. Règles de départ :

| Règle | Condition | Gravité |
| --- | --- | --- |
| Créative à couper | Publicité active, dépense ≥ 1,5 × le coût par rendez-vous cible, 0 rendez-vous | À corriger |
| Créative à dupliquer | Coût par rendez-vous < 50 % de la moyenne du compte sur 7 j, dépense significative | Information |
| Budget à monter | Coût par rendez-vous sous le plafond depuis 3 jours, budget inchangé | À surveiller |
| CPM élevé | CPM > seuil sur 7 j | À surveiller |
| CTR faible | CTR < seuil, CPM normal | À surveiller |
| Lead qui ne booke pas | Coût par lead bas mais lead → rendez-vous sous la moitié de la moyenne du compte | À corriger |
| Statuts manquants | Rendez-vous passés sans statut présent / absent depuis plus de 24 h | À corriger |
| Annulations | Taux d'annulation > seuil sur 7 j | À corriger |
| Rythme contractuel | Rendez-vous validés en retard sur le rythme nécessaire pour atteindre l'objectif dans la fenêtre | À corriger |
| Mesure en panne | Aucun événement pixel ou aucun contact CRM depuis 48 h alors que la dépense tourne | À corriger |
| Fatigue créative | Fréquence en hausse et CTR en baisse sur la même publicité, 7 j glissants | À surveiller |

Les seuils par défaut, modifiables par client : CPM ≤ 15 €, CPC lien ≤ 1 €, CTR lien ≥ 1,5 %, ThruPlay ≥ 12 %, taux d'annulation ≤ 15 %, ROAS encaissé ≥ 3, coût par rendez-vous ≤ le plafond calculé pour ce client.

Le plafond du coût par rendez-vous se calcule à l'onboarding : ticket mensuel × durée de vie × marge brute × taux de closing × la part acceptable. Il s'affiche partout où un coût par rendez-vous apparaît. Repères Obsidian : 64 € par rendez-vous booké, 81 € par rendez-vous tenu, 446 € de coût d'acquisition.

### Étage 2 : la rédaction

Le job envoie à l'API Anthropic les déclenchements avec leurs chiffres, le contexte du client, et les recommandations des 7 derniers jours avec leur suite. Le modèle rend un JSON : titre, corps de deux à quatre phrases, gravité, version client.

Garde-fous : aucun chiffre qui ne figure pas dans les données transmises, une seule action par recommandation, pas plus de six recommandations par jour, et si l'appel échoue la recommandation s'affiche quand même avec son libellé de règle brut.

### Continuité

Une recommandation répétée trois jours de suite sans être traitée monte d'un cran en gravité et le dit : « le budget n'a pas bougé depuis ce matin ». Une recommandation traitée alimente le suivi : on sait ce qui a été fait et quand, et on peut relier un changement de courbe à une action.

## 15. Design system

La référence visuelle est l'espace Leadflows des captures : fond très sombre, un seul accent vif, titres en deux temps (romaine puis italique), libellés en petites capitales monospace, cartes à liseré coloré à gauche.

### Couleurs

Toutes les couleurs sont des variables CSS sur `:root`, redéfinies pour le mode clair. Le mode sombre est le défaut ; le bouton « Mode jour » bascule et la préférence est mémorisée.

| Rôle | Sombre | Usage |
| --- | --- | --- |
| Fond | proche du noir |  |
| Surface | gris très sombre | cartes |
| Bordure | gris sombre |  |
| Texte principal | blanc cassé |  |
| Texte secondaire | gris moyen | libellés, mentions |
| Accent | à définir pour Obsidian, le vert est celui de Leadflows | valeurs, états tenus, boutons |
| Avertissement | ambre | à surveiller |
| Alerte | rouge désaturé | à corriger |
| Vue agence | ambre | bandeau de bascule, mentions internes |

L'accent d'Obsidian Partners reste à trancher : le bleu de la charte existante (blanc et bleu) ou un accent propre à l'espace. À décider avant le premier écran.

### Typographie

Trois rôles : une sans-serif pour le texte et les chiffres, une serif italique pour le second mot des titres de section, une monospace pour les libellés en capitales, les dates et les identifiants. Les polices actuelles d'Obsidian sont Jost et IBM Plex Mono ; si elles sont retenues, le troisième rôle manque et il faut choisir la serif.

Les chiffres utilisent toujours des chiffres tabulaires : une colonne de montants doit s'aligner.

### Composants à construire une fois

Carte d'indicateur (valeur, variation, mention, liseré, pastille de verdict), pastille de verdict, carte de recommandation, tableau triable avec colonnes figées, graphique à barres, graphique en courbes avec série de comparaison en pointillés et repères verticaux annotés, funnel horizontal, frise de phases, zone de dépôt de fichiers, état vide avec explication et action.

### Règles d'affichage

Format français partout : espace avant le symbole euro, espace fine comme séparateur de milliers, dates en toutes lettres abrégées. Une donnée absente affiche un tiret et sa raison, jamais zéro. Une variation s'affiche en vert si elle va dans le bon sens pour l'indicateur concerné — une baisse du coût par rendez-vous est une bonne nouvelle.

Chaque écran porte sa date de dernière synchronisation, en haut, en monospace discret.

## 16. Sécurité, secrets, données personnelles

### Secrets

Les jetons Meta et GoHighLevel sont saisis par Romain dans l'interface d'administration ou en ligne de commande, chiffrés au repos, et ne sont jamais renvoyés au navigateur — même tronqués, même en vue agence. L'écran Connexions affiche l'état et la date d'expiration, pas la valeur.

Aucun secret dans le dépôt, aucun dans un fichier de configuration versionné, aucun dans les journaux. La clé de l'API Anthropic vit dans les secrets du Worker.

### Isolation

Chaque requête de données porte le `client_id` déduit de l'identité du jeton, jamais celui envoyé par le navigateur. Un test automatisé doit vérifier qu'un utilisateur du client A recevant une URL du client B obtient une erreur.

### Données personnelles

L'espace stocke des contacts issus du CRM du client : noms, emails, téléphones. Conséquences :

- Ne stocker que ce qui sert à l'affichage et au comptage. Pas de recopie intégrale des fiches contacts, pas de contenu de conversation.
- Les écrans client et agence affichent des agrégats. La liste nominative n'apparaît que sur la page des rendez-vous, parce que le compteur contractuel doit être vérifiable.
- Rétention : 24 mois glissants sur les données nominatives, agrégats conservés au-delà.
- Suppression d'un client : effacement complet de ses données sur demande, en une commande, avec confirmation.
- Le client reste responsable de traitement pour ses propres contacts ; Obsidian Partners est sous-traitant. Prévoir une page mentions et une clause dans le contrat.

### Journalisation

`audit_log` enregistre les publications de livrables, les modifications de seuils, les changements du compteur de rendez-vous, les connexions, les suppressions. Conservé 12 mois. Les journaux techniques ne contiennent ni jeton ni donnée personnelle.

## 17. Exigences non fonctionnelles

**Performance.** Un écran se charge en moins de 1,5 s sur une connexion ordinaire. Les indicateurs viennent de `metrics_rollup`, précalculé par le job : aucune agrégation lourde au moment de l'affichage. Les tableaux de publicités paginent au-delà de 100 lignes.

**Disponibilité.** Un incident de synchronisation ne rend jamais l'espace inaccessible : les chiffres de la veille restent affichés, avec la date de dernière mise à jour en évidence et un bandeau explicatif.

**Responsive.** Le client consulte souvent depuis son téléphone. Les cartes passent en colonne, les tableaux larges défilent horizontalement dans leur propre conteneur, la barre latérale devient un menu. Pilotage peut être allégé sur mobile, à condition que Tableau de bord, Infrastructure et Feedback soient complets.

**Accessibilité.** Contraste suffisant en mode sombre comme en mode clair, navigation au clavier, aucune information portée par la couleur seule : une pastille rouge porte aussi son libellé.

**Langue et formats.** Français uniquement, euros, fuseau Europe/Paris pour tout affichage. Les données brutes sont stockées en UTC. Un client dont le compte publicitaire est dans un autre fuseau verra ses journées calées sur le fuseau du compte, et l'espace le signale.

**Tests.** Au minimum : isolation entre clients, idempotence du job, calcul du compteur de rendez-vous validés, calcul des règles sur un jeu de données figé, rendu du rapport PDF. Un jeu de données de démonstration permet de lancer l'application sans connexion Meta ni GHL.

## 18. Lots de livraison

Huit lots, livrés dans l'ordre, chacun déployé et utilisable avant de passer au suivant. Un lot n'est pas terminé tant que son critère d'acceptation n'est pas vérifié sur un vrai client.

**Lot 0 — Décision sur Leadflows.** Inspecter le dépôt existant, trancher entre reprise et construction neuve, écrire la décision dans `/docs/decisions/`. *Acceptation : la décision est écrite et argumentée.*

**Lot 1 — Socle.** Dépôt, déploiement, base, migrations, authentification, les deux rôles, la bascule de vue, la coquille des écrans avec des données de démonstration. *Acceptation : Romain et un client de test se connectent, chacun ne voit que ce qui le concerne.*

**Lot 2 — Onboarding et Infrastructure.** Formulaire complet, dépôt de ressources, verrouillage, livrables, tâches, circuit de publication. *Acceptation : un vrai client remplit son onboarding de bout en bout et voit un livrable publié.*

**Lot 3 — Synchronisation.** Connecteurs Meta et GHL, job quotidien, `metrics_daily`, `metrics_rollup`, écran Connexions. *Acceptation : les chiffres de l'espace correspondent au gestionnaire Meta à moins de 2 % près sur 30 jours, pour deux clients.*

**Lot 4 — Tableau de bord.** Cartes, graphiques, campagnes, pipeline, compteur de rendez-vous validés. *Acceptation : le compteur donne le même nombre qu'un comptage manuel dans GHL.*

**Lot 5 — Pilotage.** Les six blocs, les seuils, les verdicts, le funnel, l'évolution avec repères, les tableaux campagnes et publicités. *Acceptation : le tableau des publicités fait apparaître une créative à couper que Romain aurait repérée lui-même.*

**Lot 6 — Recommandations.** Règles en SQL, rédaction par l'API, publication, suivi des recommandations traitées. *Acceptation : une semaine de recommandations relues par Romain, aucune ne contient de chiffre faux.*

**Lot 7 — Rapport, Feedback, Guides.** Rapport PDF, espace de retours, bibliothèque de guides. *Acceptation : un rapport mensuel est envoyé à un client depuis l'espace.*

**Lot 8 — Bascule.** Migration des clients actifs, reprise de l'historique disponible, arrêt des Google Sheets « Suivi projet ». *Acceptation : plus aucun suivi de production ne vit ailleurs que dans l'espace.*

Le lot 8 est le seul qui compte vraiment : tant que deux sources coexistent, l'espace devient une corvée de recopie et finit abandonné.

## 19. Garde-fous pour la session de build

À recopier dans `CLAUDE.md`.

- **Aucune écriture dans Meta.** Pas de création, pas de pause, pas de budget, pas de publication. Les appels sont en lecture seule, et le client API ne doit même pas exposer de méthode d'écriture.
- **Aucune écriture dans GoHighLevel** sans décision explicite inscrite dans `/docs/decisions/`. Par défaut, lecture seule.
- **Aucun email envoyé** par l'application en v1.
- **Aucun chiffre inventé.** Une valeur affichée vient de la base ou d'un calcul documenté. Pas de valeur par défaut qui ressemble à une donnée, pas de zéro à la place d'une absence de mesure.
- **Aucune donnée de démonstration en production.** Le jeu de démonstration est marqué comme tel et refusé par l'environnement de production.
- **Pas de secret écrit par Claude Code.** Les jetons sont saisis par Romain. Si un secret apparaît dans le dépôt ou dans un journal, c'est un défaut bloquant.
- **Pas de migration rétroactive.** Une migration appliquée n'est jamais modifiée.
- **Pas de refonte non demandée.** Si une évolution semble nécessaire, elle s'écrit dans `/docs/decisions/` et attend l'accord de Romain.
- **Ce document fait foi.** En cas de contradiction entre une idée en cours de session et ce cahier des charges, c'est le cahier des charges qui gagne, jusqu'à ce qu'il soit modifié explicitement.

## 20. Décisions à trancher

À remplir avant le lot 1 pour les six premières, avant le lot concerné pour les autres. Tant qu'une case est vide, Claude Code applique la proposition par défaut et le note.

- [ ] **Reprise de Leadflows ou construction neuve** (lot 0). Le dépôt est-il accessible et réutilisable ?
- [ ] **Nom et domaine de l'espace.** Sous-domaine d'obsidianpartners.fr, ou marque distincte comme Leadflows ?
- [ ] **Définition du rendez-vous validé.** Proposition : tenu, non annulé, non marqué hors cible. Qui tranche un cas limite, et le client peut-il contester ?
- [ ] **Qui renseigne les statuts de rendez-vous.** Le client dans GHL, ou Romain ? Sans réponse, le taux de présence et le ROAS resteront non mesurés, comme aujourd'hui.
- [ ] **Accent de couleur** et choix des trois polices.
- [ ] **Publication automatique des recommandations** : par défaut désactivée. Confirmer.
- [ ] **Les clients voient-ils le coût par rendez-vous par créative ?** Argument pour : transparence et crédibilité des décisions. Argument contre : un client qui pilote lui-même sur une donnée bruitée à faible volume.
- [ ] **L'espace affiche-t-il les factures ?** Leadflows a cet écran. À inclure ou non en v1.
- [ ] **Les anciens clients sont-ils migrés**, ou l'espace ne sert-il qu'aux nouveaux à partir d'une date ?
- [ ] **Écriture dans GHL** : autorise-t-on la note et l'étiquette sur un contact, ou lecture seule stricte ?
- [ ] **Durée de rétention** des données nominatives : 24 mois proposés.
- [ ] **Budget mensuel accepté** pour l'hébergement et l'API : l'ordre de grandeur est de 5 à 30 $ par mois.

### Les trois points où ce cahier des charges manque de matière

1. **Le contenu réel du dépôt Leadflows.** Tout le lot 0 en dépend, et la section 5 pourrait être caduque.
2. **Le détail des champs GoHighLevel** réellement remplis chez les clients : sans savoir quels statuts, étapes et sources sont renseignés, les règles de la section 14 restent théoriques.
3. **Ce que les clients demandent aujourd'hui par message.** Les questions récurrentes devraient dicter l'ordre des écrans ; elles n'ont jamais été relevées.
