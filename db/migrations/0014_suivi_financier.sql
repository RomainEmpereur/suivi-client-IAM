-- 0014 — Suivi financier de l'agence (décision 0019) : deals signés, réservés à l'agence, jamais visibles d'un client.
CREATE TABLE agency_deals (
  id             TEXT PRIMARY KEY,
  client_name    TEXT NOT NULL,                          -- nom libre : beaucoup de clients signés n'ont pas d'espace
  client_id      TEXT REFERENCES clients(id) ON DELETE SET NULL,
  deal_date      TEXT NOT NULL,                          -- jour de signature (AAAA-MM-JJ, Paris)
  amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
  kind           TEXT NOT NULL DEFAULT 'nouveau' CHECK (kind IN ('nouveau','renouvellement','upsell')),
  installments   INTEGER NOT NULL DEFAULT 1 CHECK (installments BETWEEN 1 AND 36), -- paiement mensuel en N fois
  source         TEXT NOT NULL DEFAULT 'inconnue' CHECK (source IN ('publicite','autre','inconnue')),
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_agency_deals_date ON agency_deals (deal_date);

-- Réglages de l'agence (clé / valeur). « acquisition_client_id » : le client de l'espace dont les chiffres Meta et CRM
-- sont ceux de l'acquisition de l'agence elle-même (dépense, leads, rendez-vous).
CREATE TABLE agency_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
