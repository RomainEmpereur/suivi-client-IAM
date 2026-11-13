-- Vos publicités, historique (décision 0026) : visuels des publicités d'une période passée, quel que soit leur statut actuel.
-- Lus dans Meta à la demande (lecture seule) et gardés en cache ; les adresses d'images sont temporaires, relues au-delà de 2 jours.
CREATE TABLE meta_ad_creatives (
  client_id         TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  ad_id             TEXT NOT NULL,
  name              TEXT,
  campaign_name     TEXT,
  created_time      TEXT,
  effective_status  TEXT,          -- statut au moment de la lecture ; NULL = Meta ne rend plus la publicité (supprimée)
  object_type       TEXT,
  title             TEXT,
  body              TEXT,
  thumbnail_url     TEXT,
  image_url         TEXT,
  preview_url       TEXT,
  fetched_at        TEXT NOT NULL,
  PRIMARY KEY (client_id, ad_id)
);
