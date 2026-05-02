-- Initial registry schema. Applied via `wrangler d1 migrations apply DB`.
--
-- One row per published agent. The full manifest is stored as JSON;
-- capability / accepts filtering uses SQLite's json1 functions
-- (json_each / json_extract). Acceptable at v0 scale; if scan time
-- becomes a problem we can promote capabilities to a side table.

CREATE TABLE IF NOT EXISTS agents (
  aid           TEXT PRIMARY KEY,
  manifest      TEXT NOT NULL,
  identity_jwt  TEXT NOT NULL,
  published_at  TEXT NOT NULL,
  published_by  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS agents_published_at_idx ON agents (published_at DESC);
