/**
 * Wire-level constants. Do not duplicate these elsewhere.
 *
 * Anything that has a value in the AAP wire format and is referred to
 * by name in code lives here.
 */

/** AAP protocol version this package speaks. */
export const AAP_VERSION = "0.1" as const;

/** Manifest schema version (independent of protocol version). */
export const MANIFEST_VERSION = 1 as const;

/** JSON-RPC method names defined by AAP. */
export const Methods = {
  Handshake: "aap.handshake",
  Invoke: "aap.invoke",
  Progress: "aap.progress",
  Complete: "aap.complete",
  Acknowledge: "aap.acknowledge",
  Dispute: "aap.dispute",
  Cancel: "aap.cancel",
} as const;

export type Method = (typeof Methods)[keyof typeof Methods];

/** Built-in settlement channel identifiers (registry of canonical channels). */
export const SettlementChannels = {
  StripeFiat: "stripe-fiat",
  UsdcBase: "usdc-base",
} as const;

export type SettlementChannelId = (typeof SettlementChannels)[keyof typeof SettlementChannels];

/** Audit event type names. */
export const AuditEventTypes = {
  ConversationOpened: "aap.conversation.opened",
  HandshakeAccepted: "aap.handshake.accepted",
  EscrowFunded: "aap.escrow.funded",
  InvocationStarted: "aap.invocation.started",
  ProgressReported: "aap.progress.reported",
  InvocationCompleted: "aap.invocation.completed",
  Acknowledged: "aap.acknowledged",
  EscrowCaptured: "aap.escrow.captured",
  EscrowRefunded: "aap.escrow.refunded",
  DisputeOpened: "aap.dispute.opened",
  DisputeResolved: "aap.dispute.resolved",
  ConversationArchived: "aap.conversation.archived",
} as const;

export type AuditEventType = (typeof AuditEventTypes)[keyof typeof AuditEventTypes];
