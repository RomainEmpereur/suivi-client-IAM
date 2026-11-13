-- 0016 — Demandes clients (décision 0022) : un commentaire client reste « à traiter » tant que l'agence n'a ni répondu
-- sur le livrable, ni marqué la demande comme traitée.
ALTER TABLE deliverable_comments ADD COLUMN handled_at TEXT;
CREATE INDEX idx_deliverable_comments_pending ON deliverable_comments (author_role, handled_at);
