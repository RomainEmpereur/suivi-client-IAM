# Relevé des données réelles — Obsidian Partners (11 nov. 2026)

Lecture seule via les connecteurs Meta et GoHighLevel, pour combler le point n° 2 du §20
(« le détail des champs GoHighLevel réellement remplis »). Agrégats uniquement : aucune donnée nominative ici.

## Meta — compte « IOC Ad account » (1258124022912188)
- Devise EUR. 90 derniers jours : 170 publicités, dont **46 avec dépense** ; **1 312,61 €** dépensés ;
  75 031 impressions ; 1 285 clics sur le lien ; 675 vues de page de destination ; 102 leads ; 4 602 ThruPlays.
- Dépense concentrée sur 2 campagnes : « leads - Opt-in - 20/09/26 - Saas » (558,65 €) et « I.A.M - 05/08 - Winners adaptés FR » (546,87 €).
- Trois types de résultat coexistent selon les campagnes : formulaire instantané (`leadgen.other`),
  pixel Lead (`offsite_conversion.fb_pixel_lead`), pixel **Schedule** (`conversions:schedule_website`).
  → Le connecteur doit lire les trois, et ne pas se limiter à `lead`.

## GoHighLevel — sous-compte « Obsidian Partners »
- **Calendrier de vente** : « Analyse commerciale - L'infrastructure d'acquisition » (créneaux de 30 min, pixel Meta branché).
  Un second calendrier « O-T-O » existe, sans rendez-vous récents.
- **Rendez-vous sur ~90 jours** : 23 ; statuts utilisés : `confirmed` (17), `cancelled` (5), `noshow` (1).
  **Aucun rendez-vous n'a jamais été passé à `showed`** : avec la définition actuelle (§6), le compteur de rendez-vous
  validés vaudrait 0 et le taux de présence serait « non mesuré ». C'est exactement le risque signalé au §20.
- Plusieurs rendez-vous sont des **tests internes** ou des réservations fantaisistes (annulés) : prévoir l'exclusion
  « hors cible / test » par l'agence (déjà dans le modèle : `counts_toward_target = 0` + motif).
- **Pipelines** : « 1. Sales Pipeline » (11 étapes, de New Lead à Deal Lost) et « Setter … Pipeline de Vente » (12 étapes).
  → Il faudra choisir le pipeline affiché sur le tableau de bord (réglage par client).
- **Attribution** : la fiche contact porte `attributionSource` avec **`adId`, `adSetId`, `campaignId` numériques**
  (et `formName`, `utmContent` = nom de la pub). `lastAttributionSource.utm_content` contient l'**identifiant** de la pub,
  pas son nom. → Jointure lead Meta ↔ contact GHL par **`attributionSource.adId`**, en priorité sur l'UTM (§13).
- Champs personnalisés de qualification renseignés au formulaire (budget, taille d'équipe, rôle, canaux d'acquisition,
  panier moyen) : utiles plus tard pour la qualité des leads, pas stockés en v1 (minimisation, §16).

## Conséquences pour le lot 3
1. Lire les trois types de conversion Meta ; garder l'identifiant numérique de la publicité.
2. Joindre par `attributionSource.adId`, puis UTM, puis email, puis téléphone ; compter les non rattachés.
3. Correspondance des statuts GHL : `confirmed` → prévu, `showed` → honoré, `noshow` → absent, `cancelled` → annulé.
4. Décision §20 à prendre **avant** la mise en production : qui passe les rendez-vous en `showed`, et quand.
