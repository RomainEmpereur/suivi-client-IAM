-- 0013 — Intégrations de la landing (décision 0017) : codes d'intégration Wistia (VSL) et GoHighLevel (calendrier),
-- saisis par l'agence après validation du design. L'espace les insère entre les repères de la landing, sans régénération.
ALTER TABLE delivery_steps ADD COLUMN integrations_json TEXT;
