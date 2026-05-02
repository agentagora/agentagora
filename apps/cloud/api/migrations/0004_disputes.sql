-- Dispute intake.
--
-- v0 captures only the case file: what was filed, by whom, against
-- whom, citing which conversation. Resolution (state transitions,
-- council vote, refund routing) lands in a later phase. Per PRD §16
-- the AgentAgora team adjudicates manually until a council exists,
-- and judgements are written back into this table by ops tooling.

CREATE TABLE IF NOT EXISTS disputes (
  dispute_id       TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL,
  filed_by         TEXT NOT NULL,          -- owner ID resolved from the bearer
  filer_aid        TEXT NOT NULL,          -- AID claiming damages (must be owned by filed_by)
  respondent_aid   TEXT NOT NULL,
  reason           TEXT NOT NULL,
  narrative        TEXT,
  claimed_remedy   TEXT,
  state            TEXT NOT NULL DEFAULT 'open',
  filed_at         TEXT NOT NULL,
  resolved_at      TEXT,
  resolution       TEXT
);

CREATE INDEX IF NOT EXISTS disputes_conversation_idx
  ON disputes (conversation_id);

CREATE INDEX IF NOT EXISTS disputes_filer_idx
  ON disputes (filed_by, filed_at DESC);
