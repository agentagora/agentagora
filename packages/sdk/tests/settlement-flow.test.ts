/**
 * Settlement integration: SettlementChannel wired through callRich().
 *
 * Verifies:
 *   - Successful call with options.pay → escrow.funded → escrow.captured
 *     events; status=settled; snapshot has price/currency/channel set
 *   - Failed call with options.pay → escrow.funded → escrow.refunded
 *     events; status=cancelled
 *   - No options.pay → no settlement events; back-compat preserved
 *   - options.pay without configured channel → throws
 *   - options.pay with explicit channel id picks that one
 */

import { AuditEventTypes, ConversationStatuses } from "@agentagora/protocol";
import { describe, expect, it } from "vitest";
import type { EscrowHandle, EscrowStatus, SettlementChannel } from "../src/index.js";
import { makeTwoAgentRig } from "./_fixtures.js";

class FakeChannel implements SettlementChannel {
  readonly id: string;
  readonly events: string[] = [];

  constructor(id = "fake-fiat") {
    this.id = id;
  }

  async escrow(args: {
    payerAid: string;
    payeeAid: string;
    amount: string;
    currency: string;
    conversationId: string;
  }): Promise<EscrowHandle> {
    this.events.push(`escrow ${args.amount} ${args.currency} ${args.conversationId}`);
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
    this.events.push(`capture ${escrow.escrowId}`);
    return `tx_capture_${escrow.escrowId}`;
  }
  async refund(escrow: EscrowHandle, amount?: string): Promise<string> {
    this.events.push(`refund ${escrow.escrowId} ${amount ?? "full"}`);
    return `tx_refund_${escrow.escrowId}`;
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

describe("settlement integration — happy path", () => {
  it("escrow funded → captured; status=settled; snapshot has price+channel", async () => {
    const fake = new FakeChannel();
    const { aliceClient, bobAgent } = await makeTwoAgentRig({ channels: [fake] });

    const conv = await aliceClient.callRich(
      bobAgent.aid,
      "ping",
      { message: "hi" },
      { pay: { amount: "0.50", currency: "USD" } },
    );

    expect(conv.status).toBe(ConversationStatuses.Settled);
    expect(conv.priceAmount).toBe("0.50");
    expect(conv.currency).toBe("USD");
    expect(conv.channel).toBe("fake-fiat");
    expect((conv.result as { reply: string }).reply).toBe("pong: hi");

    expect(fake.events).toEqual([`escrow 0.50 USD ${conv.id}`, `capture esc_${conv.id}`]);

    const types = [...conv.audit.events].map((e) => e.type);
    expect(types).toEqual([
      AuditEventTypes.ConversationOpened,
      AuditEventTypes.EscrowFunded,
      AuditEventTypes.Acknowledged,
      AuditEventTypes.EscrowCaptured,
      AuditEventTypes.ConversationArchived,
    ]);
    expect(conv.audit.verifyChain()).toBe(true);
  });
});

describe("settlement integration — failure path", () => {
  it("escrow funded → refunded; status=cancelled; chain still verifies", async () => {
    const fake = new FakeChannel();
    const { aliceClient, bobAgent } = await makeTwoAgentRig({ channels: [fake] });

    const conv = await aliceClient.callRich(
      bobAgent.aid,
      "crash",
      {},
      { pay: { amount: "0.50", currency: "USD" } },
    );

    expect(conv.status).toBe(ConversationStatuses.Cancelled);
    expect(conv.error?.code).toBe(-32099);

    expect(fake.events).toEqual([`escrow 0.50 USD ${conv.id}`, `refund esc_${conv.id} full`]);

    const types = [...conv.audit.events].map((e) => e.type);
    expect(types).toEqual([
      AuditEventTypes.ConversationOpened,
      AuditEventTypes.EscrowFunded,
      AuditEventTypes.EscrowRefunded,
      AuditEventTypes.ConversationArchived,
    ]);
    expect(conv.audit.verifyChain()).toBe(true);
  });
});

describe("settlement integration — back-compat & errors", () => {
  it("call without options.pay does not invoke any channel", async () => {
    const fake = new FakeChannel();
    const { aliceClient, bobAgent } = await makeTwoAgentRig({ channels: [fake] });

    const conv = await aliceClient.callRich(bobAgent.aid, "ping", { message: "hi" });
    expect(fake.events).toEqual([]);
    expect(conv.status).toBe(ConversationStatuses.Archived);
    expect(conv.priceAmount).toBeUndefined();
    expect(conv.channel).toBeUndefined();
  });

  it("options.pay with no channels configured throws", async () => {
    const { aliceClient, bobAgent } = await makeTwoAgentRig();
    await expect(
      aliceClient.callRich(
        bobAgent.aid,
        "ping",
        { message: "hi" },
        { pay: { amount: "0.50", currency: "USD" } },
      ),
    ).rejects.toThrow(/no SettlementChannel configured/);
  });

  it("options.pay.channel selects the matching channel by id", async () => {
    const a = new FakeChannel("fake-fiat");
    const b = new FakeChannel("usdc-base");
    const { aliceClient, bobAgent } = await makeTwoAgentRig({ channels: [a, b] });

    await aliceClient.callRich(
      bobAgent.aid,
      "ping",
      { message: "hi" },
      { pay: { amount: "1.00", currency: "USD", channel: "usdc-base" } },
    );
    expect(a.events).toEqual([]);
    expect(b.events).toHaveLength(2);
  });

  it("options.pay.channel mismatch throws", async () => {
    const a = new FakeChannel("fake-fiat");
    const { aliceClient, bobAgent } = await makeTwoAgentRig({ channels: [a] });
    await expect(
      aliceClient.callRich(
        bobAgent.aid,
        "ping",
        { message: "hi" },
        { pay: { amount: "1.00", currency: "USD", channel: "usdc-base" } },
      ),
    ).rejects.toThrow(/matching id "usdc-base"/);
  });
});
