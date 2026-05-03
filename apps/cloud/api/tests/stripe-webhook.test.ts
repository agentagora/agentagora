/**
 * Stripe webhook tests.
 *
 * Two layers:
 *   - HmacWebhookVerifier directly: signature verification, replay
 *     window, malformed-header rejection.
 *   - HTTP route: account.updated end-to-end, signature reuse,
 *     unknown event type returns 200 ack, invalid signature → 400,
 *     unconfigured → 503.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { StaticOwnerAuth } from "../src/auth.js";
import { createApi } from "../src/index.js";
import { InMemoryStorage } from "../src/storage.js";
import { HmacWebhookVerifier } from "../src/stripe-webhook.js";
import { MockStripeApiClient } from "./_mock-stripe.js";

const SECRET = "whsec_test_secret";

async function hmacHex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function signEvent(
  payload: object,
  secret = SECRET,
  timestamp = Math.floor(Date.now() / 1000),
) {
  const body = JSON.stringify(payload);
  const v1 = await hmacHex(secret, `${timestamp}.${body}`);
  return { body, header: `t=${timestamp},v1=${v1}` };
}

function eventPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_test_1",
    type: "account.updated",
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: "acct_test_1",
        details_submitted: true,
        charges_enabled: true,
        payouts_enabled: false,
      },
    },
    ...overrides,
  };
}

describe("HmacWebhookVerifier (direct)", () => {
  it("verifies a correctly signed delivery", async () => {
    const verifier = new HmacWebhookVerifier(SECRET);
    const { body, header } = await signEvent(eventPayload());
    const event = await verifier.verify(body, header);
    expect(event.type).toBe("account.updated");
  });

  it("rejects when the timestamp is older than 5 minutes", async () => {
    const verifier = new HmacWebhookVerifier(SECRET);
    const oldTs = Math.floor(Date.now() / 1000) - 6 * 60;
    const { body, header } = await signEvent(eventPayload(), SECRET, oldTs);
    await expect(verifier.verify(body, header)).rejects.toThrow(/tolerance/);
  });

  it("rejects when the v1 signature was made with the wrong secret", async () => {
    const verifier = new HmacWebhookVerifier(SECRET);
    const { body, header } = await signEvent(eventPayload(), "whsec_wrong");
    await expect(verifier.verify(body, header)).rejects.toThrow(/did not verify/);
  });

  it("rejects when the header is missing entirely", async () => {
    const verifier = new HmacWebhookVerifier(SECRET);
    const body = JSON.stringify(eventPayload());
    await expect(verifier.verify(body, undefined)).rejects.toThrow(/missing/);
  });

  it("rejects when the header has no v1 segment", async () => {
    const verifier = new HmacWebhookVerifier(SECRET);
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify(eventPayload());
    await expect(verifier.verify(body, `t=${ts}`)).rejects.toThrow(/no v1/);
  });

  it("rejects when the body is not valid JSON", async () => {
    const verifier = new HmacWebhookVerifier(SECRET);
    const ts = Math.floor(Date.now() / 1000);
    const v1 = await hmacHex(SECRET, `${ts}.not-json`);
    await expect(verifier.verify("not-json", `t=${ts},v1=${v1}`)).rejects.toThrow(/JSON/);
  });

  it("rejects when the body is JSON but doesn't look like a Stripe Event", async () => {
    const verifier = new HmacWebhookVerifier(SECRET);
    const { body, header } = await signEvent({ random: "shape" });
    await expect(verifier.verify(body, header)).rejects.toThrow(/Event/);
  });
});

describe("POST /v1/stripe/webhook (HTTP)", () => {
  function setup() {
    const storage = new InMemoryStorage();
    const ownerAuth = new StaticOwnerAuth({ "tok-alice": "alice" });
    const verifier = new HmacWebhookVerifier(SECRET);
    const stripe = new MockStripeApiClient();
    const app = createApi({ storage, ownerAuth, stripe, stripeWebhookVerifier: verifier });
    return { app, storage, stripe };
  }

  beforeEach(() => {
    // Each test sets its own clock by re-instantiating; nothing
    // shared at module scope.
  });

  async function postEvent(
    app: ReturnType<typeof createApi>,
    payload: object,
    overrides: { body?: string; header?: string } = {},
  ) {
    const { body, header } = await signEvent(payload);
    return app.request("/v1/stripe/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": overrides.header ?? header,
      },
      body: overrides.body ?? body,
    });
  }

  it("acks a valid account.updated and refreshes the cached row", async () => {
    const { app, storage, stripe } = setup();
    // Pre-seed an account so the webhook has something to update.
    await stripe.createExpressAccount({ email: "alice@example.com" });
    await storage.upsertStripeAccount({
      ownerId: "alice",
      stripeAccountId: "acct_test_1",
      detailsSubmitted: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });

    const res = await postEvent(app, eventPayload());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { received: boolean; handled: string };
    expect(body.received).toBe(true);
    expect(body.handled).toBe("account_updated");

    const stored = await storage.getStripeAccountByOwner("alice");
    expect(stored?.detailsSubmitted).toBe(true);
    expect(stored?.chargesEnabled).toBe(true);
    expect(stored?.payoutsEnabled).toBe(false);
  });

  it("400 on invalid signature", async () => {
    const { app } = setup();
    const res = await postEvent(app, eventPayload(), { header: "t=1,v1=deadbeef" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_signature");
  });

  it("acks account.updated for an unknown stripe_account_id without writing", async () => {
    const { app, storage } = setup();
    const res = await postEvent(
      app,
      eventPayload({
        data: { object: { id: "acct_unknown", charges_enabled: true } },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { handled: string };
    expect(body.handled).toBe("ignored_unknown_account");
    expect(await storage.getStripeAccountByStripeId("acct_unknown")).toBeUndefined();
  });

  it("acks unknown event types as ignored without retry", async () => {
    const { app } = setup();
    const res = await postEvent(app, eventPayload({ type: "charge.succeeded", id: "evt_test_2" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { handled: string };
    expect(body.handled).toBe("ignored");
  });
});

function chargeRefundedEvent(
  overrides: {
    conversationId?: string;
    refundId?: string;
    amount?: number;
    currency?: string;
    reason?: string;
    noMetadata?: boolean;
  } = {},
) {
  const conversationId = overrides.conversationId ?? "convo-refund-001";
  const refundId = overrides.refundId ?? "re_test_001";
  const amount = overrides.amount ?? 50; // cents → "0.50"
  const currency = overrides.currency ?? "usd";
  const metadata = overrides.noMetadata
    ? {}
    : {
        aap_conversation_id: conversationId,
        aap_payer_aid: "aid:agentagora:alice/orchestrator",
        aap_payee_aid: "aid:agentagora:bob/echo",
      };
  return {
    id: "evt_refund_1",
    type: "charge.refunded",
    livemode: false,
    created: 1_700_000_000,
    data: {
      object: {
        id: "ch_test_001",
        amount: 50,
        amount_refunded: amount,
        currency,
        metadata,
        refunds: {
          object: "list",
          data: [
            {
              id: refundId,
              amount,
              currency,
              created: 1_700_000_100,
              ...(overrides.reason ? { reason: overrides.reason } : {}),
            },
          ],
        },
      },
    },
  };
}

describe("POST /v1/stripe/webhook — charge.refunded", () => {
  function setup() {
    const storage = new InMemoryStorage();
    const ownerAuth = new StaticOwnerAuth({});
    const verifier = new HmacWebhookVerifier(SECRET);
    const app = createApi({ storage, ownerAuth, stripeWebhookVerifier: verifier });
    return { app, storage };
  }

  async function postEvent(app: ReturnType<typeof createApi>, payload: object) {
    const { body, header } = await signEvent(payload);
    return app.request("/v1/stripe/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": header,
      },
      body,
    });
  }

  it("records the refund and acks `refund_recorded` for an AAP-tagged charge", async () => {
    const { app, storage } = setup();
    const res = await postEvent(
      app,
      chargeRefundedEvent({ conversationId: "convo-A", refundId: "re_aap_1" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { handled: string };
    expect(body.handled).toBe("refund_recorded");

    const stored = await storage.getRefundsByConversation("convo-A");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.refundId).toBe("re_aap_1");
    expect(stored[0]?.amount).toBe("0.50");
    expect(stored[0]?.currency).toBe("USD");
    expect(stored[0]?.refundedAt).toBe("2023-11-14T22:15:00.000Z");
  });

  it("ignores charges with no aap_conversation_id metadata", async () => {
    const { app, storage } = setup();
    const res = await postEvent(app, chargeRefundedEvent({ noMetadata: true }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { handled: string };
    expect(body.handled).toBe("ignored_non_aap");
    expect(await storage.getRefundsByConversation("convo-refund-001")).toHaveLength(0);
  });

  it("redelivery of the same refund is idempotent", async () => {
    const { app, storage } = setup();
    await postEvent(app, chargeRefundedEvent({ conversationId: "convo-B", refundId: "re_dup" }));
    await postEvent(app, chargeRefundedEvent({ conversationId: "convo-B", refundId: "re_dup" }));
    const stored = await storage.getRefundsByConversation("convo-B");
    expect(stored).toHaveLength(1);
  });

  it("auto-resolves an open dispute filed before the refund event arrives", async () => {
    const { app, storage } = setup();

    // Pre-seed a dispute in the open state for the conversation.
    await storage.createDispute({
      disputeId: "disp_pre_refund",
      conversationId: "convo-C",
      filedBy: "alice",
      filerAid: "aid:agentagora:alice/orchestrator",
      respondentAid: "aid:agentagora:bob/echo",
      reason: "non_delivery",
      state: "open",
      filedAt: "2026-05-01T10:00:00.000Z",
    });

    const res = await postEvent(
      app,
      chargeRefundedEvent({ conversationId: "convo-C", refundId: "re_late" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { handled: string };
    expect(body.handled).toBe("refund_recorded_resolved_1");

    const after = await storage.getDispute("disp_pre_refund");
    expect(after?.state).toBe("resolved");
    expect(after?.resolution).toBe("auto_refunded");
    expect(after?.resolvedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("does NOT mutate disputes already in a non-open terminal state", async () => {
    const { app, storage } = setup();
    await storage.createDispute({
      disputeId: "disp_already_rejected",
      conversationId: "convo-D",
      filedBy: "alice",
      filerAid: "aid:agentagora:alice/orchestrator",
      respondentAid: "aid:agentagora:bob/echo",
      reason: "fraud",
      state: "rejected",
      filedAt: "2026-05-01T10:00:00.000Z",
      resolvedAt: "2026-05-01T11:00:00.000Z",
      resolution: "ops_dismissed",
    });
    const res = await postEvent(
      app,
      chargeRefundedEvent({ conversationId: "convo-D", refundId: "re_x" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { handled: string };
    // No open dispute → just record_recorded, no resolve count.
    expect(body.handled).toBe("refund_recorded");
    const after = await storage.getDispute("disp_already_rejected");
    expect(after?.state).toBe("rejected");
    expect(after?.resolution).toBe("ops_dismissed");
  });
});

describe("/v1/stripe/webhook with no verifier configured", () => {
  it("returns 503 not_configured", async () => {
    const ownerAuth = new StaticOwnerAuth({});
    const app = createApi({ ownerAuth });
    const res = await app.request("/v1/stripe/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_configured");
  });
});
