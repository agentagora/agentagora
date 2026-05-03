/**
 * Cloud-backed nonce tracker.
 *
 * Calls cloud-api's POST /v1/nonces/check to dedup envelopes across
 * Worker isolates and cold restarts — the in-process
 * InMemoryNonceTracker only catches replays within a single isolate.
 *
 * Failure semantics:
 *   - 200 → first sighting, return true
 *   - 409 → replay, return false
 *   - any other status / network error → fall back to the optional
 *     `fallback` tracker (defaults to InMemoryNonceTracker), so a
 *     transient cloud outage doesn't take agents offline. Operators
 *     who want fail-closed semantics can pass a fallback that always
 *     returns false on cloud errors.
 */

import type { RpcRequestEnvelope } from "@agentagora/protocol";
import { InMemoryNonceTracker, type NonceTracker } from "./agent.js";

export interface CloudNonceTrackerOptions {
  /** Base URL of the cloud-api Worker, e.g. https://cloud.agentagora.dev */
  cloudUrl: string;
  /**
   * Bearer token of the agent's owner. The cloud derives the owner
   * ID from this and prefixes every key, so two tenants can never
   * collide on each other's nonce namespace.
   */
  bearerToken: string;
  /** TTL the cloud applies to each reservation. Defaults to 600s. */
  ttlSeconds?: number;
  /**
   * Tracker consulted when the cloud is unreachable or returns an
   * unexpected status. Defaults to a fresh `InMemoryNonceTracker` so
   * agents stay available during outages. Inject a fail-closed
   * tracker (one that always returns false) if you'd rather drop
   * traffic than risk single-isolate replays.
   */
  fallback?: NonceTracker;
  /** Override `fetch` for tests. */
  fetchImpl?: typeof fetch;
}

export class CloudNonceTracker implements NonceTracker {
  private readonly cloudUrl: string;
  private readonly bearerToken: string;
  private readonly ttlSeconds: number;
  private readonly fallback: NonceTracker;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CloudNonceTrackerOptions) {
    this.cloudUrl = options.cloudUrl.replace(/\/+$/, "");
    this.bearerToken = options.bearerToken;
    this.ttlSeconds = options.ttlSeconds ?? 600;
    this.fallback = options.fallback ?? new InMemoryNonceTracker();
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async check(envelope: RpcRequestEnvelope, nowMs: number): Promise<boolean> {
    const key = nonceKey(envelope);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cloudUrl}/v1/nonces/check`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.bearerToken}`,
        },
        body: JSON.stringify({ key, ttl_seconds: this.ttlSeconds }),
      });
    } catch (err) {
      // Network blip — fall back. Logged at warn so it shows up
      // even when callers swallow errors.
      console.warn("[CloudNonceTracker] cloud unreachable, falling back", err);
      return this.fallback.check(envelope, nowMs);
    }

    if (res.status === 200) return true;
    if (res.status === 409) return false;

    // Unexpected status — read the body for diagnostics, fall back.
    let body: string;
    try {
      body = await res.text();
    } catch {
      body = "<unreadable>";
    }
    console.warn(
      `[CloudNonceTracker] unexpected status ${res.status}, falling back. Body: ${body}`,
    );
    return this.fallback.check(envelope, nowMs);
  }
}

function nonceKey(envelope: RpcRequestEnvelope): string {
  return `${envelope.aap.conversation_id}\x00${envelope.aap.from}\x00${envelope.aap.nonce}`;
}
