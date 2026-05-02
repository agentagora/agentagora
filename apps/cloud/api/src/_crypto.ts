/**
 * Detached-signature primitives for manifest publishes.
 *
 * Tiny copy of what the SDK does for envelope signing: canonicalize a
 * JSON value to bytes per RFC 8785 (JCS), and verify an Ed25519
 * signature over those bytes. Kept inside cloud-api so the control
 * plane doesn't pull in the client SDK; if a third consumer appears
 * the right move is to promote these primitives to @agentagora/protocol.
 */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import canonicalize from "canonicalize";

// @noble/ed25519 v2 needs a synchronous SHA-512 implementation.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

/**
 * RFC 8785 canonicalization. Throws on floats — AAP carries decimals
 * as strings to avoid cross-runtime precision drift.
 */
export function canonicalizeJsonBytes(value: unknown): Uint8Array {
  rejectFloats(value);
  const text = canonicalize(value);
  if (text === undefined) {
    throw new TypeError("canonicalize returned undefined; input contains an unsupported value");
  }
  return new TextEncoder().encode(text);
}

/** base64url decode. Accepts with or without padding. */
export function b64uDecode(value: string): Uint8Array {
  const pad = "=".repeat((4 - (value.length % 4)) % 4);
  const normalized = (value + pad).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Verify `signature` over `bytes` using the given Ed25519 public key.
 * Returns false on any malformed input rather than throwing — the
 * caller turns that into an HTTP 401.
 */
export async function verifyEd25519(
  signature: Uint8Array,
  bytes: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  try {
    return await ed.verifyAsync(signature, bytes, publicKey);
  } catch {
    return false;
  }
}

function rejectFloats(value: unknown, path: string[] = []): void {
  if (value === null || value === undefined) return;
  const t = typeof value;
  if (t === "number") {
    if (!Number.isInteger(value)) {
      const at = path.length > 0 ? ` at ${path.join(".")}` : "";
      throw new TypeError(
        `float values are not permitted in canonical JSON${at}; encode decimals as strings`,
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
  }
}
