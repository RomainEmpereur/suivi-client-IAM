-- 0005 — Réglages GoHighLevel par client (pipelines, calendriers, étapes ; décision 0006 et lot 3).
-- JSON conforme à GhlClientConfig (packages/domain/src/ghl-rules.ts). Le jeton n'y figure JAMAIS (connections.token_ciphertext).
ALTER TABLE clients ADD COLUMN ghl_config_json TEXT NOT NULL DEFAULT '{}';
