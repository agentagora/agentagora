/**
 * @agentagora/sdk — TypeScript SDK for the AgentAgora interop layer.
 *
 * Implements AAP v0.1. See ../../docs/AAP-spec.md for the on-the-wire
 * protocol and ../../docs/sdk-api-python.md for conceptual API
 * background (the Python design doc — TS API mirrors it).
 *
 * Public API:
 *   - createAgent / capability — define an agent and its capabilities
 *   - AgentAgoraClient         — call other agents
 *   - signEnvelope / verifyEnvelope — low-level signing primitives
 *   - AuditLog                 — local-first signed audit trail
 *   - SettlementChannel        — pluggable settlement (Stripe / USDC)
 *   - AAPError + subclasses    — typed error hierarchy
 *
 * Anything imported from a deeper path may break between minor versions.
 */

export { canonicalizeForSigning } from "./canonical.js";
export {
  b64uDecode,
  b64uEncode,
  generatePrivateKey,
  publicKeyFrom,
  signAuditEvent,
  signEnvelope,
  verifyAuditEvent,
  verifyEnvelope,
} from "./signing.js";
export { AuditLog, hashEvent, hashMandate, mandateHashes } from "./audit.js";
export {
  AAPError,
  CallRefundedError,
  EscrowFailedError,
  InputInvalidError,
  ManifestMismatchError,
  PaymentRequiredError,
  RateLimitedError,
  ScopeDeniedError,
  SLABreachError,
  UnauthorizedError,
} from "./errors.js";
export type {
  AgentHandler,
  EndpointResolver,
  HttpTransportOptions,
  Transport,
} from "./transport.js";
export {
  HttpTransport,
  MockTransport,
  StaticEndpointResolver,
} from "./transport.js";
export type { RegistryResolver } from "./registry.js";
export { InMemoryRegistry } from "./registry.js";
export { AgentAgoraClient } from "./client.js";
export type { AgentAgoraClientOptions, CallOptions, SpendCap } from "./client.js";
export {
  capability,
  createAgent,
  InMemoryNonceTracker,
} from "./agent.js";
export type {
  Agent,
  AgentOptions,
  CapabilityDefinition,
  CapabilityPrice,
  CapabilitySLA,
  NonceTracker,
  ServeOptions,
} from "./agent.js";
export { CloudNonceTracker } from "./cloud-nonce-tracker.js";
export type { CloudNonceTrackerOptions } from "./cloud-nonce-tracker.js";
export type { ConversationRefund, ConversationSnapshot } from "./conversation.js";
export {
  cloudPayeeAccountResolver,
  createStripeChannelFromKey,
  StripeChannel,
  stripeChannelFromEnv,
  UsdcBaseChannel,
  X402Channel,
} from "./settlement/index.js";
export type {
  EscrowHandle,
  EscrowState,
  EscrowStatus,
  SettlementChannel,
  StripeChannelFromKeyOptions,
  StripeChannelOptions,
  StripeLike,
  UsdcBaseChannelOptions,
  X402ChannelOptions,
} from "./settlement/index.js";

// Re-export the protocol types so users only need one import.
export type {
  AidString,
  AuditEvent,
  Capability,
  CartMandate,
  ConversationStatus,
  IntentMandate,
  MandatesBlock,
  Manifest,
  ParsedAid,
  PaymentMandate,
  Pricing,
  Privacy,
  RpcRequestEnvelope,
  RpcResponseEnvelope,
  Signature,
  SLA,
} from "@agentagora/protocol";
export {
  AAP_VERSION,
  Ap2,
  AuditEventTypes,
  CartMandateSchema,
  ConversationStatuses,
  ErrorCodes,
  IntentMandateSchema,
  MandatesBlockSchema,
  ManifestSchema,
  Methods,
  parseAid,
  formatAid,
  PaymentMandateSchema,
  SettlementChannels,
  SUPPORTED_AAP_VERSIONS,
} from "@agentagora/protocol";
