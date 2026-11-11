-- 0003 — Mesures non synchronisées par client.
-- Liste JSON des indicateurs de metrics_daily qu'aucune source ne fournit pour ce client
-- (ex. ["cash_collected_cents"] si les paiements ne sont pas lus). Ils s'affichent « — » avec leur raison, jamais 0.
ALTER TABLE clients ADD COLUMN unmeasured_json TEXT NOT NULL DEFAULT '[]';
