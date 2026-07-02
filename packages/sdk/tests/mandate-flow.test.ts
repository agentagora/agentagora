/**
 * AP2 mandate carriage end-to-end (v0.2).
 *
 * Exercises the real data path (initiator → responder via MockTransport):
 *   - Initiator attaches AP2 mandates to params.mandates and binds their
 *     canonical hashes into its audit chain (all hashes on conversation
 *     open, payment additionally on escrow funding).
 *   - Responder validates inbound mandates and binds the same hashes into
 *     ITS own audit chain — computed over the ORIGINAL wire object, so
 *     unmodeled AP2 fields (VC proof, risk_data) are covered by the hash.
 *   - Malformed mandates are rejected as an input error.
 *   - Wire version: mandate-free envelopes stay v0.1; responses echo the
 *     requester's version.
 */

import { Ap2, AuditEventTypes, type RpcRequestEnvelope } from "@agentagora/protocol";
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
  merchants: null, // AP2: list[str] | None
  skus: null,
  requires_refundability: true,
  intent_expiry: "2026-07-12T03:45:42.037Z",
  // Unmodeled AP2 field — must survive validation AND be covered by the hash.
  proof: { type: "DataIntegrityProof", verificationMethod: "did:x#k1", proofValue: "z3sig..." },
};

// AP2's CartMandate nests the cart body under `contents`.
const cartMandate = {
  contents: {
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
  },
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
  it("binds RAW-object hashes (incl. unmodeled fields) into BOTH audit chains", async () => {
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

    // Expected hashes are over the ORIGINAL objects — including the `proof`
    // field the schema doesn't model. If either side hashed a Zod-stripped
    // copy, these assertions would fail.
    const expectedIntent = hashMandate(intentMandate);
    const expectedCart = hashMandate(cartMandate);

    const opened = [...conv.audit.events].find(
      (e) => e.type === AuditEventTypes.ConversationOpened,
    );
    expect(opened?.data.intent_mandate_hash).toBe(expectedIntent);
    expect(opened?.data.cart_mandate_hash).toBe(expectedCart);

    const responderLog = bobAgent.getAuditLog(conv.id);
    const started = [...(responderLog?.events ?? [])].find(
      (e) => e.type === AuditEventTypes.InvocationStarted,
    );
    expect(started?.data.intent_mandate_hash).toBe(expectedIntent);
    expect(started?.data.cart_mandate_hash).toBe(expectedCart);

    expect(conv.audit.verifyChain()).toBe(true);
    expect(responderLog?.verifyChain()).toBe(true);
  });

  it("binds the payment mandate hash even WITHOUT options.pay (escrow-less)", async () => {
    const { aliceClient, bobAgent } = await makeTwoAgentRig();
    const conv = await aliceClient.callRich(
      bobAgent.aid,
      "ping",
      { message: "hi" },
      { mandates: { [Ap2.MandateKeys.Payment]: paymentMandate } },
    );
    const opened = [...conv.audit.events].find(
      (e) => e.type === AuditEventTypes.ConversationOpened,
    );
    expect(opened?.data.payment_mandate_hash).toBe(hashMandate(paymentMandate));
  });

  it("records the payment mandate hash on escrow funding too", async () => {
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

  it("hashMandate tolerates floats in untyped mandate fields", () => {
    const withFloat = {
      ...paymentMandate,
      payment_mandate_contents: {
        ...paymentMandate.payment_mandate_contents,
        payment_response: { request_id: "order_3", amount: 603.49 },
      },
    };
    expect(() => hashMandate(withFloat)).not.toThrow();
  });

  it("rejects a malformed mandate as an input error", async () => {
    const { aliceClient, bobAgent } = await makeTwoAgentRig();
    await expect(
      aliceClient.call(
        bobAgent.aid,
        "ping",
        { message: "hi" },
        // CartMandate missing required contents.
        { mandates: { [Ap2.MandateKeys.Cart]: { merchant_authorization: "x" } } as never },
      ),
    ).rejects.toBeInstanceOf(InputInvalidError);
  });

  it("emits wire version 0.1 for mandate-free calls, 0.2 with mandates", async () => {
    const { aliceClient, bobAgent, transport } = await makeTwoAgentRig();
    const seen: RpcRequestEnvelope[] = [];
    const origSend = transport.send.bind(transport);
    (transport as { send: typeof transport.send }).send = async (req) => {
      seen.push(req as RpcRequestEnvelope);
      return origSend(req);
    };

    await aliceClient.call(bobAgent.aid, "ping", { message: "plain" });
    await aliceClient.call(
      bobAgent.aid,
      "ping",
      { message: "with mandate" },
      { mandates: { [Ap2.MandateKeys.Intent]: intentMandate } },
    );

    expect(seen[0]?.aap.version).toBe("0.1");
    expect(seen[1]?.aap.version).toBe("0.2");
  });

  it("leaves audit data untouched when no mandates are carried (back-compat)", async () => {
    const { aliceClient, bobAgent } = await makeTwoAgentRig();
    const conv = await aliceClient.callRich(bobAgent.aid, "ping", { message: "hi" });
    const opened = [...conv.audit.events].find(
      (e) => e.type === AuditEventTypes.ConversationOpened,
    );
    expect(opened?.data.intent_mandate_hash).toBeUndefined();
    expect(opened?.data.cart_mandate_hash).toBeUndefined();
    expect(opened?.data.payment_mandate_hash).toBeUndefined();
  });
});
