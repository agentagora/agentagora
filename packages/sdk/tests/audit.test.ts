import type { AuditEvent } from "@agentagora/protocol";
import { describe, expect, it } from "vitest";
import { AuditLog, hashEvent } from "../src/audit.js";

function makeEvent(
  conversationId: string,
  prev: string | null,
  type: string,
  data: Record<string, unknown> = {},
): AuditEvent {
  return {
    event_id: `evt_${Math.random().toString(36).slice(2, 10)}`,
    conversation_id: conversationId,
    type,
    timestamp: "2026-04-30T12:34:56.789Z",
    actor_aid: "aid:agentagora:alice/research" as never,
    previous_event_hash: prev,
    data,
    signature: { alg: "EdDSA", key_id: "alice/research#k1", value: "fakesig" },
  };
}

describe("AuditLog", () => {
  it("appends a chain of events and verifies", () => {
    const log = new AuditLog("conv_1");
    const e1 = makeEvent("conv_1", null, "aap.conversation.opened");
    log.append(e1);
    const e2 = makeEvent("conv_1", hashEvent(e1), "aap.invocation.started");
    log.append(e2);
    const e3 = makeEvent("conv_1", hashEvent(e2), "aap.invocation.completed", {
      bytes_out: 100,
    });
    log.append(e3);

    expect(log.events).toHaveLength(3);
    expect(log.verifyChain()).toBe(true);
  });

  it("rejects an event with the wrong previous_event_hash", () => {
    const log = new AuditLog("conv_2");
    const e1 = makeEvent("conv_2", null, "aap.conversation.opened");
    log.append(e1);
    const wrong = makeEvent("conv_2", "sha256:000000", "aap.invocation.started");
    expect(() => log.append(wrong)).toThrow(/previous_event_hash mismatch/);
  });

  it("rejects an event with a mismatched conversation_id", () => {
    const log = new AuditLog("conv_3");
    const e = makeEvent("conv_OTHER", null, "aap.conversation.opened");
    expect(() => log.append(e)).toThrow(/conversation_id/);
  });

  it("hash is stable across re-runs", () => {
    const e = makeEvent("conv_x", null, "aap.conversation.opened", { a: 1 });
    expect(hashEvent(e)).toBe(hashEvent(e));
  });
});
