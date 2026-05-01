/**
 * End-to-end audit log behavior across a successful and a failed call.
 *
 * Verifies that:
 *   - Both initiator and responder write per-conversation chained logs
 *   - Each event signature verifies against the actor's public key
 *   - Chain hashes are intact (no tampering possible without breaking
 *     the chain)
 *   - Failure paths still produce an `archived` event with the error
 *     captured in `data`
 */

import { type AuditEvent, AuditEventTypes, ConversationStatuses } from "@agentagora/protocol";
import { describe, expect, it } from "vitest";
import { publicKeyFrom, verifyAuditEvent } from "../src/index.js";
import { makeTwoAgentRig } from "./_fixtures.js";

describe("audit trail — successful call", () => {
  it("initiator writes opened → acknowledged → archived; chain verifies", async () => {
    const rig = await makeTwoAgentRig();
    const alicePubKey = await publicKeyFrom(rig.aliceKey);
    const conv = await rig.aliceClient.callRich(rig.bobAgent.aid, "ping", { message: "hi" });

    expect(conv.status).toBe(ConversationStatuses.Archived);
    expect((conv.result as { reply: string }).reply).toBe("pong: hi");

    const events = [...conv.audit.events];
    expect(events.map((e) => e.type)).toEqual([
      AuditEventTypes.ConversationOpened,
      AuditEventTypes.Acknowledged,
      AuditEventTypes.ConversationArchived,
    ]);

    expect(conv.audit.verifyChain()).toBe(true);

    for (const ev of events) {
      expect(await verifyAuditEvent(ev, alicePubKey)).toBe(true);
    }
  });

  it("responder writes invocation.started → invocation.completed; chain verifies", async () => {
    const rig = await makeTwoAgentRig();
    const bobPubKey = await publicKeyFrom(rig.bobKey);
    const conv = await rig.aliceClient.callRich(rig.bobAgent.aid, "ping", { message: "hi" });

    const responderLog = rig.bobAgent.getAuditLog(conv.id);
    expect(responderLog).toBeDefined();
    const events = [...(responderLog?.events ?? [])];
    expect(events.map((e) => e.type)).toEqual([
      AuditEventTypes.InvocationStarted,
      AuditEventTypes.InvocationCompleted,
    ]);
    expect(responderLog?.verifyChain()).toBe(true);

    for (const ev of events) {
      expect(await verifyAuditEvent(ev, bobPubKey)).toBe(true);
    }
  });

  it("snapshot fields are populated", async () => {
    const rig = await makeTwoAgentRig();
    const conv = await rig.aliceClient.callRich(rig.bobAgent.aid, "ping", { message: "x" });

    expect(conv.id).toMatch(/^conv_/);
    expect(conv.initiator).toBe(rig.aliceAid);
    expect(conv.responder).toBe(rig.bobAgent.aid);
    expect(conv.capability).toBe("ping");
    expect(conv.startedAt).toBeInstanceOf(Date);
    expect(conv.endedAt).toBeInstanceOf(Date);
    expect(conv.error).toBeUndefined();
  });

  it("client.getAuditLog retrieves the same log returned in the snapshot", async () => {
    const { aliceClient, bobAgent } = await makeTwoAgentRig();
    const conv = await aliceClient.callRich(bobAgent.aid, "ping", { message: "x" });
    expect(aliceClient.getAuditLog(conv.id)).toBe(conv.audit);
  });
});

describe("audit trail — failed call", () => {
  it("initiator log: opened → archived (no acknowledged); status=cancelled", async () => {
    const { aliceClient, bobAgent } = await makeTwoAgentRig();
    const conv = await aliceClient.callRich(bobAgent.aid, "crash", {});

    expect(conv.status).toBe(ConversationStatuses.Cancelled);
    expect(conv.error?.code).toBe(-32099);
    expect(conv.error?.message).toMatch(/intentional/);

    const types = [...conv.audit.events].map((e) => e.type);
    expect(types).toEqual([
      AuditEventTypes.ConversationOpened,
      AuditEventTypes.ConversationArchived,
    ]);
    expect(conv.audit.verifyChain()).toBe(true);

    const archived = [...conv.audit.events].find(
      (e) => e.type === AuditEventTypes.ConversationArchived,
    );
    expect(archived?.data.status).toBe(ConversationStatuses.Cancelled);
    expect((archived?.data.error as { message: string }).message).toMatch(/intentional/);
  });
});

describe("tamper resistance", () => {
  it("rejects a chain with a mutated middle event", async () => {
    const { aliceClient, bobAgent } = await makeTwoAgentRig();
    const conv = await aliceClient.callRich(bobAgent.aid, "ping", { message: "x" });

    const events = [...conv.audit.events] as AuditEvent[];
    expect(events.length).toBeGreaterThanOrEqual(3);
    // Tamper with the middle event's data — the chain breaks because
    // the next event's previous_event_hash will no longer match.
    const middle = events[1] as AuditEvent;
    middle.data = { ...middle.data, smuggled: "evil" };

    // verifyChain on the mutated log should now fail.
    expect(conv.audit.verifyChain()).toBe(false);
  });
});
