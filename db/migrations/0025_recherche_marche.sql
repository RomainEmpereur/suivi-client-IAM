-- 0025 — Prospects : recherche marché rédigée par Claude (décision 0032).
-- Nouveau type de document « recherche » : la contrainte CHECK de prospect_documents.type est élargie (table reconstruite,
-- données conservées à l'identique).
CREATE TABLE prospect_documents_new (
  id              TEXT PRIMARY KEY,
  prospect_id     TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('analyse','recherche','plan','script_loom','pitch_r2')),
  version         INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'en_file' CHECK (status IN ('en_file','brouillon','valide','erreur')),
  content_json    TEXT,
  instruction     TEXT,
  model           TEXT,
  generated_at    TEXT,
  validated_at    TEXT,
  edited_by_hand  INTEGER NOT NULL DEFAULT 0 CHECK (edited_by_hand IN (0,1)),
  last_error      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (prospect_id, type, version)
);
INSERT INTO prospect_documents_new (id, prospect_id, type, version, status, content_json, instruction, model, generated_at, validated_at, edited_by_hand, last_error, created_at, updated_at)
  SELECT id, prospect_id, type, version, status, content_json, instruction, model, generated_at, validated_at, edited_by_hand, last_error, created_at, updated_at FROM prospect_documents;
DROP TABLE prospect_documents;
ALTER TABLE prospect_documents_new RENAME TO prospect_documents;
CREATE INDEX idx_prospect_documents_queue ON prospect_documents(status) WHERE status = 'en_file';
