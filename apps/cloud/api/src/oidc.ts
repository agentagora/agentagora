/**
 * OIDC-style identity certificate issuance.
 *
 * Issues short-lived EdDSA JWTs binding an AID to an owner + their
 * manifest signing key. Verification side lives in the SDK (and any
 * third party) using the JWKS published at /.well-known/jwks.json.
 *
 * Single active key for now; rotation would store multiple
 * (kid → privateKey) pairs in KV and pick the newest at issue time
 * while keeping older public keys live in JWKS until expiry.
 */

import type { Manifest } from "@agentagora/protocol";
import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import { b64uDecode } from "./_crypto.js";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

export interface OidcIssuerOptions {
  /** Raw 32-byte Ed25519 private key. */
  privateKey: Uint8Array;
  /** `iss` claim. Typically the Worker's public URL. */
  issuer: string;
  /** Default `aud`. AAP registry name. */
  audience?: string;
  /** Token lifetime in seconds. Default 3600 (1 hour). */
  ttlSeconds?: number;
  /** Override clock for deterministic tests. */
  now?: () => number;
}

export interface IssueOptions {
  manifest: Manifest;
  /** Owner ID resolved from the bearer token. */
  ownerId: string;
  /** base64url-encoded 32-byte Ed25519 public key bound to the AID. */
  publisherPubkey: string;
  /** Scopes granted to the bearer of this token. Defaults to ["agent:publish"]. */
  scopes?: string[];
}

export interface JwksKey {
  kty: "OKP";
  crv: "Ed25519";
  kid: string;
  alg: "EdDSA";
  use: "sig";
  /** base64url-encoded raw 32-byte Ed25519 public key. */
  x: string;
}

export interface JwksDocument {
  keys: JwksKey[];
}

const TEXT_ENCODER = new TextEncoder();

export class OidcIssuer {
  private readonly privateKey: Uint8Array;
  private readonly publicKey: Uint8Array;
  private readonly publicKeyB64u: string;
  /** Stable identifier for the active key, derived from SHA-256(pubkey). */
  readonly kid: string;
  readonly issuer: string;
  private readonly audience: string;
  private readonly ttlSeconds: number;
  private readonly now: () => number;

  private constructor(privateKey: Uint8Array, publicKey: Uint8Array, options: OidcIssuerOptions) {
    if (privateKey.length !== 32) {
      throw new Error("Ed25519 private key must be 32 bytes");
    }
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.publicKeyB64u = b64uEncode(publicKey);
    this.kid = b64uEncode(sha256(publicKey)).slice(0, 16);
    this.issuer = options.issuer.replace(/\/+$/, "");
    this.audience = options.audience ?? "agentagora";
    this.ttlSeconds = options.ttlSeconds ?? 3600;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  static async create(options: OidcIssuerOptions): Promise<OidcIssuer> {
    const publicKey = await ed.getPublicKeyAsync(options.privateKey);
    return new OidcIssuer(options.privateKey, publicKey, options);
  }

  /**
   * Sign and return a JWT compact-serialised identity certificate.
   * Claim shape mirrors @agentagora/protocol's IdentityCertificateClaimsSchema.
   */
  async issue(opts: IssueOptions): Promise<string> {
    const aid = opts.manifest.aid;
    const now = this.now();
    const claims = {
      iss: this.issuer,
      sub: aid,
      aud: this.audience,
      iat: now,
      exp: now + this.ttlSeconds,
      "aap.owner": opts.ownerId,
      "aap.scopes": opts.scopes ?? ["agent:publish"],
      "aap.pubkey": opts.publisherPubkey,
      "aap.manifest_url": `${this.issuer}/v1/agents/${encodeURIComponent(aid)}`,
      "aap.settlement": deriveSettlement(opts.manifest),
    };
    const header = { alg: "EdDSA", typ: "JWT", kid: this.kid };
    const headerSeg = b64uEncode(TEXT_ENCODER.encode(JSON.stringify(header)));
    const payloadSeg = b64uEncode(TEXT_ENCODER.encode(JSON.stringify(claims)));
    const signingInput = TEXT_ENCODER.encode(`${headerSeg}.${payloadSeg}`);
    const sig = await ed.signAsync(signingInput, this.privateKey);
    return `${headerSeg}.${payloadSeg}.${b64uEncode(sig)}`;
  }

  /** JWKS document advertising the currently active public key. */
  jwks(): JwksDocument {
    return {
      keys: [
        {
          kty: "OKP",
          crv: "Ed25519",
          kid: this.kid,
          alg: "EdDSA",
          use: "sig",
          x: this.publicKeyB64u,
        },
      ],
    };
  }

  /** For tests / external verifiers — exposed as raw bytes, not the JWKS encoding. */
  publicKeyBytes(): Uint8Array {
    return this.publicKey;
  }
}

/**
 * Build the `aap.settlement` claim from a manifest.
 *
 * v0 contract: union of every capability's accepted settlement
 * channels, with no per-channel metadata. The dashboard / disputes
 * layer can grow this into per-channel routing details later.
 */
function deriveSettlement(manifest: Manifest): Record<string, unknown> {
  const accepts = new Set<string>();
  for (const cap of manifest.capabilities) {
    for (const a of cap.accepts) accepts.add(a);
  }
  return { accepts: [...accepts] };
}

/** Local copy to avoid pulling _crypto's dynamic ed init twice. */
function b64uEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decode a base64url-encoded raw private key into bytes. Convenience
 * for parsing the OIDC_SIGNING_KEY env / secret value.
 */
export function decodePrivateKey(value: string): Uint8Array {
  const bytes = b64uDecode(value);
  if (bytes.length !== 32) {
    throw new Error(`OIDC signing key must be 32 raw bytes (got ${bytes.length})`);
  }
  return bytes;
}
