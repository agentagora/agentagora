/**
 * Cloud connectivity — the connective tissue between a local agent and
 * an AAP registry/control plane (AgentAgora Cloud or any self-hosted
 * implementation of the same API surface).
 *
 * Three pieces, all optional (the SDK works fully offline without them):
 *
 *   - `HttpRegistry`   — resolve an AID to {pubkey, endpoint, manifest}
 *                        via GET /v1/agents/:aid, verifying the identity
 *                        certificate (EdDSA JWT) against the registry's
 *                        /.well-known/jwks.json. Implements BOTH
 *                        `RegistryResolver` and `EndpointResolver`, so one
 *                        instance wires signature verification and HTTP
 *                        addressing at once.
 *   - `publishAgent`   — sign a manifest (JCS canonical bytes, detached
 *                        Ed25519) and POST it to /v1/agents.
 *   - `CloudAuditSink` — incrementally push a local `AuditLog` to
 *                        POST /v1/audit/ingest so the owner's dashboard
 *                        can show what the agent did.
 *
 * Web-standards only: fetch + @noble crypto, no Node-specific APIs.
 */

import type { Manifest } from "@agentagora/protocol";
import * as ed from "@noble/ed25519";
import type { AuditLog } from "./audit.js";
import { canonicalizeForSigning } from "./canonical.js";
import type { RegistryResolver } from "./registry.js";
import { b64uDecode, b64uEncode } from "./signing.js";
import type { EndpointResolver } from "./transport.js";

const TEXT_DECODER = new TextDecoder();

// ---------------------------------------------------------------------------
// HttpRegistry
// ---------------------------------------------------------------------------

/** What a registry lookup resolves to. */
export interface ResolvedAgent {
  readonly aid: string;
  /** Raw 32-byte Ed25519 signing key, extracted from the verified identity certificate. */
  readonly pubkey: Uint8Array;
  /** The agent's RPC endpoint (`manifest.endpoints.rpc`). */
  readonly endpoint: string;
  readonly manifest: Manifest;
}

export interface HttpRegistryOptions {
  /** Registry base URL, e.g. "https://api.agentagora.dev" or "http://localhost:8787". */
  baseUrl: string;
  /** Optional fetch override for tests. Defaults to global fetch. */
  fetch?: typeof fetch;
  /** How long a resolved agent stays cached. Default 5 minutes. */
  cacheTtlMs?: number;
  /**
   * Reject identity certificates past their `exp`. Defaults to TRUE: the
   * reference registry reissues a fresh certificate on every read, so a
   * conforming registry always serves a currently-valid attestation of the
   * pubkey↔AID binding. Set false only against a legacy registry that
   * still serves publish-time certificates (signature checks still apply;
   * you merely lose freshness).
   */
  rejectExpired?: boolean;
}

interface JwksKey {
  kty: string;
  crv?: string;
  kid?: string;
  x?: string;
}

interface CacheEntry {
  resolved: ResolvedAgent;
  expiresAt: number;
}

/**
 * Registry-backed resolver (the "HttpRegistry" long promised by
 * registry.ts). Trust model: the registry's JWKS anchors trust — we verify
 * the identity certificate's EdDSA signature against it and extract
 * `aap.pubkey`, rather than trusting a raw pubkey field on the response.
 */
export class HttpRegistry implements RegistryResolver, EndpointResolver {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cacheTtlMs: number;
  private readonly rejectExpired: boolean;
  private readonly cache = new Map<string, CacheEntry>();
  private jwksCache: JwksKey[] | undefined;

  constructor(options: HttpRegistryOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? fetch;
    this.cacheTtlMs = options.cacheTtlMs ?? 300_000;
    this.rejectExpired = options.rejectExpired ?? true;
  }

  async resolveAgent(aid: string): Promise<ResolvedAgent> {
    const hit = this.cache.get(aid);
    if (hit && hit.expiresAt > Date.now()) return hit.resolved;

    const res = await this.fetchImpl(`${this.baseUrl}/v1/agents/${encodeURIComponent(aid)}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`HttpRegistry: GET /v1/agents/${aid} → HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      aid?: string;
      manifest?: Manifest;
      identity_jwt?: string;
    };
    if (!body.manifest || !body.identity_jwt) {
      throw new Error(`HttpRegistry: registry response for ${aid} lacks manifest/identity_jwt`);
    }

    const pubkey = await this.verifyIdentityCertificate(aid, body.identity_jwt);
    const endpoint = body.manifest.endpoints?.rpc;
    if (!endpoint) {
      throw new Error(`HttpRegistry: manifest for ${aid} declares no endpoints.rpc`);
    }

    const resolved: ResolvedAgent = { aid, pubkey, endpoint, manifest: body.manifest };
    this.cache.set(aid, { resolved, expiresAt: Date.now() + this.cacheTtlMs });
    return resolved;
  }

  /** `RegistryResolver` — pubkey for envelope signature verification. */
  async resolvePublicKey(aid: string): Promise<Uint8Array> {
    return (await this.resolveAgent(aid)).pubkey;
  }

  /** `EndpointResolver` — where HttpTransport addresses the call. */
  async resolveEndpoint(aid: string): Promise<string> {
    return (await this.resolveAgent(aid)).endpoint;
  }

  /** Drop all cached resolutions (e.g. after a counterparty key rotation). */
  invalidate(aid?: string): void {
    if (aid === undefined) this.cache.clear();
    else this.cache.delete(aid);
  }

  /**
   * Verify the registry-issued identity certificate (compact EdDSA JWT)
   * against the registry's JWKS and return the agent's signing pubkey
   * from the `aap.pubkey` claim.
   */
  private async verifyIdentityCertificate(aid: string, jwt: string): Promise<Uint8Array> {
    const segments = jwt.split(".");
    if (segments.length !== 3) {
      throw new Error(`HttpRegistry: identity certificate for ${aid} is not a compact JWT`);
    }
    const [headerSeg, payloadSeg, sigSeg] = segments as [string, string, string];

    const header = JSON.parse(TEXT_DECODER.decode(b64uDecode(headerSeg))) as {
      alg?: string;
      kid?: string;
    };
    if (header.alg !== "EdDSA") {
      throw new Error(`HttpRegistry: unsupported identity certificate alg ${header.alg}`);
    }

    const jwks = await this.loadJwks();
    const key = jwks.find(
      (k) =>
        k.kty === "OKP" &&
        k.crv === "Ed25519" &&
        (header.kid === undefined || k.kid === header.kid),
    );
    if (!key?.x) {
      throw new Error(`HttpRegistry: no JWKS key matches kid ${header.kid ?? "(none)"}`);
    }

    const signingInput = new TextEncoder().encode(`${headerSeg}.${payloadSeg}`);
    const valid = await ed.verifyAsync(b64uDecode(sigSeg), signingInput, b64uDecode(key.x));
    if (!valid) {
      throw new Error(`HttpRegistry: identity certificate signature for ${aid} is invalid`);
    }

    const claims = JSON.parse(TEXT_DECODER.decode(b64uDecode(payloadSeg))) as {
      sub?: string;
      exp?: number;
      "aap.pubkey"?: string;
    };
    if (claims.sub !== aid) {
      throw new Error(
        `HttpRegistry: identity certificate subject ${claims.sub} does not match ${aid}`,
      );
    }
    if (this.rejectExpired && typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) {
      throw new Error(`HttpRegistry: identity certificate for ${aid} is expired`);
    }
    const pubkeyB64u = claims["aap.pubkey"];
    if (!pubkeyB64u) {
      throw new Error(`HttpRegistry: identity certificate for ${aid} lacks aap.pubkey`);
    }
    const pubkey = b64uDecode(pubkeyB64u);
    if (pubkey.length !== 32) {
      throw new Error(`HttpRegistry: aap.pubkey for ${aid} is not a 32-byte Ed25519 key`);
    }
    return pubkey;
  }

  private async loadJwks(): Promise<JwksKey[]> {
    if (this.jwksCache) return this.jwksCache;
    const res = await this.fetchImpl(`${this.baseUrl}/.well-known/jwks.json`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`HttpRegistry: GET /.well-known/jwks.json → HTTP ${res.status}`);
    }
    const doc = (await res.json()) as { keys?: JwksKey[] };
    if (!Array.isArray(doc.keys) || doc.keys.length === 0) {
      throw new Error("HttpRegistry: registry JWKS is empty");
    }
    this.jwksCache = doc.keys;
    return doc.keys;
  }
}

// ---------------------------------------------------------------------------
// publishAgent
// ---------------------------------------------------------------------------

export interface PublishAgentOptions {
  /** Registry base URL. */
  baseUrl: string;
  /** The manifest to publish. Signed as the exact JSON posted (JCS canonical bytes). */
  manifest: Manifest;
  /** Owner bearer token (`AGENTAGORA_TOKEN`). */
  ownerToken: string;
  /**
   * The agent's Ed25519 signing key. The registry TOFU-pins the derived
   * pubkey to the AID on first publish — keep this key stable across
   * republished versions or the registry will reject the update.
   */
  privateKey: Uint8Array;
  /** Optional fetch override for tests. */
  fetch?: typeof fetch;
}

export interface PublishAgentResult {
  aid: string;
  identity_jwt: string;
  published_at: string;
  published_by: string;
  pubkey: string;
}

/**
 * Sign and publish a manifest to the registry (POST /v1/agents).
 * Signature is detached Ed25519 over the RFC 8785 canonical bytes of the
 * posted JSON — the server canonicalizes the same value before verifying.
 */
export async function publishAgent(options: PublishAgentOptions): Promise<PublishAgentResult> {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  const canonical = canonicalizeForSigning(options.manifest);
  const [pubkey, signature] = await Promise.all([
    ed.getPublicKeyAsync(options.privateKey),
    ed.signAsync(canonical, options.privateKey),
  ]);

  const res = await fetchImpl(`${baseUrl}/v1/agents`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${options.ownerToken}`,
      "x-aap-pubkey": b64uEncode(pubkey),
      "x-aap-signature": b64uEncode(signature),
    },
    body: JSON.stringify(options.manifest),
  });

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const detail = body ? ` — ${body.error}: ${body.message}` : "";
    throw new Error(`publishAgent: POST /v1/agents → HTTP ${res.status}${detail}`);
  }
  return body as unknown as PublishAgentResult;
}

// ---------------------------------------------------------------------------
// CloudAuditSink
// ---------------------------------------------------------------------------

export interface CloudAuditSinkOptions {
  /** Control-plane base URL. */
  baseUrl: string;
  /** Optional fetch override for tests. */
  fetch?: typeof fetch;
}

/**
 * Incrementally pushes local audit chains to POST /v1/audit/ingest.
 *
 * The server enforces per-event actor signatures (that IS the auth — no
 * bearer needed) and hash-chain linkage, so the sink tracks a per-log
 * cursor and only ever sends events it has not successfully pushed yet.
 * The actor's AID must have a published manifest (pinned pubkey) or the
 * server rejects the events as `unknown_actor`.
 */
export class CloudAuditSink {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  /** conversation_id → number of events already ingested by the server. */
  private readonly cursors = new Map<string, number>();

  constructor(options: CloudAuditSinkOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  /**
   * Push all not-yet-synced events of `log`. Returns how many were
   * ingested this call. Throws (without advancing the cursor past the
   * failure) if the server rejects an event, so a retry resumes cleanly.
   */
  async sync(log: AuditLog): Promise<{ pushed: number }> {
    const cursor = this.cursors.get(log.conversationId) ?? 0;
    const pending = log.events.slice(cursor);
    if (pending.length === 0) return { pushed: 0 };

    const res = await this.fetchImpl(`${this.baseUrl}/v1/audit/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ events: pending }),
    });
    const body = (await res.json().catch(() => null)) as {
      ingested?: unknown[];
      rejected?: Array<{ event_id: string; error: string; message: string }>;
    } | null;

    if (!res.ok && res.status !== 207) {
      throw new Error(`CloudAuditSink: POST /v1/audit/ingest → HTTP ${res.status}`);
    }
    const ingested = body?.ingested?.length ?? 0;
    this.cursors.set(log.conversationId, cursor + ingested);

    const rejected = body?.rejected ?? [];
    if (rejected.length > 0) {
      const first = rejected[0];
      throw new Error(
        `CloudAuditSink: ${rejected.length} event(s) rejected — first: ${first?.error} (${first?.message})`,
      );
    }
    return { pushed: ingested };
  }
}
