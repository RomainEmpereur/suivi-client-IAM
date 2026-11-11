-- 0004 — Rendez-vous saisis dans l'espace et statut posé par l'agence (décision 0006).
-- origin : d'où vient le rendez-vous (ghl = synchronisé ou importé ; saisie = ajouté dans l'espace).
-- status_source : qui a posé le statut. Un statut posé par l'agence n'est JAMAIS écrasé par la synchronisation.
ALTER TABLE appointments ADD COLUMN origin TEXT NOT NULL DEFAULT 'ghl';
ALTER TABLE appointments ADD COLUMN created_by_user_id TEXT;
ALTER TABLE appointments ADD COLUMN status_source TEXT NOT NULL DEFAULT 'ghl';
ALTER TABLE appointments ADD COLUMN status_updated_at TEXT;
ALTER TABLE appointments ADD COLUMN status_updated_by TEXT;
