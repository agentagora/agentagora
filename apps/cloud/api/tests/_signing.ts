/**
 * Test helper: produce a deterministic Ed25519 keypair and sign a
 * manifest the way a real publisher would. Mirrors the route's
 * canonicalization + verification, so a green test == green prod.
 */

import type { AuditEvent } from "@agentagora/protocol";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { canonicalizeJsonBytes, hashAuditEvent } from "../src/_crypto.js";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

function b64uEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface SigningKey {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  pubkeyB64u: string;
}

export async function generateSigningKey(seed?: number): Promise<SigningKey> {
  const privateKey =
    seed === undefined ? ed.utils.randomPrivateKey() : new Uint8Array(32).fill(seed % 256);
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return { privateKey, publicKey, pubkeyB64u: b64uEncode(publicKey) };
}

export async function signManifest(
  manifest: unknown,
  key: SigningKey,
): Promise<{ pubkey: string; signature: string }> {
  const canonical = canonicalizeJsonBytes(manifest);
  const sig = await ed.signAsync(canonical, key.privateKey);
  return { pubkey: key.pubkeyB64u, signature: b64uEncode(sig) };
}

export interface AuditEventDraft {
  event_id: string;
  conversation_id: string;
  type: string;
  timestamp: string;
  actor_aid: string;
  previous_event_hash: string | null;
  data?: Record<string, unknown>;
}

/**
 * Sign a draft into a complete AuditEvent. Mirrors the SDK's
 * sign-with-cleared-value pattern so chain hashes match.
 */
export async function signAuditEvent(
  draft: AuditEventDraft,
  key: SigningKey,
  keyId = "test-key-1",
): Promise<AuditEvent> {
  const event: AuditEvent = {
    ...draft,
    data: draft.data ?? {},
    signature: { alg: "EdDSA", key_id: keyId, value: "" },
  } as AuditEvent;
  const cloned = JSON.parse(JSON.stringify(event)) as AuditEvent;
  cloned.signature = { ...cloned.signature, value: "" };
  const bytes = canonicalizeJsonBytes(cloned);
  const sig = await ed.signAsync(bytes, key.privateKey);
  event.signature = { alg: "EdDSA", key_id: keyId, value: b64uEncode(sig) };
  return event;
}

/** Convenience: hash the previous event so the next one can chain. */
export function chainHash(event: AuditEvent): string {
  return hashAuditEvent(event);
}
