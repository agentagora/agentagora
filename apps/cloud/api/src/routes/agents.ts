/**
 * /v1/agents — registry endpoints.
 *
 *   POST   /v1/agents              publish (or update) a manifest
 *   GET    /v1/agents              search / list
 *   GET    /v1/agents/:aid         resolve one
 *
 * The dispute, settlement, and OIDC routes live in sibling files
 * once they exist; keeping each route group in its own file so the
 * Hono entry stays a directory of mounts.
 */

import { ManifestSchema } from "@agentagora/protocol";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { AgentRecord, Storage } from "../storage.js";

export function createAgentsRouter(storage: Storage): Hono {
  const router = new Hono();

  // Publish or update a manifest.
  router.post("/", zValidator("json", ManifestSchema), async (c) => {
    const manifest = c.req.valid("json");
    const record: AgentRecord = {
      manifest,
      // Mock JWT until Phase 3 wires real OIDC issuance.
      identityJwt: `mock.jwt.${manifest.aid.replace(/[:/]/g, "_")}`,
      publishedAt: new Date().toISOString(),
      publishedBy: "anonymous",
    };
    await storage.putAgent(record);
    return c.json(
      {
        aid: manifest.aid,
        identity_jwt: record.identityJwt,
        published_at: record.publishedAt,
      },
      201,
    );
  });

  // Resolve one AID.
  router.get("/:aid", async (c) => {
    const aid = decodeURIComponent(c.req.param("aid"));
    const record = await storage.getAgent(aid);
    if (!record) {
      return c.json({ error: "not_found", message: `agent ${aid} not found` }, 404);
    }
    return c.json({
      aid: record.manifest.aid,
      manifest: record.manifest,
      identity_jwt: record.identityJwt,
      published_at: record.publishedAt,
    });
  });

  // List / search.
  router.get("/", async (c) => {
    const capability = c.req.query("capability");
    const accepts = c.req.query("accepts");
    const q = c.req.query("q");

    const records =
      capability || accepts || q
        ? await storage.searchAgents({ capability, accepts, q })
        : await storage.listAgents();

    return c.json({
      total: records.length,
      agents: records.map((rec) => ({
        aid: rec.manifest.aid,
        description: rec.manifest.description,
        capabilities: rec.manifest.capabilities.map((cap) => ({
          name: cap.name,
          pricing: cap.pricing,
          accepts: cap.accepts,
        })),
        published_at: rec.publishedAt,
      })),
    });
  });

  return router;
}
