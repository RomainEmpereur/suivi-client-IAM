-- 0001 — Schéma initial (cahier des charges §6)
-- Règles : montants en centimes d'euro ; dates/horodatages en UTC (ISO 8601) ;
-- toutes les tables portent created_at / updated_at ; client_id partout sauf clients et users.
-- Une migration appliquée n'est JAMAIS modifiée : tout changement passe par une nouvelle migration.

PRAGMA foreign_keys = ON;

-- ───────────────────────────── Clients & utilisateurs ─────────────────────────────

CREATE TABLE clients (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  slug                    TEXT NOT NULL UNIQUE,
  logo_url                TEXT,
  status                  TEXT NOT NULL DEFAULT 'prospect'
                          CHECK (status IN ('prospect','onboarding','build','actif','pause','termine')),
  offer                   TEXT,                                -- libellé de l'offre (ex. « Standard 1 500 € + 1 500 € »)
  start_date              TEXT,                                -- date de démarrage du contrat (AAAA-MM-JJ)
  campaigns_launched_at   TEXT,                                -- début de la fenêtre contractuelle (AAAA-MM-JJ)
  appointment_target      INTEGER NOT NULL DEFAULT 30,
  window_days             INTEGER NOT NULL DEFAULT 90,
  thresholds_json         TEXT NOT NULL DEFAULT '{}',          -- seuils personnalisés (surcharge des défauts §14)
  unit_economics_json     TEXT NOT NULL DEFAULT '{}',          -- ticket, durée de vie, marge, closing… (§7, §14)
  ad_account_currency     TEXT NOT NULL DEFAULT 'EUR',
  ad_account_timezone     TEXT NOT NULL DEFAULT 'Europe/Paris',
  auto_publish_recos      INTEGER NOT NULL DEFAULT 0 CHECK (auto_publish_recos IN (0,1)),
  onboarding_locked       INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_locked IN (0,1)),
  is_demo                 INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),   -- refusé en production
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name    TEXT,
  role            TEXT NOT NULL CHECK (role IN ('agence','client')),
  client_id       TEXT REFERENCES clients(id) ON DELETE CASCADE,
  last_login_at   TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- un utilisateur client est rattaché à un client ; un utilisateur agence ne l'est pas
  CHECK ((role = 'client' AND client_id IS NOT NULL) OR (role = 'agence' AND client_id IS NULL))
);

-- ───────────────────────────── Onboarding ─────────────────────────────

CREATE TABLE onboarding_answers (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  section         TEXT NOT NULL,
  question_key    TEXT NOT NULL,                  -- numéro / clé stable de la question
  question_text   TEXT NOT NULL,                  -- libellé figé au moment de la réponse
  answer          TEXT,
  author_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'brouillon' CHECK (status IN ('brouillon','soumis')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (client_id, question_key)
);

-- Historique de chaque réponse (§7 « chaque réponse garde son historique »)
CREATE TABLE onboarding_answer_history (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  answer_id       TEXT NOT NULL REFERENCES onboarding_answers(id) ON DELETE CASCADE,
  previous_answer TEXT,
  new_answer      TEXT,
  author_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  after_production_start INTEGER NOT NULL DEFAULT 0 CHECK (after_production_start IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Sections rouvertes par l'agence pour complément (§7 « Verrouillage et relance »)
CREATE TABLE onboarding_reopenings (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  section         TEXT NOT NULL,
  question_key    TEXT,
  message         TEXT NOT NULL,
  closed_at       TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE onboarding_assets (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('logo','charte','captures_produit','temoignage','enregistrement','acces_site','autre')),
  r2_key          TEXT,
  external_url    TEXT,
  description     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ───────────────────────────── Production ─────────────────────────────

CREATE TABLE deliverables (
  id                TEXT PRIMARY KEY,
  client_id         TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type              TEXT NOT NULL CHECK (type IN ('offre','landing','vsl_script','vsl_video','ads_scripts','ads_videos','sequences','tracking','campagne')),
  phase             TEXT NOT NULL,                -- clé de phase (voir packages/domain/src/phases.ts)
  title             TEXT NOT NULL,
  -- 'brouillon' n'existe que côté agence ; le client voit « en préparation » tant que rien n'est publié
  status            TEXT NOT NULL DEFAULT 'brouillon'
                    CHECK (status IN ('brouillon','en_preparation','a_relire','valide','mis_a_jour')),
  version           INTEGER NOT NULL DEFAULT 1,
  external_url      TEXT,
  r2_key            TEXT,
  client_summary    TEXT,                         -- résumé de deux lignes écrit pour le client
  visible_client    INTEGER NOT NULL DEFAULT 0 CHECK (visible_client IN (0,1)),
  published_at      TEXT,
  previous_version_id TEXT REFERENCES deliverables(id) ON DELETE SET NULL,
  -- Place réservée à la production assistée (après la v1, §3) : rien n'est généré en v1.
  origin            TEXT NOT NULL DEFAULT 'manuel' CHECK (origin IN ('manuel','genere')),
  generation_json   TEXT,                         -- modèle, prompt, sources d'onboarding utilisées…
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE deliverable_comments (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  deliverable_id  TEXT NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
  author_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  body            TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE phases (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  phase           TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'a_venir' CHECK (state IN ('a_venir','en_cours','livre','valide')),
  started_at      TEXT,
  blocker         TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (client_id, phase)
);

CREATE TABLE tasks (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  description     TEXT,
  owner           TEXT NOT NULL CHECK (owner IN ('agence','client')),
  phase           TEXT,
  status          TEXT NOT NULL DEFAULT 'a_faire' CHECK (status IN ('a_faire','en_cours','bloque','fait')),
  blocking        INTEGER NOT NULL DEFAULT 0 CHECK (blocking IN (0,1)),
  due_date        TEXT,
  link_url        TEXT,
  guide_id        TEXT,
  deliverable_id  TEXT REFERENCES deliverables(id) ON DELETE SET NULL,
  done_at         TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ───────────────────────────── Connexions ─────────────────────────────

CREATE TABLE connections (
  id                TEXT PRIMARY KEY,
  client_id         TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type              TEXT NOT NULL CHECK (type IN ('meta','pixel','ghl','calendrier','domaine','mailing','formulaire')),
  external_id       TEXT,
  state             TEXT NOT NULL DEFAULT 'non_configure' CHECK (state IN ('ok','degrade','casse','non_configure')),
  last_checked_at   TEXT,
  error_message     TEXT,                       -- technique : vue agence uniquement
  client_action     TEXT,                       -- phrase « quoi faire » pour le client
  guide_id          TEXT,
  token_ciphertext  TEXT,                       -- chiffré au repos, JAMAIS renvoyé au navigateur
  token_expires_at  TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (client_id, type)
);

-- ───────────────────────────── Mesure ─────────────────────────────

-- Source unique des chiffres (§6). Une ligne par jour, par client, par publicité.
CREATE TABLE metrics_daily (
  client_id             TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date                  TEXT NOT NULL,          -- jour du compte publicitaire (AAAA-MM-JJ)
  ad_id                 TEXT NOT NULL,          -- identifiant numérique Meta
  campaign_id           TEXT NOT NULL,
  adset_id              TEXT NOT NULL,
  campaign_name         TEXT,
  adset_name            TEXT,
  ad_name               TEXT,
  ad_status             TEXT,
  campaign_daily_budget_cents INTEGER,
  spend_cents           INTEGER NOT NULL DEFAULT 0,   -- converti en EUR
  spend_original_minor  INTEGER,                      -- valeur d'origine, unité mineure de la devise
  currency              TEXT NOT NULL DEFAULT 'EUR',
  fx_rate_to_eur        REAL,                         -- taux du jour appliqué
  impressions           INTEGER NOT NULL DEFAULT 0,
  frequency             REAL,
  link_clicks           INTEGER NOT NULL DEFAULT 0,
  landing_page_views    INTEGER NOT NULL DEFAULT 0,
  vsl_views             INTEGER NOT NULL DEFAULT 0,
  thruplays             INTEGER NOT NULL DEFAULT 0,
  video_plays           INTEGER NOT NULL DEFAULT 0,
  leads                 INTEGER NOT NULL DEFAULT 0,
  crm_contacts          INTEGER NOT NULL DEFAULT 0,
  appointments_booked   INTEGER NOT NULL DEFAULT 0,
  appointments_held     INTEGER NOT NULL DEFAULT 0,
  sales                 INTEGER NOT NULL DEFAULT 0,
  cash_collected_cents  INTEGER NOT NULL DEFAULT 0,
  source                TEXT NOT NULL DEFAULT 'meta',  -- meta | ghl | demo
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (client_id, date, ad_id)               -- idempotence du job (§13)
);
CREATE INDEX idx_metrics_daily_client_date ON metrics_daily (client_id, date);

-- Agrégats précalculés : une ligne par (client, jour, niveau, entité). Les écrans somment des jours.
CREATE TABLE metrics_rollup (
  client_id             TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_type           TEXT NOT NULL DEFAULT 'day' CHECK (period_type IN ('day')),
  period_start          TEXT NOT NULL,
  level                 TEXT NOT NULL CHECK (level IN ('client','campaign','ad')),
  entity_id             TEXT NOT NULL,           -- client_id, campaign_id ou ad_id
  entity_name           TEXT,
  spend_cents           INTEGER NOT NULL DEFAULT 0,
  impressions           INTEGER NOT NULL DEFAULT 0,
  link_clicks           INTEGER NOT NULL DEFAULT 0,
  landing_page_views    INTEGER NOT NULL DEFAULT 0,
  vsl_views             INTEGER NOT NULL DEFAULT 0,
  thruplays             INTEGER NOT NULL DEFAULT 0,
  video_plays           INTEGER NOT NULL DEFAULT 0,
  leads                 INTEGER NOT NULL DEFAULT 0,
  crm_contacts          INTEGER NOT NULL DEFAULT 0,
  appointments_booked   INTEGER NOT NULL DEFAULT 0,
  appointments_held     INTEGER NOT NULL DEFAULT 0,
  sales                 INTEGER NOT NULL DEFAULT 0,
  cash_collected_cents  INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (client_id, period_type, period_start, level, entity_id)
);

-- Un rendez-vous (données nominatives minimales, rétention 24 mois glissants)
CREATE TABLE appointments (
  id                    TEXT PRIMARY KEY,
  client_id             TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  ghl_appointment_id    TEXT,
  contact_name          TEXT,
  booked_at             TEXT NOT NULL,           -- date de prise (UTC)
  scheduled_at          TEXT NOT NULL,           -- date du rendez-vous (UTC)
  status                TEXT NOT NULL DEFAULT 'prevu' CHECK (status IN ('prevu','annule','honore','absent')),
  campaign_id           TEXT,
  ad_id                 TEXT,
  counts_toward_target  INTEGER NOT NULL DEFAULT 1 CHECK (counts_toward_target IN (0,1)),  -- « compte dans les 30 »
  exclusion_reason      TEXT,                    -- motif si exclu (hors cible…)
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (client_id, ghl_appointment_id)
);
CREATE INDEX idx_appointments_client_scheduled ON appointments (client_id, scheduled_at);

CREATE TABLE pipeline_snapshot (
  client_id             TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  stage_order           INTEGER NOT NULL,
  stage_name            TEXT NOT NULL,
  open_opportunities    INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (client_id, stage_order)
);

CREATE TABLE contact_sources_daily (
  client_id             TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date                  TEXT NOT NULL,
  source                TEXT NOT NULL,           -- « meta », « organique », « non rattaché »…
  contacts              INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (client_id, date, source)
);

-- ───────────────────────────── Analyse ─────────────────────────────

CREATE TABLE recommendations (
  id                TEXT PRIMARY KEY,
  client_id         TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date              TEXT NOT NULL,
  severity          TEXT NOT NULL CHECK (severity IN ('info','surveiller','corriger')),
  rule_key          TEXT NOT NULL,
  title             TEXT NOT NULL,              -- version interne
  body              TEXT NOT NULL,
  internal_note     TEXT,
  client_title      TEXT,                       -- version client (réécriture)
  client_body       TEXT,
  metrics_json      TEXT NOT NULL DEFAULT '{}', -- indicateurs cités
  visible_client    INTEGER NOT NULL DEFAULT 0 CHECK (visible_client IN (0,1)),
  published_at      TEXT,
  state             TEXT NOT NULL DEFAULT 'ouverte' CHECK (state IN ('ouverte','traitee','ignoree')),
  state_changed_at  TEXT,
  repeat_count      INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_recos_client_date ON recommendations (client_id, date);

CREATE TABLE alerts (
  id                TEXT PRIMARY KEY,
  client_id         TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_start      TEXT NOT NULL,
  period_end        TEXT NOT NULL,
  metric            TEXT NOT NULL,
  value             REAL,
  threshold         REAL,
  verdict           TEXT NOT NULL CHECK (verdict IN ('tenu','surveiller','corriger','non_mesure')),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE reports (
  id                TEXT PRIMARY KEY,
  client_id         TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_type       TEXT NOT NULL CHECK (period_type IN ('semaine','mois')),
  period_start      TEXT NOT NULL,
  period_end        TEXT NOT NULL,
  agency_comment    TEXT,
  snapshot_json     TEXT NOT NULL,              -- instantané figé des chiffres
  pdf_r2_key        TEXT,
  sent_at           TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE feedback (
  id                TEXT PRIMARY KEY,
  client_id         TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  author_user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  category          TEXT NOT NULL CHECK (category IN ('bug','resultat','demande','question')),
  severity          TEXT NOT NULL DEFAULT 'normale' CHECK (severity IN ('faible','normale','haute')),
  body              TEXT NOT NULL,
  attachments_json  TEXT NOT NULL DEFAULT '[]',
  context_json      TEXT,                       -- chiffres 7 j, connexions, recos jointes automatiquement
  deliverable_id    TEXT REFERENCES deliverables(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'nouveau' CHECK (status IN ('nouveau','vu','en_cours','resolu')),
  agency_reply      TEXT,
  replied_at        TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Guides : communs (client_id NULL) ou épinglés pour un client précis.
-- Exception documentée à la règle « client_id partout » : un guide commun n'appartient à aucun client.
CREATE TABLE guides (
  id                TEXT PRIMARY KEY,
  client_id         TEXT REFERENCES clients(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('pdf','video','page')),
  r2_key            TEXT,
  url               TEXT,
  body_md           TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  published         INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE guide_reads (
  client_id         TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  guide_id          TEXT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  read_at           TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (client_id, guide_id)
);

CREATE TABLE funnel_events (
  id                TEXT PRIMARY KEY,
  client_id         TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date              TEXT NOT NULL,
  label             TEXT NOT NULL,
  description       TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ───────────────────────────── Exploitation ─────────────────────────────

CREATE TABLE sync_runs (
  id                TEXT PRIMARY KEY,
  client_id         TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source            TEXT NOT NULL CHECK (source IN ('meta','ghl','rollup','rules','recos','demo')),
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  rows_written      INTEGER NOT NULL DEFAULT 0,
  ok                INTEGER NOT NULL DEFAULT 0 CHECK (ok IN (0,1)),
  error             TEXT,                        -- jamais de jeton ni de donnée personnelle
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_sync_runs_client ON sync_runs (client_id, started_at);

-- Exception documentée : client_id NULL pour les actions hors client (création d'utilisateur agence…)
CREATE TABLE audit_log (
  id                TEXT PRIMARY KEY,
  client_id         TEXT REFERENCES clients(id) ON DELETE SET NULL,
  actor_user_id     TEXT,
  actor_email       TEXT,
  action            TEXT NOT NULL,
  object_type       TEXT NOT NULL,
  object_id         TEXT,
  before_json       TEXT,
  after_json        TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_audit_client ON audit_log (client_id, created_at);
