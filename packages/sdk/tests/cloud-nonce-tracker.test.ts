/**
 * CloudNonceTracker tests.
 *
 * Verifies the three-state contract against a stub fetch:
 *   200 → first sighting, returns true
 *   409 → replay, returns false
 *   any other status / network error → falls back to the inner tracker
 *
 * The default fallback is an InMemoryNonceTracker, so an isolated
 * cloud outage degrades gracefully to the per-isolate behaviour the
 * SDK had before this opt-in landed.
 */

import type { RpcRequestEnvelope } from "@agentagora/protocol";
import { describe, expect, it } from "vitest";
import { InMemoryNonceTracker, type NonceTracker } from "../src/agent.js";
import { CloudNonceTracker } from "../src/cloud-nonce-tracker.js";

function envelope(nonce: string, conversationId = "convo-1"): RpcRequestEnvelope {
  return {
    aap: {
      version: "0.1.0",
      msg_id: "msg-1",
      conversation_id: conversationId,
      from: "aid:agentagora:alice/sender",
      to: "aid:agentagora:bob/receiver",
      timestamp: "2026-05-01T00:00:00.000Z",
      nonce,
      method: "rpc.call",
      capability: "x",
      signature: { alg: "EdDSA", key_id: "k1", value: "" },
    },
    payload: {},
  } as unknown as RpcRequestEnvelope;
}

interface StubResponseSpec {
  status: number;
  body?: string;
}

function stubFetch(specs: StubResponseSpec[]): {
  fn: typeof fetch;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const spec = specs[Math.min(i, specs.length - 1)];
    i++;
    return new Response(spec?.body ?? "", { status: spec?.status ?? 200 });
  }) as typeof fetch;
  return { fn, calls };
}

describe("CloudNonceTracker", () => {
  it("returns true on 200 and false on 409", async () => {
    const { fn, calls } = stubFetch([{ status: 200 }, { status: 409 }]);
    const tracker = new CloudNonceTracker({
      cloudUrl: "https://cloud.test",
      bearerToken: "tok-alice",
      fetchImpl: fn,
    });
    const env1 = envelope("n1");
    const env2 = envelope("n1"); // same nonce → cloud says replay

    expect(await tracker.check(env1, Date.now())).toBe(true);
    expect(await tracker.check(env2, Date.now())).toBe(false);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe("https://cloud.test/v1/nonces/check");
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe(
      "Bearer tok-alice",
    );
  });

  it("strips trailing slashes from cloudUrl", async () => {
    const { fn, calls } = stubFetch([{ status: 200 }]);
    const tracker = new CloudNonceTracker({
      cloudUrl: "https://cloud.test///",
      bearerToken: "tok",
      fetchImpl: fn,
    });
    await tracker.check(envelope("n"), Date.now());
    expect(calls[0]?.url).toBe("https://cloud.test/v1/nonces/check");
  });

  it("includes ttl_seconds and key in the body", async () => {
    const { fn, calls } = stubFetch([{ status: 200 }]);
    const tracker = new CloudNonceTracker({
      cloudUrl: "https://cloud.test",
      bearerToken: "tok",
      ttlSeconds: 1200,
      fetchImpl: fn,
    });
    await tracker.check(envelope("n42", "convo-99"), Date.now());
    const body = JSON.parse(calls[0]?.init.body as string) as {
      key: string;
      ttl_seconds: number;
    };
    expect(body.ttl_seconds).toBe(1200);
    expect(body.key).toContain("n42");
    expect(body.key).toContain("convo-99");
  });

  it("falls back to the inner tracker on a 5xx response", async () => {
    const { fn } = stubFetch([{ status: 503, body: "{}" }]);
    const fallback = new InMemoryNonceTracker();
    const tracker = new CloudNonceTracker({
      cloudUrl: "https://cloud.test",
      bearerToken: "tok",
      fallback,
      fetchImpl: fn,
    });
    // First call: cloud 503 → fallback returns true (fresh tracker).
    expect(await tracker.check(envelope("n"), Date.now())).toBe(true);
    // Second call: cloud 503 again → fallback now sees the nonce.
    const { fn: fn2 } = stubFetch([{ status: 503 }]);
    const tracker2 = new CloudNonceTracker({
      cloudUrl: "https://cloud.test",
      bearerToken: "tok",
      fallback,
      fetchImpl: fn2,
    });
    expect(await tracker2.check(envelope("n"), Date.now())).toBe(false);
  });

  it("falls back when fetch throws (network error)", async () => {
    const failing = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    let fallbackCalled = false;
    const fallback: NonceTracker = {
      async check() {
        fallbackCalled = true;
        return true;
      },
    };
    const tracker = new CloudNonceTracker({
      cloudUrl: "https://cloud.test",
      bearerToken: "tok",
      fallback,
      fetchImpl: failing,
    });
    expect(await tracker.check(envelope("n"), Date.now())).toBe(true);
    expect(fallbackCalled).toBe(true);
  });

  it("default fallback is a fresh InMemoryNonceTracker", async () => {
    // Confirms that omitting fallback in options doesn't crash and
    // that the cloud outage path still resolves.
    const { fn } = stubFetch([{ status: 502 }, { status: 502 }]);
    const tracker = new CloudNonceTracker({
      cloudUrl: "https://cloud.test",
      bearerToken: "tok",
      fetchImpl: fn,
    });
    expect(await tracker.check(envelope("n"), Date.now())).toBe(true);
    expect(await tracker.check(envelope("n"), Date.now())).toBe(false);
  });
});
