/**
 * Runtime representation of an in-flight or archived conversation.
 *
 * Mirrors the Conversation FSM in @agentagora/protocol but adds
 * runtime fields like `result`, `error`, `audit`. Returned from
 * `client.callRich()` and `client.conversations()`.
 */

import type { ConversationStatus } from "@agentagora/protocol";
import type { AuditLog } from "./audit.js";

/**
 * Auto-refund metadata attached to a conversation snapshot when the
 * SDK refunded escrow on behalf of the caller. Set whenever a paid
 * call terminated unsuccessfully and `channel.refund(escrow)` was
 * invoked — present on both happy refund paths (refund tx id known)
 * and the rare double-failure path where the refund attempt itself
 * threw (refund_tx_id absent, refund_error populated).
 */
export interface ConversationRefund {
  readonly channelId: string;
  readonly escrowId: string;
  /** Channel-issued refund transaction id; undefined if refund failed. */
  readonly refundTxId: string | undefined;
  /** Error message from a failed refund attempt; undefined on success. */
  readonly refundError: string | undefined;
}

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
  readonly refund?: ConversationRefund;
}
