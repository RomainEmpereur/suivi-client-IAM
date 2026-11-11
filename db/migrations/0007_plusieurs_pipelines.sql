-- 0007 — Plusieurs pipelines affichés pour un même client (ex. Civex : deux cibles distinctes).
-- stage_order = rang du pipeline × 100 + position de l'étape ; pipeline_name regroupe l'affichage.
ALTER TABLE pipeline_snapshot ADD COLUMN pipeline_name TEXT;
