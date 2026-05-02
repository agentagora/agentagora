/**
 * AgentAgora Cloud API.
 *
 * Hono on Cloudflare Workers. Per docs/tech-stack.md §4-6 the Cloud
 * Platform is the control plane only — discovery, identity issuance,
 * settlement coordination, audit indexing, dispute intake. Never on
 * the agent-to-agent data path.
 *
 * v0.0.1 surface (this file):
 *   GET  /                  metadata
 *   GET  /healthz           liveness
 *   POST /v1/agents         publish manifest (validated against AAP schema)
 *   GET  /v1/agents         list / search registered agents
 *   GET  /v1/agents/:aid    resolve one
 *
 * Coming in Phase 3:
 *   POST /v1/oidc/token     identity issuance (real JWT, not mock)
 *   POST /v1/disputes       open a dispute → council intake
 *   POST /v1/audit/ingest   server-side audit log archival
 *   GET  /v1/conversations/:id   indexed audit query
 */

import { Hono } from "hono";
import { createAgentsRouter } from "./routes/agents.js";
import { InMemoryStorage, type Storage } from "./storage.js";

/**
 * Worker bindings. Empty in v0.0.1 — Phase 3 will add:
 *   DB: D1Database, AUDIT: R2Bucket, NONCE: KVNamespace,
 *   OIDC_KEY: string (JWT signing key).
 */
export type Env = Record<string, never>;

export interface CreateApiOptions {
  /** Pluggable storage. Defaults to InMemoryStorage (per-isolate). */
  storage?: Storage;
}

/**
 * Build a Hono app instance. Tests use `app.request()` directly;
 * production wraps it as the Worker fetch handler.
 */
export function createApi(options: CreateApiOptions = {}): Hono {
  const storage = options.storage ?? new InMemoryStorage();
  const app = new Hono();

  app.get("/", (c) =>
    c.json({
      name: "AgentAgora Cloud API",
      version: "0.0.1",
      status: "pre-alpha",
      docs: "https://github.com/agentagora/agentagora/tree/main/docs",
    }),
  );

  app.get("/healthz", (c) => c.json({ ok: true, version: "0.0.1" }));

  app.route("/v1/agents", createAgentsRouter(storage));

  app.notFound((c) => c.json({ error: "not_found", path: c.req.path }, 404));

  app.onError((err, c) => {
    console.error("[cloud-api] unhandled error", err);
    return c.json({ error: "internal", message: err.message }, 500);
  });

  return app;
}

// Workers fetch handler. Storage is per-isolate (in-memory) until D1
// binding lands; once bound, the cached app is replaced with one
// holding D1Storage.
let cached: Hono | undefined;

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    if (!cached) cached = createApi();
    return cached.fetch(request);
  },
} satisfies ExportedHandler<Env>;
