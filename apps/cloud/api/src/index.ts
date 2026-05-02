/**
 * AgentAgora Cloud API.
 *
 * Hono on Cloudflare Workers. Per docs/tech-stack.md §4-6 the Cloud
 * Platform is the control plane only — discovery, identity issuance,
 * settlement coordination, audit indexing, dispute intake. Never on
 * the agent-to-agent data path.
 *
 * Surface (this file):
 *   GET  /                  metadata
 *   GET  /healthz           liveness
 *   POST /v1/agents         publish manifest [Bearer auth, OWNER_TOKENS]
 *   GET  /v1/agents         list / search registered agents
 *   GET  /v1/agents/:aid    resolve one
 *
 * Still pending:
 *   POST /v1/oidc/token     identity issuance (real JWT, not mock) — task #4
 *   POST /v1/disputes       open a dispute → council intake
 *   POST /v1/audit/ingest   server-side audit log archival
 *   GET  /v1/conversations/:id   indexed audit query
 */

import { Hono } from "hono";
import { type OwnerAuthenticator, StaticOwnerAuth, parseOwnerTokens } from "./auth.js";
import { D1Storage } from "./d1-storage.js";
import { createAgentsRouter } from "./routes/agents.js";
import { InMemoryStorage, type Storage } from "./storage.js";

/**
 * Worker bindings. `DB` lands in v0.0.2 (D1 registry persistence).
 * Phase 3 still adds: AUDIT (R2), NONCE (KV), OIDC_KEY (secret).
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
}

/**
 * Build a Hono app instance. Tests use `app.request()` directly;
 * production wraps it as the Worker fetch handler.
 */
export function createApi(options: CreateApiOptions = {}): Hono {
  const storage = options.storage ?? new InMemoryStorage();
  const ownerAuth = options.ownerAuth ?? new StaticOwnerAuth({});
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

  app.route("/v1/agents", createAgentsRouter({ storage, ownerAuth }));

  app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));

  app.onError((err, c) => {
    console.error("[cloud-api] unhandled error", err);
    return c.json({ error: "internal", message: err.message }, 500);
  });

  return app;
}

// Workers fetch handler. The app is cached per isolate; storage is
// chosen once based on whether the D1 binding is present (production)
// or absent (e.g. unit tests, dry-run deploy without bindings, local
// dev before `wrangler d1 create`).
let cached: Hono | undefined;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!cached) {
      const storage: Storage = env.DB ? new D1Storage(env.DB) : new InMemoryStorage();
      const ownerAuth = new StaticOwnerAuth(parseOwnerTokens(env.OWNER_TOKENS));
      if (!ownerAuth.hasAnyTokens) {
        console.warn(
          "[cloud-api] OWNER_TOKENS not configured — POST /v1/agents will reject every request",
        );
      }
      cached = createApi({ storage, ownerAuth });
    }
    return cached.fetch(request);
  },
} satisfies ExportedHandler<Env>;
