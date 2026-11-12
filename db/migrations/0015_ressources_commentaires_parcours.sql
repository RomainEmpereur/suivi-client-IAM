-- 0015 — Ressources d'onboarding déposées dans l'espace, commentaires sur livrable, parcours nouveau client (décision 0020).

-- Fichiers d'onboarding : nom d'origine, type vérifié, taille, qui l'a déposé.
ALTER TABLE onboarding_assets ADD COLUMN file_name TEXT;
ALTER TABLE onboarding_assets ADD COLUMN content_type TEXT;
ALTER TABLE onboarding_assets ADD COLUMN size_bytes INTEGER;
ALTER TABLE onboarding_assets ADD COLUMN created_by_role TEXT NOT NULL DEFAULT 'client' CHECK (created_by_role IN ('client','agence'));
CREATE INDEX idx_onboarding_assets_client ON onboarding_assets (client_id, created_at);

-- Commentaires : rôle de l'auteur figé (l'utilisateur peut disparaître).
ALTER TABLE deliverable_comments ADD COLUMN author_role TEXT NOT NULL DEFAULT 'client' CHECK (author_role IN ('client','agence'));
CREATE INDEX idx_deliverable_comments ON deliverable_comments (deliverable_id, created_at);

-- Parcours nouveau client : lien du master tracker (Google Sheets).
ALTER TABLE clients ADD COLUMN master_tracker_url TEXT;
