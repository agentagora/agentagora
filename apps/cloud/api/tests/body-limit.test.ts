/**
 * §M11 body-limit middleware tests.
 *
 * Per-route bodyLimit caps in src/index.ts so a hostile / malformed
 * client can't burn CPU + memory parsing arbitrarily-large JSON.
 * Caps are generous vs typical payloads but small enough to be a
 * real ceiling. 413 envelope mirrors the cloud-api convention
 * `{ error: "payload_too_large", message }`.
 *
 * Each route is exercised twice:
 *   - body > limit → 413 payload_too_large
 *   - happy path still reaches the route handler (auth/validation
 *     errors are fine; we're proving the body-limit didn't swallow
 *     the request).
 */

import { describe, expect, it } from "vitest";
import { StaticOwnerAuth } from "../src/auth.js";
import { createApi } from "../src/index.js";
import { InMemoryStorage } from "../src/storage.js";

function setup() {
  const storage = new InMemoryStorage();
  const ownerAuth = new StaticOwnerAuth({ "tok-alice": "alice" });
  const app = createApi({ storage, ownerAuth });
  return { app };
}

/**
 * Build a JSON body whose serialized length is just above `limitBytes`.
 * Padding goes in an opaque string field — every route's validator
 * rejects unknown shapes, but body-limit fires first, so we never
 * reach validation.
 */
function oversizedBody(limitBytes: number): string {
  const padLen = limitBytes + 256;
  return JSON.stringify({ pad: "x".repeat(padLen) });
}

interface ErrorEnvelope {
  error: string;
  message?: string;
}

describe("§M11 body-limit — 413 payload_too_large", () => {
  it("/v1/audit/ingest rejects > 1024 KiB", async () => {
    const { app } = setup();
    const res = await app.request("/v1/audit/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer tok-alice",
      },
      body: oversizedBody(1024 * 1024),
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error).toBe("payload_too_large");
    expect(body.message).toMatch(/1024 KB/);
  });

  it("/v1/agents rejects > 64 KiB", async () => {
    const { app } = setup();
    const res = await app.request("/v1/agents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer tok-alice",
      },
      body: oversizedBody(64 * 1024),
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error).toBe("payload_too_large");
    expect(body.message).toMatch(/64 KB/);
  });

  it("/v1/disputes rejects > 16 KiB", async () => {
    const { app } = setup();
    const res = await app.request("/v1/disputes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer tok-alice",
      },
      body: oversizedBody(16 * 1024),
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error).toBe("payload_too_large");
    expect(body.message).toMatch(/16 KB/);
  });

  it("/v1/nonces/check rejects > 16 KiB", async () => {
    const { app } = setup();
    const res = await app.request("/v1/nonces/check", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer tok-alice",
      },
      body: oversizedBody(16 * 1024),
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error).toBe("payload_too_large");
  });
});

describe("§M11 body-limit — under-limit happy path reaches handler", () => {
  it("/v1/audit/ingest under-limit reaches handler (400 invalid shape, not 413)", async () => {
    const { app } = setup();
    const res = await app.request("/v1/audit/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer tok-alice",
      },
      body: JSON.stringify({ events: "not-an-array" }),
    });
    // Body fits → middleware passes → validator rejects with 4xx
    // that is NOT 413. The point is: the route handler ran.
    expect(res.status).not.toBe(413);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("/v1/agents under-limit reaches handler", async () => {
    const { app } = setup();
    const res = await app.request("/v1/agents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer tok-alice",
      },
      body: JSON.stringify({ shape: "obviously-invalid" }),
    });
    expect(res.status).not.toBe(413);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("/v1/disputes under-limit reaches handler", async () => {
    const { app } = setup();
    const res = await app.request("/v1/disputes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer tok-alice",
      },
      body: JSON.stringify({ shape: "obviously-invalid" }),
    });
    expect(res.status).not.toBe(413);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
