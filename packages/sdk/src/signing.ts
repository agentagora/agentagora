/**
 * Ed25519 signing and verification of AAP envelopes.
 *
 * Uses @noble/ed25519 (pure JS, runs on every supported runtime
 * including Cloudflare Workers — no Node `crypto` dependency).
 */

import type {
  AuditEvent,
  RpcRequestEnvelope,
  RpcResponseEnvelope,
  Signature,
} from "@agentagora/protocol";
import * as ed from "@noble/ed25519";
import { canonicalizeForSigning } from "./canonical.js";

// @noble/ed25519 v2 requires a synchronous SHA-512 implementation.
// We import it lazily so this file remains tree-shakeable for users
// who only use type imports.
import { sha512 } from "@noble/hashes/sha512";
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const PLACEHOLDER_SIG: Signature = {
  alg: "EdDSA",
  key_id: "",
  value: "",
};

/** Generate a new Ed25519 private key. */
export function generatePrivateKey(): Uint8Array {
  return ed.utils.randomPrivateKey();
}

/** Derive the public key (raw 32 bytes) from a private key. */
export async function publicKeyFrom(privateKey: Uint8Array): Promise<Uint8Array> {
  return ed.getPublicKey(privateKey);
}

/** base64url encode (without padding). */
export function b64uEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
 * Sign an AAP envelope in place.
 *
 * The signature is computed over the JCS canonicalization of the
 * full envelope with `aap.signature.value` cleared. The resulting
 * signature is then written back into `aap.signature`.
 */
export async function signEnvelope<T extends RpcRequestEnvelope | RpcResponseEnvelope>(
  envelope: T,
  options: { privateKey: Uint8Array; keyId: string },
): Promise<T> {
  envelope.aap = {
    ...envelope.aap,
    signature: { ...PLACEHOLDER_SIG, key_id: options.keyId },
  };
  const bytes = canonicalizeForSigning(envelope);
  const sig = await ed.signAsync(bytes, options.privateKey);
  envelope.aap.signature = {
    alg: "EdDSA",
    key_id: options.keyId,
    value: b64uEncode(sig),
  };
  return envelope;
}

/**
 * Verify an AAP envelope's signature against a public key.
 * Returns `true` iff the signature is valid.
 */
export async function verifyEnvelope(
  envelope: RpcRequestEnvelope | RpcResponseEnvelope,
  publicKey: Uint8Array,
): Promise<boolean> {
  const sig = envelope.aap.signature;
  if (!sig?.value) return false;
  const sigBytes = b64uDecode(sig.value);

  const cloned = JSON.parse(JSON.stringify(envelope)) as typeof envelope;
  cloned.aap.signature = { alg: sig.alg, key_id: sig.key_id, value: "" };
  const bytes = canonicalizeForSigning(cloned);
  try {
    return await ed.verifyAsync(sigBytes, bytes, publicKey);
  } catch {
    return false;
  }
}

/**
 * Sign an audit event in place.
 *
 * Computes the signature over the JCS canonicalization of the event
 * with `signature.value` cleared, then writes the signature back into
 * `event.signature`.
 */
export async function signAuditEvent(
  event: AuditEvent,
  options: { privateKey: Uint8Array; keyId: string },
): Promise<AuditEvent> {
  event.signature = { ...PLACEHOLDER_SIG, key_id: options.keyId };
  const bytes = canonicalizeForSigning(event);
  const sig = await ed.signAsync(bytes, options.privateKey);
  event.signature = {
    alg: "EdDSA",
    key_id: options.keyId,
    value: b64uEncode(sig),
  };
  return event;
}

/**
 * Verify an audit event's signature against a public key.
 * Returns `true` iff the signature is valid.
 */
export async function verifyAuditEvent(event: AuditEvent, publicKey: Uint8Array): Promise<boolean> {
  if (!event.signature?.value) return false;
  const sigBytes = b64uDecode(event.signature.value);
  const cloned = JSON.parse(JSON.stringify(event)) as AuditEvent;
  cloned.signature = {
    alg: cloned.signature.alg,
    key_id: cloned.signature.key_id,
    value: "",
  };
  const bytes = canonicalizeForSigning(cloned);
  try {
    return await ed.verifyAsync(sigBytes, bytes, publicKey);
  } catch {
    return false;
  }
}
