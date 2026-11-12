-- Delivery automatique (décision 0009) : Claude rédige toute la chaîne après l'onboarding,
-- l'agence relit, modifie et valide chaque pièce ; une pièce client validée est publiée dans l'espace du client.
ALTER TABLE delivery_steps ADD COLUMN content_md TEXT;              -- texte du livrable (markdown)
ALTER TABLE delivery_steps ADD COLUMN content_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE delivery_steps ADD COLUMN content_source TEXT;          -- 'claude' | 'agence'
ALTER TABLE delivery_steps ADD COLUMN generated_at TEXT;            -- dernier dépôt de Claude
ALTER TABLE delivery_steps ADD COLUMN queued_at TEXT;               -- demande de (re)génération en attente
ALTER TABLE delivery_steps ADD COLUMN instruction TEXT;             -- consigne de reprise donnée par l'agence
ALTER TABLE delivery_steps ADD COLUMN stale INTEGER NOT NULL DEFAULT 0 CHECK (stale IN (0,1)); -- « à revoir » : une étape amont a changé
ALTER TABLE delivery_steps ADD COLUMN last_error TEXT;              -- dernier échec signalé par la génération

CREATE TABLE delivery_versions (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  step          TEXT NOT NULL,
  version       INTEGER NOT NULL,
  content_md    TEXT NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('claude','agence')),
  instruction   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (client_id, step, version)
);
CREATE INDEX idx_delivery_versions_client ON delivery_versions(client_id, step);
CREATE INDEX idx_delivery_steps_queue ON delivery_steps(queued_at) WHERE queued_at IS NOT NULL;

-- Texte du livrable publié au client (lu dans son espace, mis en page).
ALTER TABLE deliverables ADD COLUMN content_md TEXT;
