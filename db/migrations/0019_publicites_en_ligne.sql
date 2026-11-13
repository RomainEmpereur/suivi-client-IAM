-- Publicités en ligne (décision 0026) : ce que le client voit de ses publicités actives.
-- Page Facebook du client : lien vers la bibliothèque publicitaire Meta (publique). Saisie dans la fiche, ou lue à la synchro.
ALTER TABLE clients ADD COLUMN facebook_page_id TEXT;

-- Publicités actives au dernier passage de la synchro Meta (lecture seule) ; la table est réécrite à chaque passage.
CREATE TABLE meta_ads_live (
  client_id      TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  ad_id          TEXT NOT NULL,
  name           TEXT,
  campaign_name  TEXT,
  created_time   TEXT,
  object_type    TEXT,           -- VIDEO, PHOTO, SHARE…
  title          TEXT,
  body           TEXT,
  thumbnail_url  TEXT,           -- adresse du CDN Meta, signée et temporaire : rafraîchie chaque jour
  image_url      TEXT,
  preview_url    TEXT,           -- lien d'aperçu partageable de Meta
  page_id        TEXT,
  synced_at      TEXT NOT NULL,
  PRIMARY KEY (client_id, ad_id)
);
