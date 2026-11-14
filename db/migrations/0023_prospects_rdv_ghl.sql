-- Module Prospects (décision 0028) : les rendez-vous GoHighLevel du sous-compte de l'agence alimentent
-- la liste « Rendez-vous à venir » ; une fiche créée depuis un rendez-vous en garde la référence.
ALTER TABLE prospects ADD COLUMN appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX idx_prospects_appointment ON prospects(appointment_id) WHERE appointment_id IS NOT NULL;

-- Client de l'espace dont le GoHighLevel porte les R1 de l'agence (réglable dans Prospects → Réglages).
INSERT OR IGNORE INTO agency_settings (key, value) SELECT 'prospects_ghl_client_id', id FROM clients WHERE id = 'cl_obsidian_iam';
