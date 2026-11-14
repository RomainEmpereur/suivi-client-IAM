-- Cas clients (décision 0033) : « cible » et « verticale » ne font plus qu'un champ, les personnes visées par les publicités.
-- La verticale déjà contenue dans la cible est abandonnée ; sinon elle est ajoutée entre parenthèses. La colonne `vertical` n'est plus utilisée.
UPDATE case_studies SET
  target = CASE
    WHEN vertical IS NULL OR trim(vertical) = '' THEN target
    WHEN target IS NULL OR trim(target) = '' THEN vertical
    WHEN instr(lower(target), lower(trim(vertical))) > 0 THEN target
    ELSE target || ' (' || trim(vertical) || ')'
  END,
  vertical = NULL;
