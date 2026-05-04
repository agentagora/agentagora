/**
 * Request-ID correlation tests.
 *
 * Covers the cloud-api-wide `X-Request-Id` middleware:
 *   1. Every response (happy + error + 404) carries the header.
 *   2. Inbound `X-Request-Id` is preserved when well-formed; replaced
 *      with a freshly minted id when malformed.
 *   3. The 500 path returns the same id in the response body and the
 *      response header (so operators can grep `wrangler tail` for one
 *      string and find both the log line and the client-side error).
 */

import { describe, expect, it, vi } from "vitest";
import { REQUEST_ID_PREFIX } from "../src/_request-id.js";
import { StaticOwnerAuth } from "../src/auth.js";
import { createApi } from "../src/index.js";
import { InMemoryStorage, type Storage } from "../src/storage.js";
import { MockStripeApiClient } from "./_mock-stripe.js";

const MINTED_ID_RE = /^req_[A-Za-z0-9_-]{20,30}$/;

function setup(overrides: { storage?: Storage } = {}) {
  const storage = overrides.storage ?? new InMemoryStorage();
  const ownerAuth = new StaticOwnerAuth({ "tok-alice": "alice" });
  const stripe = new MockStripeApiClient();
  return createApi({ storage, ownerAuth, stripe });
}

describe("X-Request-Id middleware", () => {
  it("sets X-Request-Id on /healthz", async () => {
    const app = setup();
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const id = res.headers.get("x-request-id");
    expect(id).toMatch(MINTED_ID_RE);
    expect(id?.startsWith(REQUEST_ID_PREFIX)).toBe(true);
  });

  it("sets X-Request-Id on GET /v1/agents", async () => {
    const app = setup();
    const res = await app.request("/v1/agents");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toMatch(MINTED_ID_RE);
  });

  it("sets X-Request-Id on the 404 branch and includes it in the body", async () => {
    const app = setup();
    const res = await app.request("/v1/this-does-not-exist");
    expect(res.status).toBe(404);
    const headerId = res.headers.get("x-request-id");
    expect(headerId).toMatch(MINTED_ID_RE);
    const body = (await res.json()) as { error: string; path: string; request_id: string };
    expect(body.error).toBe("not_found");
    expect(body.path).toBe("/v1/this-does-not-exist");
    expect(body.request_id).toBe(headerId);
  });

  it("sets X-Request-Id on a bearer-authed 401 (GET /v1/connect/account)", async () => {
    const app = setup();
    // No Authorization header — connect.ts returns 401 unauthorized,
    // which exercises the bearer-gated path before storage is touched.
    const res = await app.request("/v1/connect/account");
    expect(res.status).toBe(401);
    expect(res.headers.get("x-request-id")).toMatch(MINTED_ID_RE);
  });

  it("preserves a well-formed inbound X-Request-Id", async () => {
    const app = setup();
    const inbound = "req_upstream_correlation_42";
    const res = await app.request("/healthz", {
      headers: { "x-request-id": inbound },
    });
    expect(res.headers.get("x-request-id")).toBe(inbound);
  });

  it("preserves a generic LB-style X-Request-Id (alphanumeric, 16 chars)", async () => {
    const app = setup();
    const inbound = "abcdef0123456789";
    const res = await app.request("/healthz", {
      headers: { "x-request-id": inbound },
    });
    expect(res.headers.get("x-request-id")).toBe(inbound);
  });

  it("mints a fresh id when the inbound X-Request-Id is malformed (too short)", async () => {
    const app = setup();
    const res = await app.request("/healthz", {
      headers: { "x-request-id": "short" },
    });
    const out = res.headers.get("x-request-id");
    expect(out).not.toBe("short");
    expect(out).toMatch(MINTED_ID_RE);
  });

  it("mints a fresh id when the inbound X-Request-Id contains illegal characters", async () => {
    const app = setup();
    const res = await app.request("/healthz", {
      headers: { "x-request-id": "abc def ghi 12345" }, // spaces banned by the regex
    });
    const out = res.headers.get("x-request-id");
    expect(out).not.toBe("abc def ghi 12345");
    expect(out).toMatch(MINTED_ID_RE);
  });

  it("mints a fresh id when the inbound X-Request-Id is too long (>64 chars)", async () => {
    const app = setup();
    const inbound = "a".repeat(65);
    const res = await app.request("/healthz", {
      headers: { "x-request-id": inbound },
    });
    const out = res.headers.get("x-request-id");
    expect(out).not.toBe(inbound);
    expect(out).toMatch(MINTED_ID_RE);
  });

  it("the 500 path returns the same id in the response body and the X-Request-Id header", async () => {
    // Inject a Storage whose `listAgents` throws so GET /v1/agents
    // surfaces through `app.onError`. Everything else is a passthrough
    // to the real InMemoryStorage so the rest of the wiring is normal.
    const real = new InMemoryStorage();
    const throwing: Storage = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === "listAgents") {
          return async () => {
            throw new Error("forced failure for request-id correlation test");
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const app = setup({ storage: throwing });

    // Silence the expected console.error — we still want to assert
    // the format of what got logged though.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await app.request("/v1/agents");
      expect(res.status).toBe(500);
      const headerId = res.headers.get("x-request-id");
      expect(headerId).toMatch(MINTED_ID_RE);
      const body = (await res.json()) as { error: string; request_id: string; message?: string };
      expect(body.error).toBe("internal");
      expect(body.request_id).toBe(headerId);
      // §L1: the body MUST NOT echo the underlying error message.
      expect(body.message).toBeUndefined();
      // The log line MUST include `[req=<id>]` so operators can grep
      // for the same id the client received.
      expect(errSpy).toHaveBeenCalled();
      const firstCall = errSpy.mock.calls[0]?.[0];
      expect(typeof firstCall).toBe("string");
      expect(firstCall as string).toContain(`[req=${headerId}]`);
    } finally {
      errSpy.mockRestore();
    }
  });
});
