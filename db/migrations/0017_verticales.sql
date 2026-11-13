-- 0017 — Verticales (décision 0024) : une chaîne de delivery complète de plus, pour un autre avatar du même client.
-- Les étapes d'une verticale sont stockées dans delivery_steps / delivery_versions sous la clé « <étape>@<id verticale> »
-- (ex. s1c@vt_abc) : la contrainte UNIQUE (client_id, step) reste valable, la verticale principale garde « s1c ».
CREATE TABLE verticals (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,                 -- ex. « Espaces verts — jardiniers-paysagistes »
  avatar          TEXT NOT NULL,                 -- l'avatar visé, en quelques phrases
  market          TEXT,                          -- marché, zone, taille des structures
  competitors     TEXT,                          -- concurrents propres à cette verticale
  promise_changes TEXT,                          -- ce qui change dans la promesse, la douleur, les preuves
  notes           TEXT,
  mechanism       TEXT,                          -- mécanisme nommé de la verticale (fixé à son étape 1C)
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archivee')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_verticals_client ON verticals (client_id, created_at);

-- Activées client par client (agence).
ALTER TABLE clients ADD COLUMN verticals_enabled INTEGER NOT NULL DEFAULT 0 CHECK (verticals_enabled IN (0,1));
-- Livrable d'une verticale (NULL = verticale principale).
ALTER TABLE deliverables ADD COLUMN vertical_id TEXT REFERENCES verticals(id) ON DELETE SET NULL;
