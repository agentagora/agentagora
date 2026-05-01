/**
 * JSON Canonicalization for AAP signed envelopes.
 *
 * Wraps the `canonicalize` package (RFC 8785). We expose a thin
 * function and add validation that floats are not present — AAP
 * carries decimals as strings (e.g., "0.50") to avoid float
 * precision issues across language and runtime boundaries.
 */

import canonicalize from "canonicalize";

/**
 * Return the canonical JSON byte sequence for `value`, suitable for
 * passing into a signature function.
 *
 * Throws if `value` contains floating-point numbers; encode decimals
 * as strings instead.
 */
export function canonicalizeForSigning(value: unknown): Uint8Array {
  rejectFloats(value);
  const text = canonicalize(value);
  if (text === undefined) {
    throw new TypeError("canonicalize returned undefined; input contains an unsupported value");
  }
  return new TextEncoder().encode(text);
}

function rejectFloats(value: unknown, path: string[] = []): void {
  if (value === null || value === undefined) return;
  const t = typeof value;
  if (t === "number") {
    if (!Number.isInteger(value)) {
      const at = path.length > 0 ? ` at ${path.join(".")}` : "";
      throw new TypeError(
        `float values are not permitted in AAP signed envelopes${at}; encode decimals as strings`,
      );
    }
    return;
  }
  if (t === "string" || t === "boolean") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => rejectFloats(item, [...path, String(i)]));
    return;
  }
  if (t === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      rejectFloats(v, [...path, k]);
    }
    return;
  }
  throw new TypeError(`unsupported value type for canonicalization: ${t}`);
}
