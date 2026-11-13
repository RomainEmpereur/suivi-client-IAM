-- Optimisations (décision 0025) : reprise ciblée de pièces déjà en ligne (ads, formulaire, landing, séquences, structure),
-- avec constat, hypothèse, réécriture par Claude, validation, date de mise en ligne, mesure avant/après sur 14 jours et verdict.
-- Visible de l'agence et du client (le client la voit une fois les pièces validées). Aucune pièce aval n'est marquée « à revoir ».
CREATE TABLE optimisations (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  vertical_id     TEXT REFERENCES verticals(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  constat         TEXT NOT NULL,
  hypothese       TEXT NOT NULL,
  consigne        TEXT,
  source          TEXT NOT NULL DEFAULT 'manuelle' CHECK (source IN ('manuelle','analyse','point_hebdo')),
  source_ref      TEXT,
  status          TEXT NOT NULL DEFAULT 'en_preparation' CHECK (status IN ('en_preparation','prete','en_ligne','terminee','abandonnee')),
  launched_on     TEXT,           -- date de mise en ligne (AAAA-MM-JJ, Paris)
  verdict         TEXT CHECK (verdict IN ('garder','revenir')),
  verdict_note    TEXT,
  verdict_at      TEXT,
  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_optimisations_client ON optimisations(client_id, created_at);

CREATE TABLE optimisation_pieces (
  id               TEXT PRIMARY KEY,
  optimisation_id  TEXT NOT NULL REFERENCES optimisations(id) ON DELETE CASCADE,
  client_id        TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  step             TEXT NOT NULL,  -- étape visée : s3, s4, s5, s6 ou s7
  status           TEXT NOT NULL DEFAULT 'a_rediger' CHECK (status IN ('a_rediger','en_file','a_relire','validee')),
  content_md       TEXT,
  content_version  INTEGER NOT NULL DEFAULT 0,
  content_source   TEXT,
  instruction      TEXT,           -- consigne de reprise de l'agence sur la proposition
  queued_at        TEXT,
  generated_at     TEXT,
  validated_at     TEXT,
  last_error       TEXT,
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (optimisation_id, step)
);
CREATE INDEX idx_optimisation_pieces_queue ON optimisation_pieces(queued_at) WHERE queued_at IS NOT NULL;
