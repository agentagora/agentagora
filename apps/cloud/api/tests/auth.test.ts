/**
 * Owner-token auth tests for POST /v1/agents.
 *
 * Covers the four states that matter for closed-alpha:
 *   - missing token       → 401
 *   - unknown token       → 401
 *   - valid token         → 201, published_by set to resolved owner
 *   - cross-owner update  → 403, original record untouched
 *
 * Also exercises parseOwnerTokens to lock the env-string format.
 */

import { describe, expect, it } from "vitest";
import { StaticOwnerAuth, parseOwnerTokens } from "../src/auth.js";
import { createApi } from "../src/index.js";
import { InMemoryStorage } from "../src/storage.js";

const validManifest = {
  manifest_version: 1 as const,
  aid: "aid:agentagora:weijt606/code-review",
  description: "Reviews PRs",
  endpoints: { rpc: "https://example.com/aap/v1/rpc" },
  capabilities: [
    {
      name: "review_pull_request",
      input_schema: { type: "object" },
      output_schema: { type: "object" },
      pricing: { model: "per_call" as const, amount: "0.50", currency: "USD" },
      accepts: ["stripe-fiat"],
    },
  ],
};

function setup() {
  const storage = new InMemoryStorage();
  const ownerAuth = new StaticOwnerAuth({ "tok-alice": "alice", "tok-bob": "bob" });
  return { app: createApi({ storage, ownerAuth }), storage };
}

async function publish(
  app: ReturnType<typeof createApi>,
  body: unknown,
  token: string | undefined,
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return app.request("/v1/agents", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /v1/agents — auth", () => {
  it("rejects request with no Authorization header (401)", async () => {
    const { app } = setup();
    const res = await publish(app, validManifest, undefined);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("rejects an Authorization header without a Bearer prefix (401)", async () => {
    const { app } = setup();
    const res = await app.request("/v1/agents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "tok-alice",
      },
      body: JSON.stringify(validManifest),
    });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown bearer token (401)", async () => {
    const { app } = setup();
    const res = await publish(app, validManifest, "tok-unknown");
    expect(res.status).toBe(401);
  });

  it("accepts a valid token and stamps published_by from the resolved owner", async () => {
    const { app, storage } = setup();
    const res = await publish(app, validManifest, "tok-bob");
    expect(res.status).toBe(201);
    const stored = await storage.getAgent(validManifest.aid);
    expect(stored?.publishedBy).toBe("bob");
  });

  it("lets the same owner update an existing AID (200/201)", async () => {
    const { app, storage } = setup();
    const first = await publish(app, validManifest, "tok-alice");
    expect(first.status).toBe(201);

    const second = await publish(
      app,
      { ...validManifest, description: "now reviews TS PRs" },
      "tok-alice",
    );
    expect(second.status).toBe(201);

    const stored = await storage.getAgent(validManifest.aid);
    expect(stored?.publishedBy).toBe("alice");
    expect(stored?.manifest.description).toBe("now reviews TS PRs");
  });

  it("rejects a cross-owner update (403) and leaves the original record intact", async () => {
    const { app, storage } = setup();
    await publish(app, validManifest, "tok-alice");

    const hijack = await publish(
      app,
      { ...validManifest, description: "rugged by bob" },
      "tok-bob",
    );
    expect(hijack.status).toBe(403);
    const body = (await hijack.json()) as { error: string };
    expect(body.error).toBe("forbidden");

    const stored = await storage.getAgent(validManifest.aid);
    expect(stored?.publishedBy).toBe("alice");
    expect(stored?.manifest.description).toBe("Reviews PRs");
  });

  it("validates body only after auth passes (auth precedence)", async () => {
    const { app } = setup();
    // Bad token + bad body → 401, not 400.
    const res = await publish(app, { not: "a manifest" }, "tok-unknown");
    expect(res.status).toBe(401);
  });
});

describe("parseOwnerTokens", () => {
  it("parses a single pair", () => {
    const map = parseOwnerTokens("alice:tok-A");
    expect(map.get("tok-A")).toBe("alice");
  });

  it("parses multiple pairs and trims whitespace", () => {
    const map = parseOwnerTokens(" alice:tok-A , bob:tok-B ,carol:tok-C ");
    expect(map.size).toBe(3);
    expect(map.get("tok-A")).toBe("alice");
    expect(map.get("tok-B")).toBe("bob");
    expect(map.get("tok-C")).toBe("carol");
  });

  it("preserves colons inside the token half", () => {
    // OIDC bearer tokens / JWTs commonly contain dots and colons.
    const map = parseOwnerTokens("alice:eyJhbGciOi:JIUzI1NiJ9.foo");
    expect(map.get("eyJhbGciOi:JIUzI1NiJ9.foo")).toBe("alice");
  });

  it("drops malformed entries silently", () => {
    const map = parseOwnerTokens("nope,:no-owner,no-token:,,bob:tok-B");
    expect(map.size).toBe(1);
    expect(map.get("tok-B")).toBe("bob");
  });

  it("returns an empty map for undefined / empty input", () => {
    expect(parseOwnerTokens(undefined).size).toBe(0);
    expect(parseOwnerTokens("").size).toBe(0);
    expect(parseOwnerTokens("   ").size).toBe(0);
  });
});
