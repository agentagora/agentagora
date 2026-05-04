-- Owner-scoped index endpoints (cloud-api §A.1).
--
-- Adds indexes that back the new GET ?owner / ?actor / ?filer / ?respondent
-- query paths. Without these, each endpoint degrades to a full table
-- scan as the registry / dispute volume grows. Existing reads stay
-- unaffected (their indexes are kept).

-- "What agents do I own?" — backs GET /v1/agents?owner=<id>.
CREATE INDEX IF NOT EXISTS agents_published_by_idx
  ON agents (published_by, published_at DESC);

-- "Disputes I filed" — backs GET /v1/disputes?filer=<aid>. (`disputes_filer_idx`
-- already exists but indexes (filed_by, filed_at), which is owner-id, not aid.)
CREATE INDEX IF NOT EXISTS disputes_filer_aid_idx
  ON disputes (filer_aid, filed_at DESC);

-- "Disputes against my agent" — backs GET /v1/disputes?respondent=<aid>.
CREATE INDEX IF NOT EXISTS disputes_respondent_aid_idx
  ON disputes (respondent_aid, filed_at DESC);
