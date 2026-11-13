-- Vos publicités (décision 0026) : date de la dernière lecture des publicités actives, même quand il n'y en a aucune.
-- Distingue « pas encore lu dans Meta » de « aucune publicité active ».
ALTER TABLE clients ADD COLUMN ads_live_synced_at TEXT;
-- Clients déjà lus (Ecommercio, 13 nov.) : date reprise de la liste existante.
UPDATE clients SET ads_live_synced_at = (SELECT MAX(synced_at) FROM meta_ads_live m WHERE m.client_id = clients.id) WHERE ads_live_synced_at IS NULL;
