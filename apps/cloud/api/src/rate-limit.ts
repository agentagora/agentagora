import type { Context } from "hono";

/**
 * Per-owner rate limiting for write endpoints.
 *
 * Fixed-window counter: every (owner, route, minute) tuple has a cap;
 * the 61st request of a minute returns 429 with a Retry-After header.
 * Burst at the second-edge is a known artefact of fixed-window — fine
 * for closed alpha, swap for sliding-window or token-bucket later.
 *
 * Backed by Workers KV in production (cross-isolate counters with
 * native TTL); falls back to a per-isolate Map for tests / dev. KV
 * has a 1-write-per-second-per-key floor — at sustained sub-cap
 * traffic the counter writes once per request, well under the floor;
 * above-cap traffic returns 429 without writing, so the floor doesn't
 * become a leak.
 */

export interface RateLimitDecision {
  /** True when the call is allowed. */
  ok: boolean;
  /** Seconds until the next minute window opens (only meaningful when !ok). */
  retryAfterSeconds: number;
  /** Cap configured for this bucket. */
  cap: number;
  /** Count after this call would have been added (whether allowed or not). */
  count: number;
}

export interface RateLimiter {
  /** Atomically increment the bucket and report whether it stays under cap. */
  consume(bucket: string, capPerMinute: number): Promise<RateLimitDecision>;
}

/**
 * KV-backed limiter. Keys are scoped per minute so they self-expire.
 * The get→put round-trip has the same race window as KvNonceStore;
 * acceptable since over-counting at most by a few requests during a
 * burst is not a security problem.
 */
export class KvRateLimiter implements RateLimiter {
  constructor(
    private readonly kv: KVNamespace,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async consume(bucket: string, cap: number): Promise<RateLimitDecision> {
    const nowMs = this.now().getTime();
    const minute = Math.floor(nowMs / 60_000);
    const key = `rate/${bucket}/${minute}`;

    const raw = await this.kv.get(key);
    const current = raw ? Number.parseInt(raw, 10) || 0 : 0;
    const retry = retryAfterSeconds(nowMs);

    if (current >= cap) {
      return { ok: false, retryAfterSeconds: retry, cap, count: current };
    }
    await this.kv.put(key, String(current + 1), { expirationTtl: 120 });
    return { ok: true, retryAfterSeconds: 0, cap, count: current + 1 };
  }
}

/** Per-isolate limiter for tests / dev. Lossy across isolates. */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly counters = new Map<string, { minute: number; count: number }>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async consume(bucket: string, cap: number): Promise<RateLimitDecision> {
    const nowMs = this.now().getTime();
    const minute = Math.floor(nowMs / 60_000);
    const key = `${bucket}:${minute}`;
    const entry = this.counters.get(key);
    const retry = retryAfterSeconds(nowMs);

    if (!entry) {
      this.counters.set(key, { minute, count: 1 });
      return { ok: true, retryAfterSeconds: 0, cap, count: 1 };
    }
    if (entry.count >= cap) {
      return { ok: false, retryAfterSeconds: retry, cap, count: entry.count };
    }
    entry.count++;
    return { ok: true, retryAfterSeconds: 0, cap, count: entry.count };
  }

  /** Test helper. */
  clear(): void {
    this.counters.clear();
  }
}

function retryAfterSeconds(nowMs: number): number {
  // Seconds until the next minute boundary, rounded up to the next
  // whole second so Retry-After is HTTP-spec friendly.
  const ms = 60_000 - (nowMs % 60_000);
  return Math.max(1, Math.ceil(ms / 1000));
}

/**
 * Per-route caps (requests per minute per owner). Tunable by env in
 * a later iteration; closed-alpha defaults are picked to be generous
 * for the legitimate happy path and tight enough to spot abuse.
 */
export const DEFAULT_LIMITS = {
  /** Manifest publish — once per change, rare in practice. */
  publish: 30,
  /** Audit ingest — every conversation event flows through here. */
  audit: 600,
  /** Dispute filing — should be rare; cheap to file but heavy to adjudicate. */
  dispute: 5,
  /** Nonce check — every incoming call. Highest cap. */
  nonce: 6_000,
} as const;

export type RouteLimitName = keyof typeof DEFAULT_LIMITS;

/**
 * Apply a rate-limit check inside a route handler. Returns the
 * 429 Response when the bucket is exhausted, or null when the call
 * should proceed. The middleware sets Retry-After before returning.
 */
export async function enforceRateLimit(
  c: Context,
  limiter: RateLimiter,
  bucket: string,
  cap: number,
): Promise<Response | null> {
  const decision = await limiter.consume(bucket, cap);
  if (decision.ok) return null;
  c.header("Retry-After", String(decision.retryAfterSeconds));
  return c.json(
    {
      error: "rate_limited",
      message: `bucket "${bucket}" exceeded ${cap} requests/minute`,
      retry_after_seconds: decision.retryAfterSeconds,
    },
    429,
  );
}
