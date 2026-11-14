-- Module Prospects (section 29, décision 0027) : du R1 au R2, vue agence uniquement.
-- Tables séparées de clients, sans client_id obligatoire (seule exception à la section 6) : client_id n'est renseigné qu'après signature.
-- Rédaction par la tâche Claude planifiée (même file que le delivery), jamais par le job quotidien.

CREATE TABLE prospects (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  software         TEXT,
  website          TEXT,
  email            TEXT,
  phone            TEXT,
  source           TEXT NOT NULL DEFAULT 'publicite' CHECK (source IN ('publicite','recommandation','autre')),
  stage            TEXT NOT NULL DEFAULT 'r1_a_prevoir' CHECK (stage IN
                     ('r1_a_prevoir','r1_fait','analyse_validee','plan_valide','loom_envoye','r2_planifie','signe','perdu','a_relancer')),
  verdict          TEXT CHECK (verdict IN ('qualifie','a_creuser','disqualifie')),
  force_continue   INTEGER NOT NULL DEFAULT 0 CHECK (force_continue IN (0,1)),  -- Romain force la suite malgré « disqualifié »
  main_objection   TEXT,
  market_research  TEXT,          -- champ libre « Recherche marché » collé par Romain
  case_study_id    TEXT,
  loom_url         TEXT,
  loom_sent_on     TEXT,
  offer_text       TEXT,          -- l'offre pour ce prospect (saisie par Romain)
  offer_price      TEXT,          -- le prix pour ce prospect (saisi par Romain ; jamais proposé par le modèle)
  outcome_reason   TEXT,
  signed_amount_cents INTEGER,
  client_id        TEXT REFERENCES clients(id) ON DELETE SET NULL,
  last_action_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_prospects_stage ON prospects(stage);

-- Les chiffres du prospect, chacun avec son origine.
CREATE TABLE prospect_figures (
  prospect_id  TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  key          TEXT NOT NULL CHECK (key IN ('ticket_mensuel','duree_vie_mois','taux_closing','capacite_demos_semaine',
                 'clients_payants','budget_pub_jour','objectif_3_mois')),
  value        REAL,
  origin       TEXT NOT NULL CHECK (origin IN ('trame','transcription','manuel')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (prospect_id, key)
);

CREATE TABLE call_templates (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('r1','r2')),
  version     INTEGER NOT NULL,
  blocks_json TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (type, version)
);

CREATE TABLE prospect_calls (
  id                 TEXT PRIMARY KEY,
  prospect_id        TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  type               TEXT NOT NULL CHECK (type IN ('r1','r2')),
  scheduled_at       TEXT,
  status             TEXT NOT NULL DEFAULT 'prevu' CHECK (status IN ('prevu','tenu','absent','annule')),
  template_version   INTEGER,
  notes_json         TEXT,          -- réponses saisies dans la trame
  transcript         TEXT,
  transcript_origin  TEXT CHECK (transcript_origin IN ('collee','fathom')),
  recording_url      TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (prospect_id, type)
);

-- Ce que l'espace rédige. Chaque génération crée une version ; une version validée n'est jamais écrasée.
CREATE TABLE prospect_documents (
  id              TEXT PRIMARY KEY,
  prospect_id     TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('analyse','plan','script_loom','pitch_r2')),
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
CREATE INDEX idx_prospect_documents_queue ON prospect_documents(status) WHERE status = 'en_file';

CREATE TABLE case_studies (
  id          TEXT PRIMARY KEY,
  client      TEXT NOT NULL,
  target      TEXT,
  vertical    TEXT,
  figures     TEXT,          -- chiffres officiels, saisis une fois par Romain
  url         TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Cas de départ : chiffres officiels vides, à saisir par Romain (rien d'inventé).
INSERT INTO case_studies (id, client, sort) VALUES ('cs_civex','Civex',1),('cs_invoicing','Invoicing Plus',2),('cs_enobase','Enobase',3),('cs_ecommercio','Ecommercio',4);

-- Marge acceptable par défaut pour le coût maximum d'un rendez-vous : 25 %.
INSERT OR IGNORE INTO agency_settings (key, value) VALUES ('prospects_marge_acceptable', '0.25');
