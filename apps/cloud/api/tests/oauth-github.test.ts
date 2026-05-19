/**
 * /v1/auth/github/* tests.
 *
 * Covers the start + callback flow end-to-end using a MockGithubClient
 * so the test never reaches github.com:
 *
 *   GET /start
 *     - returns a valid authorize_url that points at github.com/login/oauth/authorize
 *       with the configured client_id, scope, and a non-empty state parameter
 *
 *   POST /callback
 *     - 400 when body is missing code or state
 *     - 401 when state HMAC is invalid (CSRF defense)
 *     - 401 when state is correctly signed but expired (freshness window)
 *     - 502 when GitHub's token-exchange endpoint rejects the code
 *     - 502 when GitHub's /user fetch fails
 *     - 201 happy path: returns a fresh bearer + persists oauth_sessions row
 *
 *   Cross-feature
 *     - the bearer issued by /callback authenticates POST /v1/agents the
 *       same as a static OWNER_TOKENS bearer
 *     - 503 not_configured when the parent app has no GitHub config wired
 */

import { beforeAll, describe, expect, it } from "vitest";
import { StaticOwnerAuth } from "../src/auth.js";
import { createApi } from "../src/index.js";
import {
  ChainOwnerAuth,
  type GithubLike,
  type GithubUser,
  OauthSessionAuth,
  deriveStateSigningKey,
} from "../src/oauth-github.js";
import { InMemoryStorage } from "../src/storage.js";
import { type SigningKey, generateSigningKey, signManifest } from "./_signing.js";

const CLIENT_ID = "Iv1.test_client_id";
const CLIENT_SECRET = "test_client_secret";

class MockGithubClient implements GithubLike {
  exchangeCalls: Array<{ code: string }> = [];
  fetchCalls: string[] = [];
  /** When non-null, exchange returns this token. */
  exchangeToken: string | null = "ghs_test_access_token";
  exchangeError: Error | null = null;
  user: GithubUser = { id: 4242, login: "oss-test", email: "oss-test@agentagora.dev" };
  fetchError: Error | null = null;

  async exchangeCode(input: { code: string }): Promise<string> {
    this.exchangeCalls.push({ code: input.code });
    if (this.exchangeError) throw this.exchangeError;
    if (this.exchangeToken === null) throw new Error("no token configured");
    return this.exchangeToken;
  }

  async fetchUser(token: string): Promise<GithubUser> {
    this.fetchCalls.push(token);
    if (this.fetchError) throw this.fetchError;
    return this.user;
  }
}

interface SetupOptions {
  /** Override the wall clock returned by the GitHub OAuth router /
   *  the OauthSessionAuth (in millis since epoch). */
  nowMs?: number;
  /** Skip wiring GitHub OAuth — used to assert 503 not_configured. */
  withoutGithub?: boolean;
  /** Force the §H4 fail-closed callback behavior. Default off so
   *  the existing legacy-GET tests don't break; new H4 tests opt in. */
  requireNonceBinding?: boolean;
}

async function setup(options: SetupOptions = {}) {
  const storage = new InMemoryStorage();
  const staticAuth = new StaticOwnerAuth({ "tok-alice": "alice" });
  // OIDC_SIGNING_KEY-equivalent input — a deterministic 32-byte buffer
  // is fine for tests.
  const signingKeyMaterial = new Uint8Array(32).fill(7);
  const stateSigningKey = await deriveStateSigningKey(signingKeyMaterial);
  const github = new MockGithubClient();

  const nowImpl = () =>
    options.nowMs !== undefined ? new Date(options.nowMs) : new Date(1_700_000_000_000);

  const ownerAuth = new ChainOwnerAuth(staticAuth, new OauthSessionAuth(storage, nowImpl));

  const app = createApi({
    storage,
    ownerAuth,
    ...(options.withoutGithub
      ? {}
      : {
          githubOauth: {
            config: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET },
            client: github,
            stateSigningKey,
            now: nowImpl,
            ...(options.requireNonceBinding !== undefined
              ? { requireNonceBinding: options.requireNonceBinding }
              : {}),
          },
        }),
  });

  return { app, storage, github, stateSigningKey, nowImpl };
}

describe("GET /v1/auth/github/start", () => {
  it("returns an authorize_url + state", async () => {
    const { app } = await setup();
    const res = await app.request("/v1/auth/github/start");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authorize_url: string; state: string };
    expect(body.authorize_url).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
    expect(body.authorize_url).toContain(`client_id=${CLIENT_ID}`);
    expect(body.authorize_url).toContain("scope=read");
    expect(body.authorize_url).toContain(`state=${encodeURIComponent(body.state)}`);
    expect(body.state.length).toBeGreaterThan(20);
    expect(body.state).toContain("."); // body.signature shape
  });

  it("returns 503 when GitHub OAuth is not configured", async () => {
    const { app } = await setup({ withoutGithub: true });
    const res = await app.request("/v1/auth/github/start");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_configured");
  });
});

describe("POST /v1/auth/github/callback", () => {
  async function obtainState(app: ReturnType<typeof createApi>): Promise<string> {
    const r = await app.request("/v1/auth/github/start");
    const body = (await r.json()) as { state: string };
    return body.state;
  }

  it("400 when code is missing", async () => {
    const { app } = await setup();
    const state = await obtainState(app);
    const res = await app.request("/v1/auth/github/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    });
    expect(res.status).toBe(400);
  });

  it("400 when state is missing", async () => {
    const { app } = await setup();
    const res = await app.request("/v1/auth/github/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "abc" }),
    });
    expect(res.status).toBe(400);
  });

  it("401 when state HMAC is invalid", async () => {
    const { app } = await setup();
    const res = await app.request("/v1/auth/github/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "abc", state: "not-a-real-state.deadbeef" }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("401 when state HMAC is valid but issued > 10 minutes ago", async () => {
    const { app } = await setup({ nowMs: 1_700_000_000_000 });
    const state = await obtainState(app);

    // Re-build the app with the clock advanced past the freshness window.
    const future = await setup({ nowMs: 1_700_000_000_000 + 11 * 60 * 1000 });
    const res = await future.app.request("/v1/auth/github/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "abc", state }),
    });
    expect(res.status).toBe(401);
  });

  it("502 when GitHub rejects the code (token exchange fails)", async () => {
    const { app, github } = await setup();
    github.exchangeError = new Error("bad_verification_code");
    const state = await obtainState(app);
    const res = await app.request("/v1/auth/github/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "abc", state }),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("upstream_unavailable");
  });

  it("502 when GitHub's /user fetch fails after a successful exchange", async () => {
    const { app, github } = await setup();
    github.fetchError = new Error("server_error");
    const state = await obtainState(app);
    const res = await app.request("/v1/auth/github/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "abc", state }),
    });
    expect(res.status).toBe(502);
  });

  it("happy path: returns a fresh bearer + persists oauth_sessions row", async () => {
    const { app, github, storage } = await setup();
    const state = await obtainState(app);
    const res = await app.request("/v1/auth/github/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "abc-code", state }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      bearer: string;
      owner_id: string;
      github_login: string;
      provider: string;
      issued_at: string;
      expires_at: string;
    };

    // Owner ID and login come from the GitHub profile.
    expect(body.github_login).toBe("oss-test");
    expect(body.owner_id).toBe("gh:oss-test");
    expect(body.provider).toBe("github");

    // Bearer is a base64url string ≥ 32 bytes of randomness, NOT
    // derived from the GitHub access token.
    expect(body.bearer).not.toContain(github.exchangeToken!);
    expect(body.bearer).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    // Expiry is 30 days out.
    const issuedMs = new Date(body.issued_at).getTime();
    const expiresMs = new Date(body.expires_at).getTime();
    expect(expiresMs - issuedMs).toBe(30 * 24 * 60 * 60 * 1000);

    // Persisted to storage.
    const session = await storage.getOauthSession(body.bearer);
    expect(session?.ownerId).toBe("gh:oss-test");
    expect(session?.providerUid).toBe("4242");
    expect(session?.email).toBe("oss-test@agentagora.dev");

    // Code was forwarded once.
    expect(github.exchangeCalls).toHaveLength(1);
    expect(github.exchangeCalls[0]?.code).toBe("abc-code");
  });
});

describe("OauthSessionAuth resolves OAuth-issued bearers like OWNER_TOKENS bearers", () => {
  let pubKey: SigningKey;
  beforeAll(async () => {
    pubKey = await generateSigningKey(2);
  });

  const validManifest = {
    manifest_version: 1 as const,
    aid: "aid:agentagora:oss-test/code-review",
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

  // Note: this AID needs to be owned by `gh:oss-test` for the publish
  // to succeed — manifest AIDs aren't constrained to the owner ID
  // server-side (the registry stamps published_by from the bearer),
  // so this is just a "what shape does the cloud accept?" test.
  const ghAid = "aid:agentagora:gh-oss-test/code-review";
  const ghManifest = { ...validManifest, aid: ghAid };

  async function publish(
    app: ReturnType<typeof createApi>,
    body: unknown,
    token: string,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    };
    const { pubkey, signature } = await signManifest(body, pubKey);
    headers["x-aap-pubkey"] = pubkey;
    headers["x-aap-signature"] = signature;
    return app.request("/v1/agents", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  it("allows publish via an OAuth-issued bearer (chain authenticator)", async () => {
    const { app, storage } = await setup();
    // 1. Run the OAuth dance to mint a fresh bearer.
    const startRes = await app.request("/v1/auth/github/start");
    const start = (await startRes.json()) as { state: string };
    const cbRes = await app.request("/v1/auth/github/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "abc", state: start.state }),
    });
    const { bearer } = (await cbRes.json()) as { bearer: string };

    // 2. Use the bearer to publish.
    const res = await publish(app, ghManifest, bearer);
    expect(res.status).toBe(201);
    const stored = await storage.getAgent(ghAid);
    expect(stored?.publishedBy).toBe("gh:oss-test");
  });

  it("still accepts the static OWNER_TOKENS bearer alongside OAuth bearers", async () => {
    const { app, storage } = await setup();
    const res = await publish(app, validManifest, "tok-alice");
    expect(res.status).toBe(201);
    const stored = await storage.getAgent(validManifest.aid);
    expect(stored?.publishedBy).toBe("alice");
  });

  it("rejects an expired OAuth bearer once the TTL passes", async () => {
    // Mint at t0.
    const t0 = 1_700_000_000_000;
    const issuance = await setup({ nowMs: t0 });
    const startRes = await issuance.app.request("/v1/auth/github/start");
    const start = (await startRes.json()) as { state: string };
    const cbRes = await issuance.app.request("/v1/auth/github/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "abc", state: start.state }),
    });
    expect(cbRes.status).toBe(201);
    const { bearer } = (await cbRes.json()) as { bearer: string };

    // The session row in InMemoryStorage uses Date.now() for expiry
    // — so test the OauthSessionAuth path directly with a future clock.
    const expiredAuth = new OauthSessionAuth(
      issuance.storage,
      () => new Date(t0 + 31 * 24 * 60 * 60 * 1000),
    );
    expect(await expiredAuth.resolve(bearer)).toBeUndefined();
  });
});

// security-review-2026-05 §H3: state may carry a SHA-256 hash of a
// browser-bound nonce. The callback then requires the matching raw
// nonce to be re-presented; without it (or with a mismatched value)
// the response is 401 with `reason: "state_nonce_mismatch"`.
describe("POST /v1/auth/github/start with nonce_hash + callback nonce binding [§H3]", () => {
  async function sha256B64u(input: string): Promise<string> {
    const enc = new TextEncoder();
    const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
    const bytes = new Uint8Array(digest);
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  it("POST /start accepts a nonce_hash and binds it into the signed state", async () => {
    const { app } = await setup();
    const nonce = "test-raw-nonce-12345678901234567890";
    const nonceHash = await sha256B64u(nonce);
    const res = await app.request("/v1/auth/github/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce_hash: nonceHash }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authorize_url: string; state: string };
    expect(body.state).toContain(".");
    // Decode the state body and confirm the hash made it in.
    const parsed = JSON.parse(
      Buffer.from(
        body.state.split(".")[0]!.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf-8"),
    ) as { issuedAt: number; nonceHash?: string };
    expect(parsed.nonceHash).toBe(nonceHash);
  });

  it("callback rejects with state_nonce_mismatch when nonce is missing from the body", async () => {
    const { app } = await setup();
    const nonce = "test-raw-nonce-required";
    const nonceHash = await sha256B64u(nonce);
    const startRes = await app.request("/v1/auth/github/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce_hash: nonceHash }),
    });
    const start = (await startRes.json()) as { state: string };

    // No nonce in the callback body — state requires one.
    const cbRes = await app.request("/v1/auth/github/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "abc", state: start.state }),
    });
    expect(cbRes.status).toBe(401);
    const body = (await cbRes.json()) as { error: string; reason?: string };
    expect(body.error).toBe("unauthorized");
    expect(body.reason).toBe("state_nonce_mismatch");
  });

  it("callback rejects with state_nonce_mismatch when the wrong nonce is presented", async () => {
    const { app } = await setup();
    const nonce = "the-real-nonce";
    const nonceHash = await sha256B64u(nonce);
    const startRes = await app.request("/v1/auth/github/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce_hash: nonceHash }),
    });
    const start = (await startRes.json()) as { state: string };

    const cbRes = await app.request("/v1/auth/github/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "abc", state: start.state, nonce: "different-nonce" }),
    });
    expect(cbRes.status).toBe(401);
    const body = (await cbRes.json()) as { error: string; reason?: string };
    expect(body.reason).toBe("state_nonce_mismatch");
  });

  it("callback succeeds when the matching raw nonce is presented", async () => {
    const { app } = await setup();
    const nonce = "matching-raw-nonce-1234";
    const nonceHash = await sha256B64u(nonce);
    const startRes = await app.request("/v1/auth/github/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce_hash: nonceHash }),
    });
    const start = (await startRes.json()) as { state: string };

    const cbRes = await app.request("/v1/auth/github/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "abc", state: start.state, nonce }),
    });
    expect(cbRes.status).toBe(201);
    const body = (await cbRes.json()) as { bearer: string };
    expect(body.bearer).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  it("GET /start (no nonce_hash) still works for non-browser callers", async () => {
    const { app } = await setup();
    const startRes = await app.request("/v1/auth/github/start");
    const start = (await startRes.json()) as { state: string };
    // Callback without nonce should still succeed because state has no
    // nonce binding embedded.
    const cbRes = await app.request("/v1/auth/github/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "abc", state: start.state }),
    });
    expect(cbRes.status).toBe(201);
  });
});

// security-review-2026-05-07 §H4: the §H3 fix (above) made POST /start
// the secure path but left GET /start minting no-nonce states that the
// /callback would accept. An attacker could call GET /start
// (unauthenticated) and replay the original §H3 login-CSRF. This block
// asserts the H4 fail-closed mode (`requireNonceBinding: true`) blocks
// the legacy path while keeping POST /start + nonce-binding intact.
describe("POST /v1/auth/github/callback in requireNonceBinding mode [§H4]", () => {
  async function sha256B64u(input: string): Promise<string> {
    const enc = new TextEncoder();
    const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
    const bytes = new Uint8Array(digest);
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  it("rejects a state minted via GET /start (no nonceHash payload) with state_nonce_required", async () => {
    const { app } = await setup({ requireNonceBinding: true });
    const startRes = await app.request("/v1/auth/github/start");
    const start = (await startRes.json()) as { state: string };

    const cbRes = await app.request("/v1/auth/github/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "abc", state: start.state }),
    });
    expect(cbRes.status, "fail-closed callback MUST 401 on no-nonce state").toBe(401);
    const body = (await cbRes.json()) as { error: string; reason?: string; message?: string };
    expect(body.error).toBe("unauthorized");
    expect(body.reason).toBe("state_nonce_required");
  });

  it("still accepts POST /start with nonce_hash + matching raw nonce in callback (H3 path)", async () => {
    const { app } = await setup({ requireNonceBinding: true });
    const nonce = "h4-mode-real-nonce-1234567890";
    const nonceHash = await sha256B64u(nonce);

    const startRes = await app.request("/v1/auth/github/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce_hash: nonceHash }),
    });
    const start = (await startRes.json()) as { state: string };

    const cbRes = await app.request("/v1/auth/github/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "abc", state: start.state, nonce }),
    });
    expect(cbRes.status, "fail-closed mode MUST still accept nonce-bound flow").toBe(201);
  });
});

describe("Storage.deleteExpiredOauthSessions", () => {
  it("removes only rows with expires_at ≤ now", async () => {
    const storage = new InMemoryStorage();
    await storage.createOauthSession({
      bearer: "stale",
      ownerId: "gh:a",
      provider: "github",
      providerUid: "1",
      issuedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-31T00:00:00.000Z",
    });
    await storage.createOauthSession({
      bearer: "fresh",
      ownerId: "gh:b",
      provider: "github",
      providerUid: "2",
      issuedAt: "2099-01-01T00:00:00.000Z",
      expiresAt: "2099-01-31T00:00:00.000Z",
    });
    const removed = await storage.deleteExpiredOauthSessions("2026-05-01T00:00:00.000Z");
    expect(removed).toBe(1);
    expect(await storage.getOauthSession("stale")).toBeUndefined();
    // Live row still resolves via the auth path's freshness check.
    const fresh = await storage.getOauthSession("fresh");
    expect(fresh?.ownerId).toBe("gh:b");
  });
});
