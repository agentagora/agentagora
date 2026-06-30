/**
 * AP2 mandate carriage end-to-end (v0.2).
 *
 * Exercises the real data path (initiator → responder via MockTransport):
 *   - Initiator attaches AP2 mandates to params.mandates and binds their
 *     canonical hashes into its audit chain (intent/cart on open, payment
 *     on escrow funding).
 *   - Responder validates inbound mandates and binds the same hashes into
 *     ITS own audit chain — a verifier can prove both sides agreed on which
 *     mandate authorized the call.
 *   - Malformed mandates are rejected as an input error.
 *   - The recorded hash is recomputable from the mandate on the wire.
 */

import { Ap2, AuditEventTypes } from "@agentagora/protocol";
import { describe, expect, it } from "vitest";
import {
  type EscrowHandle,
  type EscrowStatus,
  InputInvalidError,
  type SettlementChannel,
  hashMandate,
} from "../src/index.js";
import { makeTwoAgentRig } from "./_fixtures.js";

const intentMandate = {
  user_cart_confirmation_required: true,
  natural_language_description: "espresso coffee maker",
  merchants: [],
  skus: [],
  requires_refundability: true,
  intent_expiry: "2026-07-12T03:45:42.037Z",
};

const cartMandate = {
  id: "cart_3",
  user_cart_confirmation_required: true,
  payment_request: {
    method_data: [{ supported_methods: "CARD" }],
    details: {
      id: "order_3",
      display_items: [{ label: "Espresso", amount: { currency: "USD", value: "599.99" } }],
      total: { label: "Total", amount: { currency: "USD", value: "603.49" } },
    },
  },
  cart_expiry: "2026-07-11T04:15:58.088Z",
  merchant_name: "Generic Merchant",
  merchant_authorization: "eyJhbGciOiJSUzI1NiIs...",
};

const paymentMandate = {
  payment_mandate_contents: {
    payment_mandate_id: "848f97b287584cd1aa3085bed1985c22",
    payment_details_id: "order_3",
    payment_details_total: { label: "Total", amount: { currency: "USD", value: "603.49" } },
    payment_response: { request_id: "order_3", method_name: "CARD" },
    merchant_agent: "Generic Merchant",
    timestamp: "2026-07-11T03:50:04.532Z",
  },
  user_authorization: "cart_hash_cart_3",
};

class FakeChannel implements SettlementChannel {
  readonly id = "x402";
  async escrow(args: {
    payerAid: string;
    payeeAid: string;
    amount: string;
    currency: string;
    conversationId: string;
  }): Promise<EscrowHandle> {
    return {
      channelId: this.id,
      escrowId: `esc_${args.conversationId}`,
      payerAid: args.payerAid,
      payeeAid: args.payeeAid,
      amount: args.amount,
      currency: args.currency,
      conversationId: args.conversationId,
    };
  }
  async capture(escrow: EscrowHandle): Promise<string> {
    return `tx_${escrow.escrowId}`;
  }
  async refund(escrow: EscrowHandle): Promise<string> {
    return `rf_${escrow.escrowId}`;
  }
  async status(_escrow: EscrowHandle): Promise<EscrowStatus> {
    return {
      state: "captured",
      amount: "0",
      currency: "USD",
      lastEventAt: "2026-01-01T00:00:00.000Z",
    };
  }
}

describe("AP2 mandate carriage end-to-end", () => {
  it("binds intent/cart hashes into BOTH the initiator and responder audit chains", async () => {
    const { aliceClient, bobAgent } = await makeTwoAgentRig();
    const conv = await aliceClient.callRich(
      bobAgent.aid,
      "ping",
      { message: "hi" },
      {
        mandates: {
          [Ap2.MandateKeys.Intent]: intentMandate,
          [Ap2.MandateKeys.Cart]: cartMandate,
        },
      },
    );

    const expectedIntent = hashMandate(intentMandate);
    const expectedCart = hashMandate(cartMandate);

    // Initiator: hashes recorded on conversation open.
    const opened = [...conv.audit.events].find(
      (e) => e.type === AuditEventTypes.ConversationOpened,
    );
    expect(opened?.data.intent_mandate_hash).toBe(expectedIntent);
    expect(opened?.data.cart_mandate_hash).toBe(expectedCart);

    // Responder: same hashes recorded on invocation start, independently.
    const responderLog = bobAgent.getAuditLog(conv.id);
    const started = [...(responderLog?.events ?? [])].find(
      (e) => e.type === AuditEventTypes.InvocationStarted,
    );
    expect(started?.data.intent_mandate_hash).toBe(expectedIntent);
    expect(started?.data.cart_mandate_hash).toBe(expectedCart);

    // Both tamper-evident chains still verify.
    expect(conv.audit.verifyChain()).toBe(true);
    expect(responderLog?.verifyChain()).toBe(true);
  });

  it("records the payment mandate hash on escrow funding", async () => {
    const { aliceClient, bobAgent } = await makeTwoAgentRig({ channels: [new FakeChannel()] });
    const conv = await aliceClient.callRich(
      bobAgent.aid,
      "ping",
      { message: "hi" },
      {
        pay: { amount: "603.49", currency: "USD" },
        mandates: { [Ap2.MandateKeys.Payment]: paymentMandate },
      },
    );

    const funded = [...conv.audit.events].find((e) => e.type === AuditEventTypes.EscrowFunded);
    expect(funded?.data.payment_mandate_hash).toBe(hashMandate(paymentMandate));
  });

  it("rejects a malformed mandate as an input error", async () => {
    const { aliceClient, bobAgent } = await makeTwoAgentRig();
    await expect(
      aliceClient.call(
        bobAgent.aid,
        "ping",
        { message: "hi" },
        // CartMandate missing required merchant_authorization / payment_request.
        { mandates: { [Ap2.MandateKeys.Cart]: { id: "bad" } } as never },
      ),
    ).rejects.toBeInstanceOf(InputInvalidError);
  });

  it("leaves audit data untouched when no mandates are carried (back-compat)", async () => {
    const { aliceClient, bobAgent } = await makeTwoAgentRig();
    const conv = await aliceClient.callRich(bobAgent.aid, "ping", { message: "hi" });
    const opened = [...conv.audit.events].find(
      (e) => e.type === AuditEventTypes.ConversationOpened,
    );
    expect(opened?.data.intent_mandate_hash).toBeUndefined();
    expect(opened?.data.cart_mandate_hash).toBeUndefined();
  });
});
