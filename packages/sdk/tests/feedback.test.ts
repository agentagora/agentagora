/**
 * M7-lite: `aap.feedback.recorded` + the ERC-8004 bridge helper.
 *
 * Feedback is the raw, evidence-backed data layer for reputation: a signed
 * audit event in the initiator's own chain (so it syncs to the cloud and is
 * tamper-evident like everything else), plus an optional off-chain file
 * builder for ERC-8004's Reputation Registry.
 */

import { AuditEventTypes } from "@agentagora/protocol";
import { describe, expect, it } from "vitest";
import { buildErc8004Feedback, verifyAuditEvent } from "../src/index.js";
import { publicKeyFrom } from "../src/index.js";
import { makeTwoAgentRig } from "./_fixtures.js";

describe("AgentAgoraClient.recordFeedback", () => {
  it("appends a signed feedback event with subject/capability derived from the chain", async () => {
    const rig = await makeTwoAgentRig();
    const conv = await rig.aliceClient.callRich(rig.bobAgent.aid, "ping", { message: "hi" });

    await rig.aliceClient.recordFeedback(conv.id, {
      score: 92,
      tags: ["fast"],
      comment: "did what it said",
    });

    const events = [...conv.audit.events];
    const fb = events.find((e) => e.type === AuditEventTypes.FeedbackRecorded);
    expect(fb).toBeDefined();
    expect(fb?.actor_aid).toBe(rig.aliceAid);
    expect(fb?.data.subject_aid).toBe(rig.bobAgent.aid); // derived
    expect(fb?.data.capability).toBe("ping"); // derived
    expect(fb?.data.score).toBe(92);
    expect(fb?.data.tags).toEqual(["fast"]);

    // Chain integrity holds and the event verifies like any other.
    expect(conv.audit.verifyChain()).toBe(true);
    expect(await verifyAuditEvent(fb as never, await publicKeyFrom(rig.aliceKey))).toBe(true);
  });

  it("rejects out-of-range scores and unknown conversations", async () => {
    const rig = await makeTwoAgentRig();
    const conv = await rig.aliceClient.callRich(rig.bobAgent.aid, "ping", { message: "hi" });

    await expect(rig.aliceClient.recordFeedback(conv.id, { score: 101 })).rejects.toThrow(
      /integer 0–100/,
    );
    await expect(rig.aliceClient.recordFeedback(conv.id, { score: 4.5 })).rejects.toThrow(
      /integer 0–100/,
    );
    await expect(rig.aliceClient.recordFeedback("conv_nope", { score: 50 })).rejects.toThrow(
      /unknown conversation/,
    );
  });
});

describe("buildErc8004Feedback", () => {
  it("builds the off-chain file with AAP evidence + a keccak feedbackHash", async () => {
    const rig = await makeTwoAgentRig();
    const conv = await rig.aliceClient.callRich(rig.bobAgent.aid, "ping", { message: "hi" });
    await rig.aliceClient.recordFeedback(conv.id, { score: 88 });

    const out = buildErc8004Feedback({
      log: conv.audit,
      agentId: 42n,
      score: 88,
      clientAddress: "0x1111111111111111111111111111111111111111",
      agentRegistry: "eip155:1:0xregistry",
      capability: "ping",
      endpoint: "http://bob.test/rpc",
      createdAt: "2026-07-02T00:00:00.000Z",
    });

    expect(out.file.agentId).toBe("42");
    expect(out.file.value).toBe(88);
    const aap = out.file.aap as Record<string, unknown>;
    expect(aap.conversation_id).toBe(conv.id);
    expect(String(aap.chain_head_hash)).toMatch(/^sha256:/);
    expect(aap.event_count).toBe(conv.audit.events.length);
    expect(out.feedbackHashHex).toMatch(/^0x[0-9a-f]{64}$/);
    expect(out.suggestedArgs).toEqual({
      agentId: "42",
      value: 88,
      valueDecimals: 0,
      tag1: "ping",
      tag2: "",
      endpoint: "http://bob.test/rpc",
    });

    // Deterministic: same inputs → same hash.
    const again = buildErc8004Feedback({
      log: conv.audit,
      agentId: 42n,
      score: 88,
      clientAddress: "0x1111111111111111111111111111111111111111",
      agentRegistry: "eip155:1:0xregistry",
      capability: "ping",
      endpoint: "http://bob.test/rpc",
      createdAt: "2026-07-02T00:00:00.000Z",
    });
    expect(again.feedbackHashHex).toBe(out.feedbackHashHex);
  });

  it("rejects invalid scores and empty logs", async () => {
    const rig = await makeTwoAgentRig();
    const conv = await rig.aliceClient.callRich(rig.bobAgent.aid, "ping", { message: "hi" });
    expect(() =>
      buildErc8004Feedback({ log: conv.audit, agentId: 1, score: -1, clientAddress: "0x0" }),
    ).toThrow(/integer 0–100/);
  });
});
