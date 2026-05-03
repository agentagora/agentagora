-- One Stripe Connect Express account per cloud owner.
--
-- Stripe is the source of truth for onboarding state; we cache the
-- three boolean flags so dashboard reads don't have to round-trip
-- to the Stripe API. The webhook handler (task #11) keeps these
-- fresh on `account.updated` events.

CREATE TABLE IF NOT EXISTS stripe_accounts (
  owner_id           TEXT PRIMARY KEY,
  stripe_account_id  TEXT NOT NULL UNIQUE,
  details_submitted  INTEGER NOT NULL DEFAULT 0,
  charges_enabled    INTEGER NOT NULL DEFAULT 0,
  payouts_enabled    INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS stripe_accounts_account_idx
  ON stripe_accounts (stripe_account_id);
