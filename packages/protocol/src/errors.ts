/**
 * AAP error codes. JSON-RPC error code -> typed identifier mapping.
 *
 * The numeric codes are the wire format. The string identifiers and
 * names are for application code, logs, and human-readable messages.
 *
 * See AAP-spec.md section 6.4 for the canonical list.
 */

import { z } from "zod";

export const ErrorCodes = {
  Unauthorized: -32001,
  ScopeDenied: -32002,
  ManifestMismatch: -32003,
  InputInvalid: -32004,
  PaymentRequired: -32005,
  EscrowFailed: -32006,
  SLABreach: -32007,
  RateLimited: -32008,
  Internal: -32099,
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export const ErrorNames: Record<ErrorCode, string> = {
  [ErrorCodes.Unauthorized]: "aap.unauthorized",
  [ErrorCodes.ScopeDenied]: "aap.scope_denied",
  [ErrorCodes.ManifestMismatch]: "aap.manifest_mismatch",
  [ErrorCodes.InputInvalid]: "aap.input_invalid",
  [ErrorCodes.PaymentRequired]: "aap.payment_required",
  [ErrorCodes.EscrowFailed]: "aap.escrow_failed",
  [ErrorCodes.SLABreach]: "aap.sla_breach",
  [ErrorCodes.RateLimited]: "aap.rate_limited",
  [ErrorCodes.Internal]: "aap.internal",
};

/** Wire shape of a JSON-RPC error per AAP. */
export const RpcErrorSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.record(z.unknown()).optional(),
});

export type RpcError = z.infer<typeof RpcErrorSchema>;

/**
 * Build a wire-format error object.
 */
export function makeRpcError(
  code: ErrorCode,
  message?: string,
  data?: Record<string, unknown>,
): RpcError {
  return {
    code,
    message: message ?? ErrorNames[code],
    ...(data ? { data } : {}),
  };
}
