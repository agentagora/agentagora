/**
 * Helper for emitting chained, signed audit events into an AuditLog.
 *
 * Lives in _internal because the chaining + signing pipeline is not
 * meant to be exposed directly to users — they interact with the SDK
 * via `client.callRich()` / `agent.getAuditLog()` instead.
 */

import type { AuditEvent, AuditEventType } from "@agentagora/protocol";
import { type AuditLog, hashEvent } from "../audit.js";
import { signAuditEvent } from "../signing.js";
import { makeId, makeTimestamp } from "./ids.js";

/**
 * Create a signed event chained off the log's tail and append it.
 * Returns the appended event.
 */
export async function writeEvent(
  log: AuditLog,
  options: {
    type: AuditEventType;
    actorAid: string;
    privateKey: Uint8Array;
    keyId: string;
    data?: Record<string, unknown>;
  },
): Promise<AuditEvent> {
  const previous =
    log.events.length === 0 ? null : hashEvent(log.events[log.events.length - 1] as AuditEvent);

  const event: AuditEvent = {
    event_id: makeId("evt_"),
    conversation_id: log.conversationId,
    type: options.type,
    timestamp: makeTimestamp(),
    actor_aid: options.actorAid as never,
    previous_event_hash: previous,
    data: options.data ?? {},
    signature: { alg: "EdDSA", key_id: options.keyId, value: "" },
  };

  await signAuditEvent(event, { privateKey: options.privateKey, keyId: options.keyId });
  log.append(event);
  return event;
}
