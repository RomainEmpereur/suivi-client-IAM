-- 0002 — Date de première soumission de l'onboarding (§7).
-- Sert à repérer les réponses modifiées après le début de la production.
ALTER TABLE clients ADD COLUMN onboarding_submitted_at TEXT;
