# 0021 — Leads Meta : formulaires instantanés uniquement

**Statut :** acceptée (Romain, 13 nov. 2026).

## Constat
La synchro Meta prenait le premier compteur disponible parmi `lead`, `onsite_conversion.lead_grouped` et
`offsite_conversion.fb_pixel_lead`. Or `lead` est le total formulaires + pixel. Sur le compte d'Obsidian Partners, un pixel posé
sur une page comptait un prospect à chaque visite : 23 « leads » sur 7 jours au lieu des 7 prospects des formulaires
(11 → 13 nov.).

## Décision
- Les leads de l'espace = **prospects des formulaires instantanés** uniquement (`onsite_conversion.lead_grouped`, à défaut
  `leadgen_grouped`), la colonne « Prospects (formulaire) » du gestionnaire de publicités. Le pixel n'est jamais compté.
- La synchro quotidienne recalcule les 30 derniers jours ; l'historique plus ancien se corrige par une synchronisation manuelle
  sur la période (écran Connexions, vue agence).
