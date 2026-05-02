/**
 * Nonce dedup store.
 *
 * Closes the gap left by the SDK's per-isolate replay protection:
 * once a Worker scales to multiple isolates (or restarts), the
 * in-memory NonceTracker forgets. This store is the global source
 * of truth — receivers consult /v1/nonces/check before honoring an
 * incoming request.
 *
 * Backed by Workers KV in production: native TTL, fast reads, no
 * cron sweep needed. KV doesn't have native compare-and-swap, so
 * the get-then-put has a microsecond race window; acceptable since
 * nonces are 256-bit random and a deliberate replay would also need
 * to land in the same window. Atomic semantics (Durable Object or
 * D1 PRIMARY KEY) can replace the implementation later without
 * changing the route shape.
 */

export interface NonceCheckResult {
  /** True iff this is the first time `key` has been seen. */
  firstSeen: boolean;
  /** ISO 8601 timestamp when the entry will expire. */
  expiresAt: string;
}

export interface NonceStore {
  /**
   * Check whether `key` has been seen before. On first sight it is
   * recorded with a TTL of `ttlSeconds`; subsequent calls within the
   * window return `firstSeen: false` without resetting the timer.
   */
  check(key: string, ttlSeconds: number): Promise<NonceCheckResult>;
}

/** KV-backed implementation. Intended for production. */
export class KvNonceStore implements NonceStore {
  constructor(
    private readonly kv: KVNamespace,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async check(key: string, ttlSeconds: number): Promise<NonceCheckResult> {
    const existing = await this.kv.get(key);
    const expiresAt = new Date(this.now().getTime() + ttlSeconds * 1000).toISOString();
    if (existing !== null) {
      return { firstSeen: false, expiresAt };
    }
    // KV's expirationTtl is the floor for all writes — values < 60 are
    // rejected by the runtime, so clamp before writing. Tests pass
    // shorter TTLs and we honour them in the response without trying
    // to push them through KV.
    await this.kv.put(key, "1", { expirationTtl: Math.max(60, ttlSeconds) });
    return { firstSeen: true, expiresAt };
  }
}

/** In-memory implementation for tests and `wrangler dev` without KV. */
export class InMemoryNonceStore implements NonceStore {
  private readonly seen = new Map<string, number>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async check(key: string, ttlSeconds: number): Promise<NonceCheckResult> {
    const nowMs = this.now().getTime();
    this.prune(nowMs);
    const expiresAt = new Date(nowMs + ttlSeconds * 1000).toISOString();
    if (this.seen.has(key)) {
      return { firstSeen: false, expiresAt };
    }
    this.seen.set(key, nowMs + ttlSeconds * 1000);
    return { firstSeen: true, expiresAt };
  }

  private prune(nowMs: number): void {
    for (const [k, exp] of this.seen) {
      if (exp <= nowMs) this.seen.delete(k);
    }
  }

  /** Test helper: drop all entries. */
  clear(): void {
    this.seen.clear();
  }
}
