-- 0012 — Encaissements saisis par le client et alertes quotidiennes de l'agence (décision 0014).

-- Encaissements : saisis à la main par le client (ou l'agence), seule source du chiffre d'affaires encaissé et du ROAS.
-- Ils alimentent metrics_daily par une ligne « encaissement_manuel » par jour (source = 'manuel'), jamais touchée par les synchros.
CREATE TABLE cash_entries (
  id                  TEXT PRIMARY KEY,
  client_id           TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date                TEXT NOT NULL,                       -- jour d'encaissement (AAAA-MM-JJ, Paris)
  amount_cents        INTEGER NOT NULL CHECK (amount_cents > 0),
  label               TEXT,                                -- ex. « Acompte client X », facture…
  created_by_user_id  TEXT,
  created_by_role     TEXT NOT NULL DEFAULT 'client' CHECK (created_by_role IN ('client','agence')),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_cash_client_date ON cash_entries (client_id, date);

-- Alertes quotidiennes (vue agence uniquement) : une ligne par règle déclenchée, réécrites à chaque calcul du jour.
ALTER TABLE alerts ADD COLUMN run_date TEXT;            -- jour du calcul (Paris)
ALTER TABLE alerts ADD COLUMN rule_key TEXT;
ALTER TABLE alerts ADD COLUMN title TEXT;
ALTER TABLE alerts ADD COLUMN detail TEXT;
ALTER TABLE alerts ADD COLUMN entity_id TEXT;           -- publicité ou campagne concernée, le cas échéant
CREATE INDEX idx_alerts_run ON alerts (run_date, client_id);
