/**
 * Wire-level constants. Do not duplicate these elsewhere.
 *
 * Anything that has a value in the AAP wire format and is referred to
 * by name in code lives here.
 */

/** AAP protocol version this package emits on every signed envelope. */
export const AAP_VERSION = "0.2" as const;

/**
 * Wire versions this package accepts on inbound envelopes.
 *
 * v0.2 is a backward-compatible MINOR over v0.1 (AP2 mandate carriage,
 * the `x402` settlement channel, the optional `aap.authorize` method).
 * Per the versioning policy, a v0.1 envelope MUST still validate — so we
 * accept the whole supported set inbound while only ever emitting the
 * latest (`AAP_VERSION`).
 */
export const SUPPORTED_AAP_VERSIONS = ["0.1", "0.2"] as const;

export type SupportedAapVersion = (typeof SUPPORTED_AAP_VERSIONS)[number];

/** Manifest schema version (independent of protocol version). */
export const MANIFEST_VERSION = 1 as const;

/** JSON-RPC method names defined by AAP. */
export const Methods = {
  Handshake: "aap.handshake",
  Invoke: "aap.invoke",
  /**
   * Carries a `PaymentMandate` (AP2) authorizing escrow capture. Optional;
   * implementations MAY fold the mandate into `aap.invoke` params instead.
   * Added in v0.2.
   */
  Authorize: "aap.authorize",
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
  /**
   * AP2 x402 onchain stablecoin rail (USDC on Base). Escrow stays an AAP
   * construct (the escrow contract); x402 is the capture/settlement rail.
   * Added in v0.2. See `docs/AAP-spec-ap2-binding.md` §5.
   */
  X402: "x402",
} as const;

export type SettlementChannelId = (typeof SettlementChannels)[keyof typeof SettlementChannels];

/**
 * AP2 (Agent Payments Protocol) interop constants — v0.2.
 *
 * AAP carries AP2 Mandates verbatim as the payment-authorization payload so
 * an AP2-native counterparty interoperates. The mandate VCs carry their own
 * proof (typically ES256), verified independently of the EdDSA AAP envelope.
 * See `docs/AAP-spec-ap2-binding.md`.
 */
export const Ap2 = {
  /** Value for the `X-A2A-Extensions` header when AAP runs over an A2A transport. */
  ExtensionUri: "https://github.com/google-agentic-commerce/ap2/v1",
  /** Data-part / `params.mandates` keys for each mandate type. */
  MandateKeys: {
    Intent: "ap2.mandates.IntentMandate",
    Cart: "ap2.mandates.CartMandate",
    Payment: "ap2.mandates.PaymentMandate",
  },
} as const;

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
