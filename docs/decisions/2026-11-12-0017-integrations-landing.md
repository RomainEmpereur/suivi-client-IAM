# 0017 — Intégrations de la landing : VSL Wistia et calendrier GoHighLevel

**Statut :** acceptée (Romain, 12 nov. 2026). La validation par le client (bouton, commentaires) est reportée.

## Besoin
Le design de la landing se valide avant que la VSL soit tournée et hébergée, et avant que le calendrier soit prêt.
L'agence fournit ensuite deux codes d'intégration : Wistia (VSL) et le calendrier GoHighLevel.

## Décision
- La landing livrée contient deux zones balisées, exigées par le master prompt (section 6) :
  `<!-- OBSIDIAN:VSL:DEBUT -->…<!-- OBSIDIAN:VSL:FIN -->` et `<!-- OBSIDIAN:CALENDRIER:DEBUT -->…<!-- OBSIDIAN:CALENDRIER:FIN -->`.
  Entre les repères, seulement la maquette ; le cadre et la mise en page restent à l'extérieur.
- Dans l'étape 3 du Delivery, un encadré « Intégrations » reçoit les deux codes (migration 0013, `delivery_steps.integrations_json`,
  agence uniquement, 20 000 caractères au plus, balises iframe / script / div exigées).
- L'espace remplace le contenu de chaque zone par le code (`packages/domain/src/integrations.ts`, déterministe, repères conservés) :
  aucune régénération, le design validé ne bouge pas. Les codes survivent aux nouvelles versions de la landing.
- « Voir la version finale » (aperçu isolé) et « Copier le code final » à coller dans le bloc de code personnalisé de la page GHL.
- L'aperçu reste isolé (iframe sans `allow-same-origin`) : un lecteur qui exige un stockage local peut ne pas s'y lancer,
  il fonctionne sur la page publiée.
