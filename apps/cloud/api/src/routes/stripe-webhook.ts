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
 *
 * Charge events (succeeded / refunded / dispute.*) land alongside
 * task #13 when destination charges go live; the route shape and
 * verifier are reused.
 */

import { Hono } from "hono";
import type { Storage, StripeAccountRecord } from "../storage.js";
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
