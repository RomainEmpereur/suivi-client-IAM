-- Analyse ponctuelle des campagnes (décision 0011) : l'agence demande une analyse sur une période ;
-- Claude (session dédiée, abonnement) lit les chiffres de l'espace et les publicités Meta (lecture seule),
-- puis dépose une synthèse et des recommandations, internes jusqu'à la publication par l'agence.
CREATE TABLE analyses (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_from     TEXT NOT NULL,
  period_to       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente','en_cours','terminee','echec')),
  requested_by    TEXT,
  requested_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at      TEXT,
  completed_at    TEXT,
  data_json       TEXT,                 -- instantané des chiffres transmis à l'analyse (aucun chiffre hors de ces données)
  summary_md      TEXT,                 -- synthèse interne
  client_summary_md TEXT,               -- synthèse en langage client
  error           TEXT,
  visible_client  INTEGER NOT NULL DEFAULT 0 CHECK (visible_client IN (0,1)),
  published_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_analyses_client ON analyses(client_id, requested_at);
CREATE INDEX idx_analyses_queue ON analyses(status) WHERE status IN ('en_attente','en_cours');

ALTER TABLE recommendations ADD COLUMN analysis_id TEXT REFERENCES analyses(id) ON DELETE CASCADE;
CREATE INDEX idx_recos_analysis ON recommendations(analysis_id);
