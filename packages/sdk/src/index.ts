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
  signEnvelope,
  verifyEnvelope,
} from "./signing.js";
export { AuditLog, hashEvent } from "./audit.js";
export {
  AAPError,
  EscrowFailedError,
  InputInvalidError,
  ManifestMismatchError,
  PaymentRequiredError,
  RateLimitedError,
  ScopeDeniedError,
  SLABreachError,
  UnauthorizedError,
} from "./errors.js";
export type { AgentHandler, Transport } from "./transport.js";
export { HttpTransport, MockTransport } from "./transport.js";
export type { RegistryResolver } from "./registry.js";
export { InMemoryRegistry } from "./registry.js";
export { AgentAgoraClient } from "./client.js";
export type { AgentAgoraClientOptions, CallOptions, SpendCap } from "./client.js";
export {
  capability,
  createAgent,
} from "./agent.js";
export type {
  Agent,
  AgentOptions,
  CapabilityDefinition,
  CapabilityPrice,
  CapabilitySLA,
  ServeOptions,
} from "./agent.js";
export type { ConversationSnapshot } from "./conversation.js";
export {
  StripeChannel,
  UsdcBaseChannel,
} from "./settlement/index.js";
export type {
  EscrowHandle,
  EscrowState,
  EscrowStatus,
  SettlementChannel,
} from "./settlement/index.js";

// Re-export the protocol types so users only need one import.
export type {
  AidString,
  AuditEvent,
  Capability,
  ConversationStatus,
  Manifest,
  ParsedAid,
  Pricing,
  Privacy,
  RpcRequestEnvelope,
  RpcResponseEnvelope,
  Signature,
  SLA,
} from "@agentagora/protocol";
export {
  AAP_VERSION,
  AuditEventTypes,
  ConversationStatuses,
  ErrorCodes,
  ManifestSchema,
  Methods,
  parseAid,
  formatAid,
  SettlementChannels,
} from "@agentagora/protocol";
