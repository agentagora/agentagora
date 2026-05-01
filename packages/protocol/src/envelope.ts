/**
 * AAP wire envelope — JSON-RPC 2.0 with extensions.
 *
 * Mirrors AAP-spec section 6.2.
 */

import { z } from "zod";
import { AAP_VERSION } from "./constants.js";
import { RpcErrorSchema } from "./errors.js";
import { AidSchema } from "./identity.js";

export const SignatureSchema = z.object({
  alg: z.literal("EdDSA"),
  /** Stable identifier for the key used; e.g., "alice/orchestrator#k1". */
  key_id: z.string(),
  /** base64url-encoded signature bytes. Empty string permitted only
   *  during the canonicalization step before signing. */
  value: z.string(),
});

export type Signature = z.infer<typeof SignatureSchema>;

export const AapEnvelopeMetaSchema = z.object({
  version: z.literal(AAP_VERSION),
  conversation_id: z.string().min(1),
  /** ISO 8601 with millisecond precision and 'Z' suffix. */
  timestamp: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "expected ISO 8601 .NNNZ"),
  nonce: z.string().min(1),
  from: AidSchema,
  to: AidSchema,
  signature: SignatureSchema,
});

export type AapEnvelopeMeta = z.infer<typeof AapEnvelopeMetaSchema>;

const JsonRpcId = z.union([z.string(), z.number().int(), z.null()]);

export const RpcRequestEnvelopeSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: JsonRpcId,
  method: z.string().min(1),
  params: z.unknown().optional(),
  aap: AapEnvelopeMetaSchema,
});

export type RpcRequestEnvelope = z.infer<typeof RpcRequestEnvelopeSchema>;

export const RpcSuccessResponseEnvelopeSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: JsonRpcId,
  result: z.unknown(),
  aap: AapEnvelopeMetaSchema,
});

export const RpcErrorResponseEnvelopeSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: JsonRpcId,
  error: RpcErrorSchema,
  aap: AapEnvelopeMetaSchema,
});

export const RpcResponseEnvelopeSchema = z.union([
  RpcSuccessResponseEnvelopeSchema,
  RpcErrorResponseEnvelopeSchema,
]);

export type RpcSuccessResponseEnvelope = z.infer<typeof RpcSuccessResponseEnvelopeSchema>;
export type RpcErrorResponseEnvelope = z.infer<typeof RpcErrorResponseEnvelopeSchema>;
export type RpcResponseEnvelope = z.infer<typeof RpcResponseEnvelopeSchema>;

/** Convenience union for any AAP envelope. */
export type AapEnvelope = RpcRequestEnvelope | RpcResponseEnvelope;
