/**
 * Nonce dedup tests.
 *
 *   POST /v1/nonces/check  →  200 first-seen, 409 replay
 *
 * Both layers are covered:
 *   - Direct InMemoryNonceStore behaviour (TTL pruning, idempotent
 *     check on duplicate).
 *   - HTTP surface — bearer auth, owner-prefixed key isolation,
 *     body validation, replay 409.
 */

import { describe, expect, it } from "vitest";
import { StaticOwnerAuth } from "../src/auth.js";
import { createApi } from "../src/index.js";
import { InMemoryNonceStore } from "../src/nonces.js";

function setup() {
  const ownerAuth = new StaticOwnerAuth({ "tok-alice": "alice", "tok-bob": "bob" });
  const nonceStore = new InMemoryNonceStore();
  const app = createApi({ ownerAuth, nonceStore });
  return { app, nonceStore };
}

interface CheckBody {
  key: string;
  ttl_seconds?: number;
}

interface CheckOptions {
  token?: string | null;
}

async function check(
  app: ReturnType<typeof createApi>,
  body: CheckBody,
  options: CheckOptions = {},
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = options.token === undefined ? "tok-alice" : options.token;
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return app.request("/v1/nonces/check", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("InMemoryNonceStore", () => {
  it("first-seen returns true, second returns false", async () => {
    const store = new InMemoryNonceStore();
    const a = await store.check("k1", 600);
    expect(a.firstSeen).toBe(true);
    const b = await store.check("k1", 600);
    expect(b.firstSeen).toBe(false);
  });

  it("isolates entries that have expired", async () => {
    let nowMs = 1_700_000_000_000;
    const store = new InMemoryNonceStore(() => new Date(nowMs));
    const first = await store.check("k1", 60);
    expect(first.firstSeen).toBe(true);

    nowMs += 61_000;
    const second = await store.check("k1", 60);
    expect(second.firstSeen).toBe(true);
  });

  it("expires_at reflects ttl_seconds from now", async () => {
    const fixed = new Date("2026-05-01T00:00:00.000Z");
    const store = new InMemoryNonceStore(() => fixed);
    const result = await store.check("k1", 600);
    expect(result.expiresAt).toBe("2026-05-01T00:10:00.000Z");
  });

  it("clear() drops all entries", async () => {
    const store = new InMemoryNonceStore();
    await store.check("k1", 600);
    store.clear();
    const after = await store.check("k1", 600);
    expect(after.firstSeen).toBe(true);
  });
});

describe("POST /v1/nonces/check — happy path", () => {
  it("returns 200 + first_seen on the first sighting", async () => {
    const { app } = setup();
    const res = await check(app, { key: "abc" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { first_seen: boolean; expires_at: string };
    expect(body.first_seen).toBe(true);
    expect(body.expires_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("returns 409 + first_seen=false on a replay", async () => {
    const { app } = setup();
    await check(app, { key: "abc" });
    const second = await check(app, { key: "abc" });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { first_seen: boolean };
    expect(body.first_seen).toBe(false);
  });

  it("scopes keys per owner — same key from two owners both first-seen", async () => {
    const { app } = setup();
    const a = await check(app, { key: "shared" }, { token: "tok-alice" });
    const b = await check(app, { key: "shared" }, { token: "tok-bob" });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });

  it("honours an explicit ttl_seconds within bounds", async () => {
    const { app } = setup();
    const res = await check(app, { key: "k", ttl_seconds: 90 });
    expect(res.status).toBe(200);
  });
});

describe("POST /v1/nonces/check — rejection paths", () => {
  it("401 on missing bearer", async () => {
    const { app } = setup();
    const res = await check(app, { key: "abc" }, { token: null });
    expect(res.status).toBe(401);
  });

  it("401 on unknown bearer", async () => {
    const { app } = setup();
    const res = await check(app, { key: "abc" }, { token: "tok-nope" });
    expect(res.status).toBe(401);
  });

  it("400 on missing key", async () => {
    const { app } = setup();
    const res = await app.request("/v1/nonces/check", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer tok-alice",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { field: string };
    expect(body.field).toBe("key");
  });

  it("400 on key longer than 256 chars", async () => {
    const { app } = setup();
    const res = await check(app, { key: "x".repeat(257) });
    expect(res.status).toBe(400);
  });

  it("400 on ttl_seconds below 60", async () => {
    const { app } = setup();
    const res = await check(app, { key: "k", ttl_seconds: 30 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { field: string };
    expect(body.field).toBe("ttl_seconds");
  });

  it("400 on ttl_seconds above 24h", async () => {
    const { app } = setup();
    const res = await check(app, { key: "k", ttl_seconds: 24 * 3600 + 1 });
    expect(res.status).toBe(400);
  });

  it("400 on non-integer ttl_seconds", async () => {
    const { app } = setup();
    const res = await check(app, { key: "k", ttl_seconds: 60.5 });
    expect(res.status).toBe(400);
  });

  it("400 on non-object body", async () => {
    const { app } = setup();
    const res = await app.request("/v1/nonces/check", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer tok-alice",
      },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });
});
