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
 *   GET  /v1/agents/:aid            resolve one
 *   POST /v1/audit/ingest           server-side audit log archival
 *   GET  /v1/conversations/:id      indexed audit query
 *   POST /v1/disputes               file a dispute case  [Bearer]
 *   GET  /v1/disputes/:id           read a case file (public-by-ID)
 *   POST /v1/nonces/check           reserve a nonce [Bearer]
 */

import { Hono } from "hono";
import { type OwnerAuthenticator, StaticOwnerAuth, parseOwnerTokens } from "./auth.js";
import { D1Storage } from "./d1-storage.js";
import { InMemoryNonceStore, KvNonceStore, type NonceStore } from "./nonces.js";
import { OidcIssuer, decodePrivateKey } from "./oidc.js";
import { InMemoryRateLimiter, KvRateLimiter, type RateLimiter } from "./rate-limit.js";
import { createAgentsRouter } from "./routes/agents.js";
import { createAuditRouter, createConversationsRouter } from "./routes/audit.js";
import { createDisputesRouter } from "./routes/disputes.js";
import { createNoncesRouter } from "./routes/nonces.js";
import { InMemoryStorage, type Storage } from "./storage.js";

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
  const app = new Hono();

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

  app.route("/v1/agents", createAgentsRouter({ storage, ownerAuth, oidc, rateLimiter }));
  app.route("/v1/audit", createAuditRouter(storage));
  app.route("/v1/conversations", createConversationsRouter(storage));
  app.route("/v1/disputes", createDisputesRouter({ storage, ownerAuth, rateLimiter }));
  app.route("/v1/nonces", createNoncesRouter({ ownerAuth, store: nonceStore, rateLimiter }));

  app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));

  app.onError((err, c) => {
    console.error("[cloud-api] unhandled error", err);
    return c.json({ error: "internal", message: err.message }, 500);
  });

  return app;
}

// Workers fetch handler. The app is cached per isolate as a promise so
// async setup (deriving the OIDC public key from the private one) only
// runs once per cold start.
let cached: Promise<Hono> | undefined;

async function buildApp(env: Env): Promise<Hono> {
  const storage: Storage = env.DB ? new D1Storage(env.DB) : new InMemoryStorage();
  const ownerAuth = new StaticOwnerAuth(parseOwnerTokens(env.OWNER_TOKENS));
  if (!ownerAuth.hasAnyTokens) {
    console.warn(
      "[cloud-api] OWNER_TOKENS not configured — POST /v1/agents will reject every request",
    );
  }
  const nonceStore: NonceStore = env.NONCES
    ? new KvNonceStore(env.NONCES)
    : new InMemoryNonceStore();
  if (!env.NONCES) {
    console.warn(
      "[cloud-api] NONCES KV namespace not bound — /v1/nonces/check is per-isolate only",
    );
  }
  const rateLimiter: RateLimiter = env.RATE_LIMITS
    ? new KvRateLimiter(env.RATE_LIMITS)
    : new InMemoryRateLimiter();
  if (!env.RATE_LIMITS) {
    console.warn(
      "[cloud-api] RATE_LIMITS KV namespace not bound — rate-limit counters are per-isolate only",
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

  return createApi({ storage, ownerAuth, oidc, nonceStore, rateLimiter });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!cached) cached = buildApp(env);
    const app = await cached;
    return app.fetch(request);
  },
} satisfies ExportedHandler<Env>;
