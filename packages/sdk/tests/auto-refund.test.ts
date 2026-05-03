/**
 * Auto-refund on failed paid call.
 *
 * PRD §9.3 #3: when a paid `client.call(...)` fails after the
 * caller's escrow has funded, the SDK refunds automatically before
 * the call promise rejects. The rejection surfaces the refund
 * transaction id so the caller can prove they were made whole
 * without inspecting the audit log.
 *
 * Three terminal failure modes covered here:
 *   1. RPC error response (handler threw, schema rejection, etc.)
 *      — exercised already by settlement-flow.test.ts but re-asserted
 *      from the rejection-shape angle here.
 *   2. Transport-level throw (e.g. fetch 5xx, timeout). The escrow
 *      is funded, no signed response ever comes back; we still owe
 *      the payer their money.
 *   3. Refund-itself-fails. The original error must still surface
 *      to the caller; the failed refund attempt is logged and
 *      attached as `refundError` for ops.
 */

import { ConversationStatuses } from "@agentagora/protocol";
import { describe, expect, it, vi } from "vitest";
import {
  AAPError,
  AgentAgoraClient,
  CallRefundedError,
  type EscrowHandle,
  type EscrowStatus,
  InMemoryRegistry,
  MockTransport,
  type SettlementChannel,
  generatePrivateKey,
  publicKeyFrom,
} from "../src/index.js";
import { makeTwoAgentRig } from "./_fixtures.js";

class StubChannel implements SettlementChannel {
  readonly id = "stub-fiat";
  refundCalls = 0;
  captureCalls = 0;
  private readonly mode: "ok" | "throw";

  constructor(mode: "ok" | "throw" = "ok") {
    this.mode = mode;
  }

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
  async capture(_escrow: EscrowHandle): Promise<string> {
    this.captureCalls++;
    return "capture_tx_1";
  }
  async refund(escrow: EscrowHandle): Promise<string> {
    this.refundCalls++;
    if (this.mode === "throw") {
      throw new Error("upstream refund processor is offline");
    }
    return `refund_tx_${escrow.escrowId}`;
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

describe("auto-refund — RPC error path", () => {
  it("refunds once and surfaces the refund tx id on rejection", async () => {
    const channel = new StubChannel();
    const { aliceClient, bobAgent } = await makeTwoAgentRig({ channels: [channel] });

    const promise = aliceClient.call(
      bobAgent.aid,
      "crash",
      {},
      { pay: { amount: "0.50", currency: "USD" } },
    );
    await expect(promise).rejects.toBeInstanceOf(CallRefundedError);

    let caught: CallRefundedError | undefined;
    try {
      await aliceClient.call(
        bobAgent.aid,
        "crash",
        {},
        { pay: { amount: "0.50", currency: "USD" } },
      );
    } catch (err) {
      caught = err as CallRefundedError;
    }
    expect(caught).toBeDefined();
    expect(caught?.refundTxId).toMatch(/^refund_tx_esc_/);
    expect(caught?.refundError).toBeUndefined();
    expect(caught?.cause.message).toMatch(/intentional handler failure/);
    expect(caught?.message).toMatch(/auto-refunded: refund_tx_/);
    // Two crash calls above → two refunds, never double per call.
    expect(channel.refundCalls).toBe(2);
    expect(channel.captureCalls).toBe(0);
  });

  it("callRich exposes refund metadata on the snapshot", async () => {
    const channel = new StubChannel();
    const { aliceClient, bobAgent } = await makeTwoAgentRig({ channels: [channel] });

    const conv = await aliceClient.callRich(
      bobAgent.aid,
      "crash",
      {},
      { pay: { amount: "0.50", currency: "USD" } },
    );
    expect(conv.status).toBe(ConversationStatuses.Cancelled);
    expect(conv.refund).toBeDefined();
    expect(conv.refund?.refundTxId).toMatch(/^refund_tx_esc_/);
    expect(conv.refund?.refundError).toBeUndefined();
    expect(conv.refund?.channelId).toBe("stub-fiat");
    expect(channel.refundCalls).toBe(1);
  });
});

describe("auto-refund — transport throw path", () => {
  it("refunds when transport.send rejects (e.g. 5xx)", async () => {
    const channel = new StubChannel();

    // Build a custom rig where Alice's transport always throws on send,
    // simulating a 5xx-style transport failure after escrow has funded.
    const transport = new MockTransport();
    const registry = new InMemoryRegistry();
    const aliceAid = "aid:agentagora:alice/orchestrator";
    const aliceKey = generatePrivateKey();
    registry.register(aliceAid, await publicKeyFrom(aliceKey));
    const bobAid = "aid:agentagora:bob/echo";
    const bobKey = generatePrivateKey();
    registry.register(bobAid, await publicKeyFrom(bobKey));

    // Don't register a handler — MockTransport throws "no handler
    // registered" when none exists, exactly the shape of a transport
    // failure we want to model.

    const aliceClient = new AgentAgoraClient({
      token: "test",
      transport,
      registryResolver: registry,
      fromAid: aliceAid,
      signingKey: aliceKey,
      signingKeyId: `${aliceAid}#k1`,
      settlement: [channel],
    });

    let caught: unknown;
    try {
      await aliceClient.call(
        bobAid,
        "ping",
        { message: "hi" },
        { pay: { amount: "1.00", currency: "USD" } },
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CallRefundedError);
    const refunded = caught as CallRefundedError;
    expect(refunded.refundTxId).toMatch(/^refund_tx_/);
    expect(refunded.refundError).toBeUndefined();
    expect(refunded.cause.message).toMatch(/no handler registered/);
    expect(channel.refundCalls).toBe(1);
    expect(channel.captureCalls).toBe(0);
  });
});

describe("auto-refund — refund itself fails", () => {
  it("original error wins; refund failure is logged + attached", async () => {
    const channel = new StubChannel("throw");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { aliceClient, bobAgent } = await makeTwoAgentRig({ channels: [channel] });

      let caught: CallRefundedError | undefined;
      try {
        await aliceClient.call(
          bobAgent.aid,
          "crash",
          {},
          { pay: { amount: "0.50", currency: "USD" } },
        );
      } catch (err) {
        caught = err as CallRefundedError;
      }
      expect(caught).toBeDefined();
      expect(caught).toBeInstanceOf(CallRefundedError);
      // The cause is still the original handler failure.
      expect(caught?.cause).toBeInstanceOf(AAPError);
      expect(caught?.cause.message).toMatch(/intentional handler failure/);
      // Refund tx is missing but refundError is populated.
      expect(caught?.refundTxId).toBeUndefined();
      expect(caught?.refundError?.message).toMatch(/upstream refund processor/);
      expect(caught?.message).toMatch(/auto-refund failed/);

      // Refund attempted exactly once — no retry that would double-charge
      // ops or thrash.
      expect(channel.refundCalls).toBe(1);
      // And we logged the failure for ops to see.
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
