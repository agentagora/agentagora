/**
 * Client-side manifest signing.
 *
 * The cloud-api expects a detached Ed25519 signature over the JCS
 * canonical bytes of the JSON request body, plus the publisher's raw
 * 32-byte public key as `X-AAP-Pubkey`. The user's private signing
 * key NEVER leaves the browser — this module is imported only from a
 * Client Component, runs entirely in the user's tab, and the publish
 * form posts the signed payload directly to cloud-api's
 * `POST /v1/agents` (origin-to-origin).
 *
 * The same canonicalization rules apply as elsewhere in AAP: keys
 * sorted lexicographically, no whitespace, decimals encoded as
 * strings. We use the `canonicalize` package (RFC 8785) to match the
 * cloud-api's `_crypto.canonicalizeJsonBytes`.
 */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import canonicalize from "canonicalize";

// @noble/ed25519 v2 needs a synchronous SHA-512 implementation
// supplied at runtime. Set it once at module load.
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

export interface SignedPublish {
  /** Wire-form bytes posted to cloud-api. The signature was taken
   *  over these exact bytes; do not re-stringify. */
  body: string;
  /** base64url(raw 32-byte public key). */
  pubkey: string;
  /** base64url(64-byte Ed25519 signature). */
  signature: string;
}

/**
 * Sign a manifest object for `POST /v1/agents`.
 *
 * `privateKeyB64u` is the user's raw 32-byte Ed25519 private key
 * encoded as base64url (the format the SDK's `generatePrivateKey()`
 * produces when round-tripped through `b64uEncode`). The function
 * derives the public key, canonicalizes the manifest, signs the
 * canonical bytes, and returns everything the publish request needs.
 *
 * Throws on:
 *   - private key the wrong length (not 32 bytes after decoding)
 *   - manifest contains floating-point numbers (JCS rejects them)
 */
export async function signManifest(
  manifest: unknown,
  privateKeyB64u: string,
): Promise<SignedPublish> {
  const privateKey = b64uDecode(privateKeyB64u.trim());
  if (privateKey.length !== 32) {
    throw new Error(
      `private key must decode to 32 bytes, got ${privateKey.length} — expected raw Ed25519 seed encoded as base64url`,
    );
  }
  const publicKey = await ed.getPublicKeyAsync(privateKey);

  const text = canonicalize(manifest);
  if (text === undefined) {
    throw new Error("manifest could not be canonicalized — likely contains an unsupported value");
  }
  const bytes = new TextEncoder().encode(text);
  rejectFloats(manifest);

  const sig = await ed.signAsync(bytes, privateKey);

  return {
    body: text,
    pubkey: b64uEncode(publicKey),
    signature: b64uEncode(sig),
  };
}

function rejectFloats(value: unknown, path: string[] = []): void {
  if (value === null || value === undefined) return;
  const t = typeof value;
  if (t === "number") {
    if (!Number.isInteger(value)) {
      const at = path.length > 0 ? ` at ${path.join(".")}` : "";
      throw new TypeError(
        `float values are not permitted in AAP manifests${at}; encode decimals as strings`,
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

export function b64uEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uDecode(value: string): Uint8Array {
  const pad = "=".repeat((4 - (value.length % 4)) % 4);
  const normalized = (value + pad).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
