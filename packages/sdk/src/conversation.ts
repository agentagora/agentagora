/**
 * Runtime representation of an in-flight or archived conversation.
 *
 * Mirrors the Conversation FSM in @agentagora/protocol but adds
 * runtime fields like `result`, `error`, `audit`. Returned from
 * `client.callRich()` and `client.conversations()`.
 */

import type { ConversationStatus } from "@agentagora/protocol";
import type { AuditLog } from "./audit.js";

export interface ConversationSnapshot {
  readonly id: string;
  readonly initiator: string; // AID string
  readonly responder: string; // AID string
  readonly capability: string;
  readonly status: ConversationStatus;
  readonly startedAt: Date;
  readonly endedAt: Date | undefined;
  readonly priceAmount: string | undefined;
  readonly currency: string | undefined;
  readonly channel: string | undefined;
  readonly result: unknown;
  readonly error: { code: number; message: string; data?: Record<string, unknown> } | undefined;
  readonly audit: AuditLog;
}
