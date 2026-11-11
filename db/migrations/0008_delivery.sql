-- Delivery piloté par l'espace (décision 0008) : suivi des étapes 0 à 8 du master prompt, par client.
-- La rédaction se fait dans le projet Claude de delivery ; l'espace garde l'état, le lien du résultat et la validation.
CREATE TABLE delivery_steps (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  step          TEXT NOT NULL,                 -- clé d'étape (packages/domain/src/delivery.ts)
  status        TEXT NOT NULL DEFAULT 'a_faire' CHECK (status IN ('a_faire','en_cours','a_valider','valide')),
  result_url    TEXT,                          -- lien du document produit (Drive, Google Doc…)
  notes         TEXT,                          -- notes internes agence
  validated_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (client_id, step)
);
CREATE INDEX idx_delivery_steps_client ON delivery_steps(client_id);

-- Nom du mécanisme choisi par le client à l'étape 1C : verrouille toute la suite.
ALTER TABLE clients ADD COLUMN delivery_mechanism TEXT;
