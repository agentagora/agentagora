/**
 * Test helper: produce a deterministic Ed25519 keypair and sign a
 * manifest the way a real publisher would. Mirrors the route's
 * canonicalization + verification, so a green test == green prod.
 */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { canonicalizeJsonBytes } from "../src/_crypto.js";

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
