-- OAuth-issued session bearers.
--
-- Replaces the closed-alpha OWNER_TOKENS-only bearer paste flow with a
-- GitHub-OAuth-driven sign-in (M3 §A.2). When a user completes the
-- GitHub OAuth dance via /v1/auth/github/callback, cloud-api mints a
-- fresh 32-byte random bearer (base64url) and persists a row here
-- mapping that bearer to a stable owner ID of the form `gh:<login>`.
-- All subsequent dashboard requests carry the bearer in the
-- Authorization header — the OauthSessionAuth authenticator looks the
-- bearer up here and resolves it to the owner ID, alongside the
-- StaticOwnerAuth chain that still serves CI / integration-test
-- bearers from the OWNER_TOKENS env.
--
-- The bearer itself is the primary key (it's unguessable random so
-- collisions are not a concern). `expires_at` is 30 days after issue
-- — sweepers (cron / one-shot maintenance) call
-- deleteExpiredOauthSessions to garbage-collect the table; the
-- OauthSessionAuth.resolve() path also rejects expired rows on read so
-- a stale row never authenticates even if the sweep hasn't fired yet.

CREATE TABLE IF NOT EXISTS oauth_sessions (
  bearer        TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL,           -- e.g. "gh:acme"
  provider      TEXT NOT NULL,           -- "github" today; reserved for future providers
  provider_uid  TEXT NOT NULL,           -- numeric GitHub user id (stable across login renames)
  email         TEXT,                    -- the GitHub primary email if the OAuth scope returned one
  issued_at     TEXT NOT NULL,           -- ISO 8601
  expires_at    TEXT NOT NULL            -- ISO 8601, issued_at + 30d
);

-- Per-owner history scan (admin tooling, audit). DESC so the latest
-- session for an owner is the leading row.
CREATE INDEX IF NOT EXISTS oauth_sessions_owner_idx
  ON oauth_sessions (owner_id, issued_at DESC);

-- Sweeper index: range-scan by expires_at to delete the leading
-- prefix of expired rows in one statement.
CREATE INDEX IF NOT EXISTS oauth_sessions_expires_idx
  ON oauth_sessions (expires_at);
