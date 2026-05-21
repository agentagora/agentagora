/**
 * AgentAgora Cloud API.
 *
 * Hono on Cloudflare Workers. Per docs/tech-stack.md §4-6 the Cloud
 * Platform is the control plane only — discovery, identity issuance,
 * settlement coordination, audit indexing, dispute intake. Never on
 * the agent-to-agent data path.
 *
 * Surface (this file):
 *   GET  /                          metadata
 *   GET  /healthz                   liveness
 *   GET  /.well-known/jwks.json     active OIDC public keys
 *   POST /v1/agents                 publish manifest [Bearer + sig]
 *   GET  /v1/agents                 list / search registered agents
 *   GET  /v1/agents?owner=<id>      list agents owned by the bearer [Bearer]
 *   GET  /v1/agents/:aid            resolve one
 *   POST /v1/audit/ingest           server-side audit log archival
 *   GET  /v1/conversations?actor=…  list convos the AID participated in [Bearer]
 *   GET  /v1/conversations/:id      indexed audit query
 *   POST /v1/disputes               file a dispute case  [Bearer]
 *   GET  /v1/disputes?filer=…       list disputes filed by the AID [Bearer]
 *   GET  /v1/disputes?respondent=…  list disputes against the AID [Bearer]
 *   GET  /v1/disputes/:id           read a case file (public-by-ID)
 *   POST /v1/nonces/check           reserve a nonce [Bearer]
 *   POST /v1/connect/onboarding     Stripe Express onboarding link [Bearer]
 *   GET  /v1/connect/account        owner's Connect account status [Bearer]
 *   POST /v1/stripe/webhook         Stripe → cloud event ingestion (HMAC)
 *
 * Stripe webhook event coverage:
 *   - account.updated   refresh stripe_accounts cached flags
 *   - charge.refunded   record into `refunds` table + auto-resolve any
 *                        open dispute against the same conversation
 *                        (PRD §9.3 #3 auto-refund loop)
 */

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { getRequestId, requestIdMiddleware } from "./_request-id.js";
import { type OwnerAuthenticator, StaticOwnerAuth, parseOwnerTokens } from "./auth.js";
import { D1Storage } from "./d1-storage.js";
import { InMemoryNonceStore, KvNonceStore, type NonceStore } from "./nonces.js";
import {
  ChainOwnerAuth,
  GithubHttpClient,
  type GithubLike,
  type GithubOauthConfig,
  OauthSessionAuth,
  createGithubOauthRouter,
  deriveStateSigningKey,
} from "./oauth-github.js";
import { OidcIssuer, decodePrivateKey } from "./oidc.js";
import { InMemoryRateLimiter, KvRateLimiter, type RateLimiter } from "./rate-limit.js";
import { createAgentsRouter } from "./routes/agents.js";
import { createAuditRouter, createConversationsRouter } from "./routes/audit.js";
import { createConnectRouter } from "./routes/connect.js";
import { createDisputesRouter } from "./routes/disputes.js";
import { createNoncesRouter } from "./routes/nonces.js";
import { createStripeWebhookRouter } from "./routes/stripe-webhook.js";
import { InMemoryStorage, type Storage } from "./storage.js";
import { HmacWebhookVerifier, type WebhookVerifier } from "./stripe-webhook.js";
import { HttpStripeApiClient, type StripeApiClient } from "./stripe.js";

/**
 * Worker bindings. `DB` lands in v0.0.2 (D1 registry persistence).
 * Phase 3 still adds: AUDIT (R2), NONCE (KV).
 */
export interface Env {
  DB?: D1Database;
  /**
   * Comma-separated owner credentials, format
   *   "<ownerId>:<token>,<ownerId>:<token>,..."
   * Set as a Worker secret in production; without it, no one can
   * publish (POST /v1/agents returns 401 for every request).
   */
  OWNER_TOKENS?: string;
  /**
   * base64url-encoded raw 32-byte Ed25519 private key. When set, the
   * Worker issues real OIDC identity certificates and publishes a
   * JWKS document at /.well-known/jwks.json. Without it, JWTs fall
   * back to a deterministic mock string and JWKS is 503.
   */
  OIDC_SIGNING_KEY?: string;
  /** `iss` claim and base for `aap.manifest_url`. Required when
   *  OIDC_SIGNING_KEY is set. */
  OIDC_ISSUER?: string;
  /**
   * KV namespace for the global nonce dedup store. Without it,
   * /v1/nonces/check falls back to an in-memory store (per-isolate,
   * lost on cold start — useful only for `wrangler dev` and tests).
   */
  NONCES?: KVNamespace;
  /**
   * KV namespace for the per-owner rate-limit counters. Without it,
   * limiting falls back to an in-memory store (per-isolate, lossy
   * across isolates — fine for closed alpha, won't catch coordinated
   * abuse across the fleet).
   */
  RATE_LIMITS?: KVNamespace;
  /**
   * Stripe secret key (sk_live_… or sk_test_…). When set, the
   * /v1/connect/* routes are live; without it, the routes return
   * 503 because the Stripe API client isn't configured.
   */
  STRIPE_SECRET_KEY?: string;
  /**
   * Stripe webhook endpoint signing secret (whsec_…). Required for
   * /v1/stripe/webhook to verify deliveries. Without it the route
   * returns 503 not_configured.
   */
  STRIPE_WEBHOOK_SECRET?: string;
  /**
   * GitHub OAuth app client id (the public half of the credential
   * pair). Required for /v1/auth/github/* — without it the routes
   * return 503 not_configured (mirrors the Stripe pattern).
   */
  GITHUB_CLIENT_ID?: string;
  /**
   * GitHub OAuth app client secret. Paired with GITHUB_CLIENT_ID.
   * Without it the github routes return 503 not_configured.
   */
  GITHUB_CLIENT_SECRET?: string;
  /**
   * Optional override for the GitHub OAuth redirect URI. When unset,
   * GitHub uses the OAuth app's default callback URL.
   */
  GITHUB_REDIRECT_URI?: string;
  /**
   * security-review-2026-05-07 §H4. Set to "false" ONLY in dev to
   * allow the legacy `GET /v1/auth/github/start` (no-nonce) flow to
   * complete via `/callback`. Any other value (or unset) → fail
   * closed: callback rejects no-nonce states with
   * `state_nonce_mismatch`. Production NEVER sets this — the default
   * is correct.
   */
  OAUTH_REQUIRE_NONCE?: string;
  /**
   * Set to "production" on prod Worker deploys. When set, the cloud
   * fails closed at boot if security-critical bindings are missing
   * (NONCES KV → replay protection broken; RATE_LIMITS KV → rate
   * counters per-isolate). Unset / any other value → dev mode,
   * in-memory fallbacks accepted with a console.warn.
   * security-review-2026-05-07 §M7.
   */
  AAP_ENV?: string;
  /**
   * Comma-separated list of origins allowed to make cross-origin
   * requests with `Authorization` headers (i.e., the dashboard +
   * marketing site origins in production).
   *
   *   "https://dashboard.agentagora.dev,https://agentagora.dev"
   *
   * Localhost origins (`http://localhost:*`, `http://127.0.0.1:*`)
   * are always allowed so `pnpm dev` works without env config.
   *
   * Public GET routes (catalog, healthz, JWKS) respond with `*` to
   * any origin regardless — they have no credentials surface. The
   * allow-list only gates POST / authenticated routes.
   *
   * security-review-2026-05-07 §H5: without this, the dashboard's
   * browser→cloud-api publish + dispute flows break under CORS
   * preflight on any cross-origin production deploy.
   */
  DASHBOARD_ORIGINS?: string;
}

/**
 * Pull the bearer token out of an Authorization header value. Used
 * by the §L4 connect-503-after-auth pattern in this file; per-route
 * handlers carry their own copies under `routes/*.ts`.
 */
function extractBearerHeader(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim();
}

/**
 * Returns true if `origin` matches any localhost / 127.0.0.1 host
 * regardless of port. Localhost is treated as "always trusted" so
 * `pnpm dev` works without explicit `DASHBOARD_ORIGINS` config.
 */
function isLocalhostOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export interface CreateApiOptions {
  /** Pluggable storage. Defaults to InMemoryStorage (per-isolate). */
  storage?: Storage;
  /**
   * Bearer-token authenticator for write endpoints. Required by
   * POST /v1/agents; defaults to an empty StaticOwnerAuth, meaning
   * every publish attempt is rejected as unauthorized.
   */
  ownerAuth?: OwnerAuthenticator;
  /**
   * OIDC issuer. When provided, POST /v1/agents returns a real
   * EdDSA JWT and GET /.well-known/jwks.json publishes the
   * verifying public key. When absent, JWTs are mocked.
   */
  oidc?: OidcIssuer;
  /**
   * Global nonce store for /v1/nonces/check. Defaults to an
   * InMemoryNonceStore — per-isolate, fine for tests and dev.
   */
  nonceStore?: NonceStore;
  /**
   * Rate limiter applied to every Bearer-authed write route. When
   * absent, no limiting is applied (tests pass undefined to skip).
   */
  rateLimiter?: RateLimiter;
  /**
   * CORS allow-list for cross-origin authenticated requests. Public
   * GETs always respond `Access-Control-Allow-Origin: *`; this
   * option only gates routes that carry an `Authorization` header.
   * When undefined or empty, only localhost origins (`http://localhost:*`,
   * `http://127.0.0.1:*`) are allowed — sensible default for `pnpm dev`.
   * Production wires the dashboard + marketing origins from the
   * DASHBOARD_ORIGINS env var.
   */
  corsAllowList?: string[];
  /**
   * Stripe API client. When absent, the /v1/connect/* routes return
   * 503 not_configured. Production wires HttpStripeApiClient with
   * STRIPE_SECRET_KEY; tests pass an in-memory mock.
   */
  stripe?: StripeApiClient;
  /**
   * Stripe webhook verifier. When absent, /v1/stripe/webhook
   * returns 503 not_configured. Tests pass a fixed-secret verifier.
   */
  stripeWebhookVerifier?: WebhookVerifier;
  /**
   * GitHub OAuth wiring. When all three (config, client, key) are
   * provided, /v1/auth/github/* is mounted. When any are missing,
   * the routes return 503 not_configured.
   */
  githubOauth?: {
    config: GithubOauthConfig;
    client: GithubLike;
    /** 32-byte HMAC key for signing OAuth `state`. */
    stateSigningKey: Uint8Array;
    /** Override the wall clock for deterministic tests. */
    now?: () => Date;
    /** Override the bearer minter for deterministic tests. */
    newBearer?: () => string;
    /**
     * When true, the `/callback` route rejects any state that does
     * NOT carry a `nonceHash` payload (i.e., state minted via
     * `GET /start` rather than `POST /start`). Closes the
     * security-review-2026-05-07 §H4 login-CSRF re-entry: without
     * this flag, an attacker calls the unauthenticated `GET /start`
     * to mint a no-nonce state and replays the original §H3 attack.
     *
     * Production wires this to `true` via the `OAUTH_REQUIRE_NONCE`
     * env var (default true if unset — fail closed). Tests opt out
     * explicitly to exercise the legacy GET-no-nonce code path.
     */
    requireNonceBinding?: boolean;
  };
}

/**
 * Build a Hono app instance. Tests use `app.request()` directly;
 * production wraps it as the Worker fetch handler.
 */
export function createApi(options: CreateApiOptions = {}): Hono {
  const storage = options.storage ?? new InMemoryStorage();
  const ownerAuth = options.ownerAuth ?? new StaticOwnerAuth({});
  const oidc = options.oidc;
  const nonceStore = options.nonceStore ?? new InMemoryNonceStore();
  const rateLimiter = options.rateLimiter;
  const stripe = options.stripe;
  const stripeWebhookVerifier = options.stripeWebhookVerifier;
  const app = new Hono();

  // Mount request-id correlation FIRST so 404s, errors, and every
  // route handler share a consistent X-Request-Id surface.
  app.use("*", requestIdMiddleware());

  // CORS. The dashboard's manifest-publish + file-dispute forms POST
  // browser→cloud-api directly with Authorization headers — without
  // a CORS allow-list, every preflight 404s and the actual POST
  // never goes out. Two layers:
  //
  //   1. Public read paths (catalog, healthz, JWKS, conversation /
  //      dispute by id) — Allow-Origin: *. They carry no credentials
  //      and the marketing site / third-party clients are expected
  //      to read them anonymously.
  //
  //   2. All other /v1/* paths — Allow-Origin: <echo>, restricted
  //      to the configured allow-list OR any localhost origin.
  //      Localhost is treated as always-trusted so `pnpm dev` works
  //      without env config; production wires real origins through
  //      DASHBOARD_ORIGINS in env -> options.corsAllowList.
  //
  // We don't enable `credentials: true` — the dashboard uses bearer
  // tokens in Authorization headers, not cross-site cookies, so the
  // looser `Allow-Origin: *` actually works for the public surface.
  //
  // security-review-2026-05-07 §H5.
  const corsAllowList = options.corsAllowList ?? [];
  app.use(
    "/v1/agents",
    cors({
      origin: "*",
      allowMethods: ["GET", "OPTIONS"],
      allowHeaders: ["content-type"],
      maxAge: 86400,
    }),
  );
  app.use("/healthz", cors({ origin: "*", allowMethods: ["GET", "OPTIONS"], maxAge: 86400 }));
  app.use(
    "/.well-known/jwks.json",
    cors({ origin: "*", allowMethods: ["GET", "OPTIONS"], maxAge: 86400 }),
  );
  // Authenticated + write paths. Echo the origin if it's allow-listed
  // OR localhost; otherwise return no ACA-O header → browser blocks.
  app.use(
    "/v1/*",
    cors({
      origin: (origin) => {
        if (!origin) return ""; // same-origin / curl — no preflight needed
        if (isLocalhostOrigin(origin)) return origin;
        if (corsAllowList.includes(origin)) return origin;
        return "";
      },
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["content-type", "authorization", "x-aap-pubkey", "x-aap-signature"],
      exposeHeaders: ["x-request-id"],
      maxAge: 86400,
    }),
  );

  app.get("/", (c) =>
    c.json({
      name: "AgentAgora Cloud API",
      version: "0.0.2",
      status: "pre-alpha",
      docs: "https://github.com/agentagora/agentagora/tree/main/docs",
    }),
  );

  app.get("/healthz", (c) => c.json({ ok: true, version: "0.0.1" }));

  app.get("/.well-known/jwks.json", (c) => {
    if (!oidc) {
      return c.json(
        { error: "not_configured", message: "OIDC signing key is not configured" },
        503,
      );
    }
    return c.json(oidc.jwks());
  });

  // security-review-2026-05-07 §M11: cap request body sizes per
  // route so a malformed / hostile client can't burn CPU + memory
  // parsing 99 MB JSON. Caps are generous relative to typical
  // payloads (manifest ~2-4 KB, dispute body ~1-2 KB, nonce key
  // < 256 bytes) but small enough to be a real ceiling.
  //
  // 413 envelope mirrors the cloud-api convention `{ error, message }`.
  const tooLarge = (limitKb: number) => ({
    maxSize: limitKb * 1024,
    onError: (c: { json: (b: unknown, s: number) => Response }) =>
      c.json(
        {
          error: "payload_too_large",
          message: `request body exceeds the ${limitKb} KB limit for this route`,
        },
        413,
      ),
  });
  // audit-ingest takes batches of signed events; 1 MB is ~20 small
  // events. If a real workload needs more, pagination is the right
  // answer, not a bigger cap.
  app.use("/v1/audit/ingest", bodyLimit(tooLarge(1024)));
  // Manifest publish: 4 KB typical, 64 KB ceiling leaves headroom
  // for fat capability schemas.
  app.use("/v1/agents", bodyLimit(tooLarge(64)));
  // Disputes, nonces, connect, stripe-webhook, oauth: all small
  // structured bodies. 16 KB is generous.
  app.use("/v1/disputes", bodyLimit(tooLarge(16)));
  app.use("/v1/nonces/check", bodyLimit(tooLarge(16)));
  app.use("/v1/connect/*", bodyLimit(tooLarge(16)));
  app.use("/v1/stripe/webhook", bodyLimit(tooLarge(64)));
  app.use("/v1/auth/github/*", bodyLimit(tooLarge(16)));

  app.route("/v1/agents", createAgentsRouter({ storage, ownerAuth, oidc, rateLimiter }));
  app.route("/v1/audit", createAuditRouter(storage));
  app.route("/v1/conversations", createConversationsRouter({ storage, ownerAuth }));
  app.route("/v1/disputes", createDisputesRouter({ storage, ownerAuth, rateLimiter }));
  app.route("/v1/nonces", createNoncesRouter({ ownerAuth, store: nonceStore, rateLimiter }));

  if (stripe) {
    app.route("/v1/connect", createConnectRouter({ storage, ownerAuth, stripe }));
  } else {
    // security-review-2026-05-07 §L4: check auth FIRST, then signal
    // service-unavailable. Stripe-unconfigured dev candidates would
    // otherwise leak that the route exists to anonymous probes.
    // GET /v1/connect/accounts/:aid is the only intentionally public
    // route under /connect/* (resolver-style lookup); keep that on
    // the 503 short-circuit path.
    app.all("/v1/connect/onboarding", async (c) => {
      const bearer = extractBearerHeader(c.req.header("authorization"));
      if (!bearer) {
        return c.json({ error: "unauthorized", message: "missing bearer token" }, 401);
      }
      const ownerId = await ownerAuth.resolve(bearer);
      if (!ownerId) {
        return c.json({ error: "unauthorized", message: "invalid bearer token" }, 401);
      }
      return c.json({ error: "not_configured", message: "STRIPE_SECRET_KEY is not set" }, 503);
    });
    app.all("/v1/connect/account", async (c) => {
      const bearer = extractBearerHeader(c.req.header("authorization"));
      if (!bearer) {
        return c.json({ error: "unauthorized", message: "missing bearer token" }, 401);
      }
      const ownerId = await ownerAuth.resolve(bearer);
      if (!ownerId) {
        return c.json({ error: "unauthorized", message: "invalid bearer token" }, 401);
      }
      return c.json({ error: "not_configured", message: "STRIPE_SECRET_KEY is not set" }, 503);
    });
    app.all("/v1/connect/*", (c) =>
      c.json({ error: "not_configured", message: "STRIPE_SECRET_KEY is not set" }, 503),
    );
  }

  if (stripeWebhookVerifier) {
    app.route(
      "/v1/stripe/webhook",
      createStripeWebhookRouter({ storage, verifier: stripeWebhookVerifier }),
    );
  } else {
    app.all("/v1/stripe/webhook", (c) =>
      c.json({ error: "not_configured", message: "STRIPE_WEBHOOK_SECRET is not set" }, 503),
    );
  }

  const githubOauth = options.githubOauth;
  if (githubOauth) {
    app.route(
      "/v1/auth/github",
      createGithubOauthRouter({
        config: githubOauth.config,
        github: githubOauth.client,
        storage,
        stateSigningKey: githubOauth.stateSigningKey,
        ...(githubOauth.now ? { now: githubOauth.now } : {}),
        ...(githubOauth.newBearer ? { newBearer: githubOauth.newBearer } : {}),
        ...(githubOauth.requireNonceBinding !== undefined
          ? { requireNonceBinding: githubOauth.requireNonceBinding }
          : {}),
      }),
    );
  } else {
    app.all("/v1/auth/github/*", (c) =>
      c.json(
        {
          error: "not_configured",
          message: "GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET are not set",
        },
        503,
      ),
    );
  }

  app.notFound((c) => {
    const requestId = getRequestId(c);
    return c.json({ error: "not_found", path: c.req.path, request_id: requestId }, 404);
  });

  app.onError((err, c) => {
    const requestId = getRequestId(c);
    // security-review §L1: keep the verbose error server-side so we
    // don't leak internals (stack traces, third-party error bodies).
    // The client gets the request_id and can quote it when escalating.
    console.error(`[req=${requestId}] [cloud-api] unhandled error`, err);
    return c.json({ error: "internal", request_id: requestId }, 500);
  });

  return app;
}

// Workers fetch handler. The app is cached per isolate as a promise so
// async setup (deriving the OIDC public key from the private one) only
// runs once per cold start.
let cached: Promise<Hono> | undefined;

export async function buildApp(env: Env): Promise<Hono> {
  const storage: Storage = env.DB ? new D1Storage(env.DB) : new InMemoryStorage();
  const staticAuth = new StaticOwnerAuth(parseOwnerTokens(env.OWNER_TOKENS));
  if (!staticAuth.hasAnyTokens) {
    console.warn(
      "[cloud-api] OWNER_TOKENS not configured — closed-alpha bearer-paste sign-in disabled",
    );
  }
  // OAuth-issued bearers and OWNER_TOKENS-issued bearers compose
  // behind a single OwnerAuthenticator so route code stays identical.
  // Static lookup runs first (constant time, no DB round-trip); the
  // session table is consulted only when the static map misses.
  const ownerAuth = new ChainOwnerAuth(staticAuth, new OauthSessionAuth(storage));
  // security-review-2026-05-07 §M7: prod deploys MUST have NONCES +
  // RATE_LIMITS KV bindings. Without them, replay protection and
  // rate limits silently degrade to per-isolate (broken across
  // Workers' rolling-isolate model). Fail closed when AAP_ENV is
  // "production"; allow in-memory fallback in dev / tests with the
  // legacy console.warn.
  const isProduction = env.AAP_ENV === "production";
  if (isProduction) {
    if (!env.NONCES) {
      throw new Error(
        "NONCES KV namespace not bound in production — per-isolate replay protection is " +
          "broken at scale. Bind a KV namespace in wrangler.jsonc and redeploy " +
          "(security-review-2026-05-07 §M7).",
      );
    }
    if (!env.RATE_LIMITS) {
      throw new Error(
        "RATE_LIMITS KV namespace not bound in production — per-isolate rate counters do " +
          "not survive isolate hops. Bind a KV namespace in wrangler.jsonc and redeploy " +
          "(security-review-2026-05-07 §M7).",
      );
    }
  }
  const nonceStore: NonceStore = env.NONCES
    ? new KvNonceStore(env.NONCES)
    : new InMemoryNonceStore();
  if (!env.NONCES) {
    console.warn(
      "[cloud-api] NONCES KV namespace not bound — /v1/nonces/check is per-isolate only (dev mode)",
    );
  }
  const rateLimiter: RateLimiter = env.RATE_LIMITS
    ? new KvRateLimiter(env.RATE_LIMITS)
    : new InMemoryRateLimiter();
  if (!env.RATE_LIMITS) {
    console.warn(
      "[cloud-api] RATE_LIMITS KV namespace not bound — rate-limit counters are per-isolate only (dev mode)",
    );
  }

  let oidc: OidcIssuer | undefined;
  if (env.OIDC_SIGNING_KEY && env.OIDC_ISSUER) {
    try {
      oidc = await OidcIssuer.create({
        privateKey: decodePrivateKey(env.OIDC_SIGNING_KEY),
        issuer: env.OIDC_ISSUER,
      });
    } catch (err) {
      console.error(
        "[cloud-api] OIDC_SIGNING_KEY/OIDC_ISSUER set but invalid — falling back to mock JWTs",
        err,
      );
    }
  } else {
    console.warn(
      "[cloud-api] OIDC_SIGNING_KEY or OIDC_ISSUER missing — POST /v1/agents will return mock JWTs",
    );
  }

  let stripe: StripeApiClient | undefined;
  if (env.STRIPE_SECRET_KEY) {
    stripe = new HttpStripeApiClient(env.STRIPE_SECRET_KEY);
  } else {
    console.warn(
      "[cloud-api] STRIPE_SECRET_KEY missing — /v1/connect/* will return 503 not_configured",
    );
  }

  let stripeWebhookVerifier: WebhookVerifier | undefined;
  if (env.STRIPE_WEBHOOK_SECRET) {
    stripeWebhookVerifier = new HmacWebhookVerifier(env.STRIPE_WEBHOOK_SECRET);
  } else {
    console.warn("[cloud-api] STRIPE_WEBHOOK_SECRET missing — /v1/stripe/webhook will return 503");
  }

  let githubOauth: CreateApiOptions["githubOauth"] | undefined;
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.OIDC_SIGNING_KEY) {
    try {
      const stateSigningKey = await deriveStateSigningKey(decodePrivateKey(env.OIDC_SIGNING_KEY));
      const config: GithubOauthConfig = {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
      };
      if (env.GITHUB_REDIRECT_URI) config.redirectUri = env.GITHUB_REDIRECT_URI;
      // security-review-2026-05-07 §H4: fail closed — require nonce
      // binding by default. The legacy GET /start path still works
      // for minting state (CI smoke tests, manual curl), but the
      // callback rejects any no-nonce state. Operators who need the
      // legacy callback flow set OAUTH_REQUIRE_NONCE="false" (dev
      // only — see apps/cloud/api/.dev.vars).
      const requireNonceBinding = env.OAUTH_REQUIRE_NONCE !== "false";
      githubOauth = {
        config,
        client: new GithubHttpClient(),
        stateSigningKey,
        requireNonceBinding,
      };
    } catch (err) {
      console.error(
        "[cloud-api] GitHub OAuth wiring failed (likely OIDC_SIGNING_KEY malformed) — /v1/auth/github/* will return 503",
        err,
      );
    }
  } else if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    console.warn(
      "[cloud-api] GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET missing — /v1/auth/github/* will return 503",
    );
  } else {
    console.warn(
      "[cloud-api] OIDC_SIGNING_KEY missing — /v1/auth/github/* will return 503 (state signing requires it)",
    );
  }

  const corsAllowList = (env.DASHBOARD_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return createApi({
    storage,
    ownerAuth,
    oidc,
    nonceStore,
    rateLimiter,
    corsAllowList,
    stripe,
    stripeWebhookVerifier,
    ...(githubOauth ? { githubOauth } : {}),
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!cached) cached = buildApp(env);
    const app = await cached;
    return app.fetch(request);
  },
} satisfies ExportedHandler<Env>;
