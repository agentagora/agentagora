/**
 * StripeChannel unit tests against a fake StripeLike.
 *
 * Verifies:
 *   - escrow → creates a manual-capture PaymentIntent with the right
 *     amount/currency/metadata and the platform fee in basis points
 *   - capture → calls payment_intents.capture and returns the charge id
 *   - refund → creates a refund tied to the PaymentIntent
 *   - status → maps Stripe statuses to AAP escrow states correctly
 *   - decimal conversion handles the common cases
 *
 * Real Stripe API isn't hit. End-to-end Stripe integration with a
 * live test key is gated behind STRIPE_SECRET_KEY and lives in a
 * future integration suite (not committed without coordination).
 */

import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import type { StripeLike } from "../src/index.js";
import { StripeChannel } from "../src/index.js";

interface CapturedCalls {
  intentsCreate: Stripe.PaymentIntentCreateParams[];
  intentsCapture: { id: string; params?: Stripe.PaymentIntentCaptureParams }[];
  intentsRetrieve: string[];
  refundsCreate: Stripe.RefundCreateParams[];
}

function makeFakeStripe(initial?: Partial<Stripe.PaymentIntent>): {
  stripe: StripeLike;
  calls: CapturedCalls;
} {
  const calls: CapturedCalls = {
    intentsCreate: [],
    intentsCapture: [],
    intentsRetrieve: [],
    refundsCreate: [],
  };

  const baseIntent: Stripe.PaymentIntent = {
    ...({
      id: "pi_test_123",
      object: "payment_intent",
      amount: 100,
      currency: "usd",
      status: "requires_capture",
      client_secret: "pi_test_123_secret",
      created: 1700000000,
      latest_charge: "ch_test_abc",
    } as Stripe.PaymentIntent),
    ...(initial as Stripe.PaymentIntent),
  } as Stripe.PaymentIntent;

  const stripe: StripeLike = {
    paymentIntents: {
      async create(params) {
        calls.intentsCreate.push(params);
        return {
          ...baseIntent,
          amount: params.amount ?? baseIntent.amount,
          currency: params.currency ?? baseIntent.currency,
        };
      },
      async capture(id, params) {
        calls.intentsCapture.push({ id, params });
        return { ...baseIntent, id, status: "succeeded" } as Stripe.PaymentIntent;
      },
      async retrieve(id) {
        calls.intentsRetrieve.push(id);
        return { ...baseIntent, id } as Stripe.PaymentIntent;
      },
    },
    refunds: {
      async create(params) {
        calls.refundsCreate.push(params);
        return {
          id: "re_test_456",
          object: "refund",
          payment_intent: params.payment_intent,
          status: "succeeded",
        } as Stripe.Refund;
      },
    },
  };
  return { stripe, calls };
}

describe("StripeChannel.escrow", () => {
  it("creates a manual-capture PaymentIntent with metadata + platform fee", async () => {
    const { stripe, calls } = makeFakeStripe();
    const channel = new StripeChannel(stripe, {
      defaultPayeeAccount: "acct_responder_001",
      platformFeeBasisPoints: 500, // 5%
    });

    const handle = await channel.escrow({
      payerAid: "aid:agentagora:alice/orchestrator",
      payeeAid: "aid:agentagora:bob/code-review",
      amount: "1.50",
      currency: "USD",
      conversationId: "conv_xyz",
    });

    expect(calls.intentsCreate).toHaveLength(1);
    const params = calls.intentsCreate[0] as Stripe.PaymentIntentCreateParams;
    expect(params.amount).toBe(150); // 1.50 USD = 150 cents
    expect(params.currency).toBe("usd");
    expect(params.capture_method).toBe("manual");
    expect(params.application_fee_amount).toBe(7); // 5% of 150 = 7.5 → floor 7
    expect(params.transfer_data?.destination).toBe("acct_responder_001");
    expect(params.metadata?.aap_conversation_id).toBe("conv_xyz");
    expect(params.metadata?.aap_payer_aid).toBe("aid:agentagora:alice/orchestrator");
    expect(params.metadata?.aap_payee_aid).toBe("aid:agentagora:bob/code-review");

    expect(handle.channelId).toBe("stripe-fiat");
    expect(handle.escrowId).toBe("pi_test_123");
    expect(handle.amount).toBe("1.50");
    expect(handle.currency).toBe("USD");
  });

  it("omits transfer_data when no defaultPayeeAccount is set", async () => {
    const { stripe, calls } = makeFakeStripe();
    const channel = new StripeChannel(stripe, { platformFeeBasisPoints: 0 });
    await channel.escrow({
      payerAid: "aid:agentagora:a/x",
      payeeAid: "aid:agentagora:b/y",
      amount: "10.00",
      currency: "EUR",
      conversationId: "c1",
    });
    const params = calls.intentsCreate[0] as Stripe.PaymentIntentCreateParams;
    expect(params.transfer_data).toBeUndefined();
    expect(params.application_fee_amount).toBeUndefined();
  });

  it("rejects invalid decimal amounts", async () => {
    const { stripe } = makeFakeStripe();
    const channel = new StripeChannel(stripe);
    await expect(
      channel.escrow({
        payerAid: "aid:agentagora:a/x",
        payeeAid: "aid:agentagora:b/y",
        amount: "1.5.0",
        currency: "USD",
        conversationId: "c1",
      }),
    ).rejects.toThrow(/invalid decimal/);
  });

  it("rejects amounts with too many decimals (> 2)", async () => {
    const { stripe } = makeFakeStripe();
    const channel = new StripeChannel(stripe);
    await expect(
      channel.escrow({
        payerAid: "aid:agentagora:a/x",
        payeeAid: "aid:agentagora:b/y",
        amount: "1.555",
        currency: "USD",
        conversationId: "c1",
      }),
    ).rejects.toThrow(/invalid decimal/);
  });
});

describe("StripeChannel.capture", () => {
  it("captures the PaymentIntent and returns the charge id", async () => {
    const { stripe, calls } = makeFakeStripe();
    const channel = new StripeChannel(stripe);
    const id = await channel.capture({
      channelId: "stripe-fiat",
      escrowId: "pi_test_123",
      payerAid: "aid:agentagora:a/x",
      payeeAid: "aid:agentagora:b/y",
      amount: "1.00",
      currency: "USD",
      conversationId: "c1",
    });
    expect(calls.intentsCapture[0]?.id).toBe("pi_test_123");
    expect(id).toBe("ch_test_abc");
  });

  it("rejects split captures (not supported in v0.1)", async () => {
    const { stripe } = makeFakeStripe();
    const channel = new StripeChannel(stripe);
    await expect(
      channel.capture(
        {
          channelId: "stripe-fiat",
          escrowId: "pi_test_123",
          payerAid: "aid:agentagora:a/x",
          payeeAid: "aid:agentagora:b/y",
          amount: "1.00",
          currency: "USD",
          conversationId: "c1",
        },
        { aliceShare: "0.50", bobShare: "0.50" },
      ),
    ).rejects.toThrow(/split is not supported/);
  });
});

describe("StripeChannel.refund", () => {
  it("creates a full refund when no amount is given", async () => {
    const { stripe, calls } = makeFakeStripe();
    const channel = new StripeChannel(stripe);
    const id = await channel.refund({
      channelId: "stripe-fiat",
      escrowId: "pi_test_123",
      payerAid: "aid:agentagora:a/x",
      payeeAid: "aid:agentagora:b/y",
      amount: "1.00",
      currency: "USD",
      conversationId: "c1",
    });
    expect(calls.refundsCreate[0]?.payment_intent).toBe("pi_test_123");
    expect(calls.refundsCreate[0]?.amount).toBeUndefined();
    expect(id).toBe("re_test_456");
  });

  it("creates a partial refund with the right cents", async () => {
    const { stripe, calls } = makeFakeStripe();
    const channel = new StripeChannel(stripe);
    await channel.refund(
      {
        channelId: "stripe-fiat",
        escrowId: "pi_test_123",
        payerAid: "aid:agentagora:a/x",
        payeeAid: "aid:agentagora:b/y",
        amount: "5.00",
        currency: "USD",
        conversationId: "c1",
      },
      "2.25",
    );
    expect(calls.refundsCreate[0]?.amount).toBe(225);
  });
});

describe("StripeChannel.status", () => {
  const baseHandle = {
    channelId: "stripe-fiat",
    escrowId: "pi_test_123",
    payerAid: "aid:agentagora:a/x",
    payeeAid: "aid:agentagora:b/y",
    amount: "1.00",
    currency: "USD",
    conversationId: "c1",
  };

  it.each([
    ["requires_capture", "funded"],
    ["succeeded", "captured"],
    ["canceled", "refunded"],
    ["processing", "frozen"],
    ["requires_payment_method", "frozen"],
  ] as const)("maps stripe %s → %s", async (stripeStatus, expected) => {
    const { stripe } = makeFakeStripe({
      status: stripeStatus as Stripe.PaymentIntent.Status,
      amount: 250,
      currency: "usd",
    });
    const channel = new StripeChannel(stripe);
    const status = await channel.status(baseHandle);
    expect(status.state).toBe(expected);
    expect(status.amount).toBe("2.50");
    expect(status.currency).toBe("USD");
  });
});
