-- Leads du CRM (décision 0013) : liste légère des opportunités du pipeline suivi, réécrite à chaque synchro GHL,
-- pour vérifier un nom quand le client ajoute un rendez-vous à la main. Aucun écran n'appelle GHL en direct.
CREATE TABLE crm_leads (
  client_id         TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  opportunity_id    TEXT NOT NULL,
  contact_id        TEXT NOT NULL,
  name              TEXT,
  company           TEXT,
  pipeline_name     TEXT,
  stage_name        TEXT,
  status            TEXT,
  source            TEXT,
  entered_at        TEXT,
  next_appointment_at TEXT,
  synced_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (client_id, opportunity_id)
);
CREATE INDEX idx_crm_leads_name ON crm_leads(client_id, name);

-- Rendez-vous saisi à la main rattaché à un lead du CRM (évite de le compter deux fois avec la synchro).
ALTER TABLE appointments ADD COLUMN ghl_contact_id TEXT;
