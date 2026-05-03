/**
 * /v1/stripe/webhook — Stripe Connect / charge event ingestion.
 *
 * Stripe POSTs every event to this endpoint. The handler:
 *   1. Verifies the Stripe-Signature header (HMAC-SHA256 + 5-min ts window)
 *   2. Dispatches by event.type. Unknown types are ack'd as 200 so
 *      Stripe doesn't retry.
 *
 * Closed-alpha event coverage:
 *   - account.updated    — refresh stripe_accounts cached flags
 *   - charge.refunded    — record an auto-refund into the `refunds`
 *                          table (PRD §9.3 #3) and retroactively
 *                          resolve any open dispute filed against the
 *                          same conversation. Only acts on charges
 *                          carrying our `aap_conversation_id` metadata
 *                          — third-party Stripe traffic is acked as
 *                          ignored.
 *
 * Charge.succeeded and dispute.* land in a later task; the route shape
 * and verifier are reused.
 */

import { Hono } from "hono";
import type { RefundRecord, Storage, StripeAccountRecord } from "../storage.js";
import type { StripeEvent, WebhookVerifier } from "../stripe-webhook.js";

interface RouterDeps {
  storage: Storage;
  verifier: WebhookVerifier;
  now?: () => Date;
}

export function createStripeWebhookRouter({
  storage,
  verifier,
  now = () => new Date(),
}: RouterDeps): Hono {
  const router = new Hono();

  router.post("/", async (c) => {
    const rawBody = await c.req.text();
    const sigHeader = c.req.header("stripe-signature");

    let event: StripeEvent;
    try {
      event = await verifier.verify(rawBody, sigHeader);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[stripe-webhook] verification failed", message);
      return c.json({ error: "invalid_signature", message }, 400);
    }

    try {
      const handled = await dispatch(event, storage, now);
      return c.json({ received: true, event_id: event.id, handled }, 200);
    } catch (err) {
      // Stripe retries on 5xx; we want retries for storage hiccups
      // but NOT for permanent shape mismatches (those should never
      // recur). Distinguishing is hard server-side; default to 500
      // and rely on Stripe's exponential backoff.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[stripe-webhook] handler failed for ${event.type}`, message);
      return c.json({ error: "handler_failed", event_id: event.id, message }, 500);
    }
  });

  return router;
}

async function dispatch(event: StripeEvent, storage: Storage, now: () => Date): Promise<string> {
  switch (event.type) {
    case "account.updated":
      return handleAccountUpdated(event, storage, now);
    case "charge.refunded":
      return handleChargeRefunded(event, storage, now);
    default:
      return "ignored";
  }
}

async function handleAccountUpdated(
  event: StripeEvent,
  storage: Storage,
  now: () => Date,
): Promise<string> {
  const obj = event.data.object as Record<string, unknown>;
  const accountId = typeof obj.id === "string" ? obj.id : undefined;
  if (!accountId) {
    return "ignored_no_id";
  }
  const existing = await storage.getStripeAccountByStripeId(accountId);
  if (!existing) {
    // Account isn't ours — Stripe may forward events for accounts
    // we never registered. Ack and move on.
    return "ignored_unknown_account";
  }
  const next: StripeAccountRecord = {
    ...existing,
    detailsSubmitted: pickBool(obj.details_submitted, existing.detailsSubmitted),
    chargesEnabled: pickBool(obj.charges_enabled, existing.chargesEnabled),
    payoutsEnabled: pickBool(obj.payouts_enabled, existing.payoutsEnabled),
    updatedAt: now().toISOString(),
  };
  await storage.upsertStripeAccount(next);
  return "account_updated";
}

function pickBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * `charge.refunded` — the refund completed on Stripe's side. We
 * mirror it into our local `refunds` table when the charge carries
 * our `aap_conversation_id` metadata, then auto-resolve any open
 * dispute against the same conversation.
 *
 * Resolution is "auto_refunded" (matches the `getRefundsByConversation`
 * branch in the dispute intake route, so a dispute filed before vs.
 * after the refund both end up with the same final state).
 *
 * Re-deliveries are safe: `recordRefund` is idempotent on `refund_id`,
 * and `resolveDispute` only mutates open disputes.
 */
async function handleChargeRefunded(
  event: StripeEvent,
  storage: Storage,
  now: () => Date,
): Promise<string> {
  const charge = event.data.object as Record<string, unknown>;
  const metadata = (charge.metadata as Record<string, unknown> | undefined) ?? {};
  const conversationId =
    typeof metadata.aap_conversation_id === "string" ? metadata.aap_conversation_id : undefined;
  if (!conversationId) {
    // Not an AAP-routed charge — Stripe forwards refunds for the whole
    // platform account, including non-AAP traffic. Ack and move on.
    return "ignored_non_aap";
  }

  // Stripe charges hold the most recent refund inside `refunds.data[0]`
  // (paginated list). For our needs the latest refund is the one Stripe
  // is notifying us about; full reconciliation across multi-refund
  // charges is a later concern.
  const refund = pickLatestRefund(charge);
  if (!refund) {
    return "ignored_no_refund";
  }

  const currencyRaw =
    typeof refund.currency === "string"
      ? refund.currency
      : typeof charge.currency === "string"
        ? charge.currency
        : "usd";
  const amountCents =
    typeof refund.amount === "number" ? refund.amount : pickRefundedAmount(charge);
  const createdSec = typeof refund.created === "number" ? refund.created : undefined;

  const record: RefundRecord = {
    refundId: typeof refund.id === "string" ? refund.id : `evt_${event.id}`,
    conversationId,
    amount: centsToDecimal(amountCents),
    currency: currencyRaw.toUpperCase(),
    refundedAt:
      createdSec !== undefined ? new Date(createdSec * 1000).toISOString() : now().toISOString(),
  };
  if (typeof refund.reason === "string" && refund.reason.length > 0) {
    record.reason = refund.reason;
  }
  await storage.recordRefund(record);

  // Retroactively resolve open disputes against this conversation so
  // the human-loop is fully short-circuited.
  const open = await storage.getOpenDisputesByConversation(conversationId);
  let resolved = 0;
  for (const d of open) {
    await storage.resolveDispute(d.disputeId, "auto_refunded", now().toISOString());
    resolved++;
  }
  return resolved > 0 ? `refund_recorded_resolved_${resolved}` : "refund_recorded";
}

interface StripeRefundLite {
  id?: unknown;
  amount?: unknown;
  currency?: unknown;
  created?: unknown;
  reason?: unknown;
}

function pickLatestRefund(charge: Record<string, unknown>): StripeRefundLite | undefined {
  const refunds = charge.refunds;
  if (!refunds || typeof refunds !== "object") return undefined;
  const data = (refunds as Record<string, unknown>).data;
  if (!Array.isArray(data) || data.length === 0) return undefined;
  // Stripe documents refunds.data as newest-last for `charge.refunded`,
  // but the practical contract is "the entry most relevant to this
  // event is at the end". Take the last.
  return data[data.length - 1] as StripeRefundLite;
}

function pickRefundedAmount(charge: Record<string, unknown>): number {
  const v = charge.amount_refunded;
  return typeof v === "number" ? v : 0;
}

function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}
