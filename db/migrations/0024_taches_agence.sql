-- Liste de tâches de l'agence (décision 0030) : vue agence uniquement, jamais visible d'un client.
-- Une tâche est rattachée à un client, ou à l'agence elle-même (client_id NULL).
CREATE TABLE agency_tasks (
  id            TEXT PRIMARY KEY,
  client_id     TEXT REFERENCES clients(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  due_date      TEXT,                 -- AAAA-MM-JJ (heure de Paris), facultative
  status        TEXT NOT NULL DEFAULT 'a_faire' CHECK (status IN ('a_faire','fait')),
  done_at       TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_agency_tasks_open ON agency_tasks (status, due_date);
CREATE INDEX idx_agency_tasks_client ON agency_tasks (client_id, status);
