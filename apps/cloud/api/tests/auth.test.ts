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

import { beforeAll, describe, expect, it } from "vitest";
import { StaticOwnerAuth, parseOwnerTokens } from "../src/auth.js";
import { createApi } from "../src/index.js";
import { ChainOwnerAuth, OauthSessionAuth } from "../src/oauth-github.js";
import { InMemoryStorage } from "../src/storage.js";
import { type SigningKey, generateSigningKey, signManifest } from "./_signing.js";

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

let aliceKey: SigningKey;

beforeAll(async () => {
  aliceKey = await generateSigningKey(1);
});

function setup() {
  const storage = new InMemoryStorage();
  const ownerAuth = new StaticOwnerAuth({ "tok-alice": "alice", "tok-bob": "bob" });
  return { app: createApi({ storage, ownerAuth }), storage };
}

async function publish(
  app: ReturnType<typeof createApi>,
  body: unknown,
  token: string | undefined,
  key: SigningKey = aliceKey,
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const { pubkey, signature } = await signManifest(body, key);
  headers["x-aap-pubkey"] = pubkey;
  headers["x-aap-signature"] = signature;
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

describe("ChainOwnerAuth — OAuth-issued bearers and OWNER_TOKENS bearers coexist", () => {
  it("OAuth-issued bearer authenticates POST /v1/agents the same as OWNER_TOKENS", async () => {
    const storage = new InMemoryStorage();
    const staticAuth = new StaticOwnerAuth({ "tok-alice": "alice" });
    // Pre-seed an oauth session as if /v1/auth/github/callback had run.
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    await storage.createOauthSession({
      bearer: "oauth-bearer-fresh",
      ownerId: "gh:weijt606",
      provider: "github",
      providerUid: "4242",
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    const ownerAuth = new ChainOwnerAuth(staticAuth, new OauthSessionAuth(storage));
    const app = createApi({ storage, ownerAuth });

    const ghManifest = {
      ...validManifest,
      aid: "aid:agentagora:gh-weijt606/code-review",
    };
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: "Bearer oauth-bearer-fresh",
    };
    const { pubkey, signature } = await signManifest(ghManifest, aliceKey);
    headers["x-aap-pubkey"] = pubkey;
    headers["x-aap-signature"] = signature;
    const res = await app.request("/v1/agents", {
      method: "POST",
      headers,
      body: JSON.stringify(ghManifest),
    });
    expect(res.status).toBe(201);
    const stored = await storage.getAgent(ghManifest.aid);
    expect(stored?.publishedBy).toBe("gh:weijt606");

    // The static OWNER_TOKEN bearer still works for a separate AID.
    const aliceManifest = { ...validManifest, aid: "aid:agentagora:alice/code-review" };
    const aliceHeaders: Record<string, string> = {
      "content-type": "application/json",
      authorization: "Bearer tok-alice",
    };
    const aliceSig = await signManifest(aliceManifest, aliceKey);
    aliceHeaders["x-aap-pubkey"] = aliceSig.pubkey;
    aliceHeaders["x-aap-signature"] = aliceSig.signature;
    const aliceRes = await app.request("/v1/agents", {
      method: "POST",
      headers: aliceHeaders,
      body: JSON.stringify(aliceManifest),
    });
    expect(aliceRes.status).toBe(201);
    const aliceStored = await storage.getAgent(aliceManifest.aid);
    expect(aliceStored?.publishedBy).toBe("alice");
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
