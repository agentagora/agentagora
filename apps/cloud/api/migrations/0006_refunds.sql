-- Auto-refund ledger.
--
-- Populated by the Stripe webhook handler on `charge.refunded` events
-- whose metadata carries an `aap_conversation_id` — i.e. refunds the
-- platform issued (or Stripe issued on behalf of the platform) for
-- AAP-tagged charges. The downstream consumer is the dispute pipeline:
-- when a dispute is filed for a conversation that already has a refund
-- here, the route auto-resolves the case to `auto_refunded` per
-- PRD §9.3 #3 ("failed calls refund automatically, no human in the
-- loop").
--
-- One row per Stripe refund id. Re-delivery of the same webhook is a
-- no-op (`INSERT OR IGNORE` on `refund_id`).

CREATE TABLE IF NOT EXISTS refunds (
  refund_id        TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL,
  amount           TEXT NOT NULL,             -- decimal string, matches escrow shape
  currency         TEXT NOT NULL,             -- ISO 4217
  refunded_at      TEXT NOT NULL,             -- ISO 8601, from Stripe `created`
  reason           TEXT                        -- free-form, e.g. "requested_by_customer"
);

CREATE INDEX IF NOT EXISTS refunds_conversation_idx
  ON refunds (conversation_id, refunded_at DESC);
