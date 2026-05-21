/**
 * buildApp(env) — production fail-closed checks.
 *
 * security-review-2026-05-07 §M7: when AAP_ENV="production", the
 * Worker MUST refuse to boot if NONCES or RATE_LIMITS KV bindings
 * are missing — without them, replay protection + rate counters
 * silently degrade to per-isolate, which is broken under Workers'
 * rolling-isolate model. Dev / test mode (AAP_ENV unset or any
 * other value) MUST fall back to in-memory stores.
 *
 * These tests exercise the env-adapter layer that wraps createApi,
 * which is otherwise only reachable through the default fetch
 * handler (and its module-level cache).
 */

import { describe, expect, it } from "vitest";
import { type Env, buildApp } from "../src/index.js";

const emptyKv = {} as unknown as KVNamespace;

describe("buildApp — AAP_ENV=production fail-closed (§M7)", () => {
  it("throws when NONCES is missing", async () => {
    const env: Env = { AAP_ENV: "production", RATE_LIMITS: emptyKv };
    await expect(buildApp(env)).rejects.toThrow(/NONCES KV namespace not bound in production/);
  });

  it("throws when RATE_LIMITS is missing", async () => {
    const env: Env = { AAP_ENV: "production", NONCES: emptyKv };
    await expect(buildApp(env)).rejects.toThrow(/RATE_LIMITS KV namespace not bound in production/);
  });

  it("throws when both bindings are missing", async () => {
    const env: Env = { AAP_ENV: "production" };
    // NONCES is checked first, so that's the error surfaced.
    await expect(buildApp(env)).rejects.toThrow(/NONCES KV namespace not bound in production/);
  });

  it("boots cleanly with both bindings present", async () => {
    const env: Env = {
      AAP_ENV: "production",
      NONCES: emptyKv,
      RATE_LIMITS: emptyKv,
    };
    const app = await buildApp(env);
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
  });
});

describe("buildApp — non-production accepts in-memory fallback", () => {
  it("boots with no env at all (dev default)", async () => {
    const app = await buildApp({});
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
  });

  it("boots when AAP_ENV is some non-production value", async () => {
    const app = await buildApp({ AAP_ENV: "staging" });
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
  });

  it("boots when AAP_ENV is unset even with no KV bindings", async () => {
    // This is the test/dev shape — explicit confirmation that the
    // §M7 fail-closed only fires when AAP_ENV is literally "production".
    const app = await buildApp({});
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
  });
});
