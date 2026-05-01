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
