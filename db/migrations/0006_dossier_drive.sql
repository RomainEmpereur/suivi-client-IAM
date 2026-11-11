-- 0006 — Lien vers le dossier Google Drive du projet (livrables de l'infrastructure).
-- Décision de Romain (12 nov. 2026) : un lien vers le dossier, pas de recopie des livrables un par un.
ALTER TABLE clients ADD COLUMN drive_folder_url TEXT;
