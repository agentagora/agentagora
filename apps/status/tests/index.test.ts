/**
 * Status worker tests.
 *
 * We exercise the pure `checkUpstream(url, fetchImpl)` helper with a
 * stubbed fetch so we can deterministically assert the threshold
 * behaviour, then sanity-check the `/` and `/status.json` routes via
 * Hono's in-process `app.request()`.
 */

import { describe, expect, it, vi } from "vitest";
import { type Env, checkUpstream, createApp } from "../src/index.js";

const URL = "https://example.test/healthz";

function ok(): Response {
  return new Response("ok", { status: 200 });
}

function serverError(): Response {
  return new Response("oops", { status: 500 });
}

describe("checkUpstream", () => {
  it("first attempt 200 -> operational, only one fetch", async () => {
    const fetchImpl = vi.fn(async () => ok());
    const report = await checkUpstream(URL, fetchImpl as unknown as typeof fetch);
    expect(report.status).toBe("operational");
    expect(report.service).toBe("agentagora-cloud-api");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(typeof report.latency_ms).toBe("number");
    expect(() => new Date(report.checked_at).toISOString()).not.toThrow();
  });

  it("HTTP 500 on both attempts -> degraded with message", async () => {
    const fetchImpl = vi.fn(async () => serverError());
    const report = await checkUpstream(URL, fetchImpl as unknown as typeof fetch);
    expect(report.status).toBe("degraded");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(report.message).toMatch(/500/);
  });

  it("network error on both attempts -> down", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("connection refused");
    });
    const report = await checkUpstream(URL, fetchImpl as unknown as typeof fetch);
    expect(report.status).toBe("down");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(report.message).toMatch(/connection refused/);
  });

  it("first attempt errors, second succeeds -> degraded recovered", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error("transient");
      return ok();
    });
    const report = await checkUpstream(URL, fetchImpl as unknown as typeof fetch);
    expect(report.status).toBe("degraded");
    expect(report.message).toBe("Recovered on retry");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("worker routes", () => {
  it("GET /status.json returns JSON shape", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ok()) as unknown as typeof fetch;
    try {
      const app = createApp();
      const env: Env = { UPSTREAM_HEALTHZ: URL };
      const res = await app.request("/status.json", {}, env);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") ?? "").toMatch(/application\/json/);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.status).toBe("operational");
      expect(body.service).toBe("agentagora-cloud-api");
      expect(typeof body.checked_at).toBe("string");
      expect(typeof body.latency_ms).toBe("number");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("GET / renders an HTML badge reflecting upstream state", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => serverError()) as unknown as typeof fetch;
    try {
      const app = createApp();
      const env: Env = { UPSTREAM_HEALTHZ: URL };
      const res = await app.request("/", {}, env);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") ?? "").toMatch(/text\/html/);
      const body = await res.text();
      expect(body).toContain("DEGRADED");
      expect(body).toContain("status.json");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
