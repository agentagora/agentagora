/**
 * SDK-level error wrappers.
 *
 * The wire-level error code <-> name mapping lives in @agentagora/protocol.
 * This module wraps those into JS Error subclasses for ergonomic
 * try/catch.
 */

import { ErrorCodes, ErrorNames, type RpcError } from "@agentagora/protocol";

export class AAPError extends Error {
  readonly code: number;
  readonly data: Record<string, unknown> | undefined;

  constructor(code: number, message: string, data?: Record<string, unknown>) {
    super(message || `aap error ${code}`);
    this.name = "AAPError";
    this.code = code;
    this.data = data;
  }

  toRpc(): RpcError {
    return this.data
      ? { code: this.code, message: this.message, data: this.data }
      : { code: this.code, message: this.message };
  }

  static fromRpc(error: RpcError): AAPError {
    const factory = CODE_TO_FACTORY.get(error.code);
    if (factory) return factory(error.message, error.data);
    return new AAPError(error.code, error.message, error.data);
  }
}

export class UnauthorizedError extends AAPError {
  constructor(message?: string, data?: Record<string, unknown>) {
    super(ErrorCodes.Unauthorized, message ?? ErrorNames[ErrorCodes.Unauthorized], data);
    this.name = "UnauthorizedError";
  }
}

export class ScopeDeniedError extends AAPError {
  constructor(message?: string, data?: Record<string, unknown>) {
    super(ErrorCodes.ScopeDenied, message ?? ErrorNames[ErrorCodes.ScopeDenied], data);
    this.name = "ScopeDeniedError";
  }
}

export class ManifestMismatchError extends AAPError {
  constructor(message?: string, data?: Record<string, unknown>) {
    super(ErrorCodes.ManifestMismatch, message ?? ErrorNames[ErrorCodes.ManifestMismatch], data);
    this.name = "ManifestMismatchError";
  }
}

export class InputInvalidError extends AAPError {
  constructor(message?: string, data?: Record<string, unknown>) {
    super(ErrorCodes.InputInvalid, message ?? ErrorNames[ErrorCodes.InputInvalid], data);
    this.name = "InputInvalidError";
  }
}

export class PaymentRequiredError extends AAPError {
  constructor(message?: string, data?: Record<string, unknown>) {
    super(ErrorCodes.PaymentRequired, message ?? ErrorNames[ErrorCodes.PaymentRequired], data);
    this.name = "PaymentRequiredError";
  }

  get requiredChannels(): string[] {
    const v = this.data?.required_channels;
    return Array.isArray(v) ? (v as string[]) : [];
  }
}

export class EscrowFailedError extends AAPError {
  constructor(message?: string, data?: Record<string, unknown>) {
    super(ErrorCodes.EscrowFailed, message ?? ErrorNames[ErrorCodes.EscrowFailed], data);
    this.name = "EscrowFailedError";
  }
}

export class SLABreachError extends AAPError {
  constructor(message?: string, data?: Record<string, unknown>) {
    super(ErrorCodes.SLABreach, message ?? ErrorNames[ErrorCodes.SLABreach], data);
    this.name = "SLABreachError";
  }
}

export class RateLimitedError extends AAPError {
  constructor(message?: string, data?: Record<string, unknown>) {
    super(ErrorCodes.RateLimited, message ?? ErrorNames[ErrorCodes.RateLimited], data);
    this.name = "RateLimitedError";
  }
}

/**
 * Wraps the original error from a paid `client.call()` after the
 * SDK has automatically refunded (or attempted to refund) the
 * caller's escrow.
 *
 * Surfaces three things the caller couldn't otherwise observe:
 *   - `cause`         — the original underlying error that triggered
 *                       refund (RPC error, signature mismatch,
 *                       transport failure, etc.). Mirrors the same
 *                       error the call would have rejected with had
 *                       no escrow been involved.
 *   - `escrowId`      — the channel-issued escrow id whose lifecycle
 *                       just terminated.
 *   - `refundTxId`    — the channel's refund transaction id when the
 *                       refund succeeded; `undefined` when the refund
 *                       itself failed.
 *   - `refundError`   — the Error from a failed refund attempt; the
 *                       original `cause` still wins, but ops needs to
 *                       see why the refund didn't go through.
 *
 * Designed so that `try/catch` consumers reading off `.code`, `.message`,
 * or `instanceof AAPError` continue to work — the inner `cause` is
 * cloned into this error's code/message/data so existing call sites
 * keep observing the underlying failure mode.
 */
export class CallRefundedError extends AAPError {
  override readonly cause: Error;
  readonly escrowId: string;
  readonly channelId: string;
  readonly refundTxId: string | undefined;
  readonly refundError: Error | undefined;

  constructor(args: {
    cause: Error;
    escrowId: string;
    channelId: string;
    refundTxId?: string;
    refundError?: Error;
  }) {
    const innerCode = args.cause instanceof AAPError ? args.cause.code : ErrorCodes.Internal;
    const innerData = args.cause instanceof AAPError ? args.cause.data : undefined;
    const message = buildRefundedMessage(args);
    super(innerCode, message, {
      ...(innerData ?? {}),
      escrow_id: args.escrowId,
      channel_id: args.channelId,
      ...(args.refundTxId !== undefined ? { refund_tx_id: args.refundTxId } : {}),
      ...(args.refundError !== undefined ? { refund_error: args.refundError.message } : {}),
      original_message: args.cause.message,
    });
    this.name = "CallRefundedError";
    this.cause = args.cause;
    this.escrowId = args.escrowId;
    this.channelId = args.channelId;
    this.refundTxId = args.refundTxId;
    this.refundError = args.refundError;
  }
}

function buildRefundedMessage(args: {
  cause: Error;
  refundTxId?: string;
  refundError?: Error;
}): string {
  const head = args.cause.message || "call failed";
  if (args.refundTxId !== undefined) {
    return `${head} [auto-refunded: ${args.refundTxId}]`;
  }
  if (args.refundError !== undefined) {
    return `${head} [auto-refund failed: ${args.refundError.message}]`;
  }
  return head;
}

type ErrorFactory = (message?: string, data?: Record<string, unknown>) => AAPError;

const CODE_TO_FACTORY = new Map<number, ErrorFactory>([
  [ErrorCodes.Unauthorized, (m, d) => new UnauthorizedError(m, d)],
  [ErrorCodes.ScopeDenied, (m, d) => new ScopeDeniedError(m, d)],
  [ErrorCodes.ManifestMismatch, (m, d) => new ManifestMismatchError(m, d)],
  [ErrorCodes.InputInvalid, (m, d) => new InputInvalidError(m, d)],
  [ErrorCodes.PaymentRequired, (m, d) => new PaymentRequiredError(m, d)],
  [ErrorCodes.EscrowFailed, (m, d) => new EscrowFailedError(m, d)],
  [ErrorCodes.SLABreach, (m, d) => new SLABreachError(m, d)],
  [ErrorCodes.RateLimited, (m, d) => new RateLimitedError(m, d)],
]);
