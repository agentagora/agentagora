/**
 * /v1/agents — registry endpoints.
 *
 *   POST   /v1/agents              publish (or update) a manifest  [auth required]
 *   GET    /v1/agents              search / list                   [public]
 *   GET    /v1/agents/:aid         resolve one                     [public]
 *
 * The dispute, settlement, and OIDC routes live in sibling files
 * once they exist; keeping each route group in its own file so the
 * Hono entry stays a directory of mounts.
 */

import { ManifestSchema } from "@agentagora/protocol";
import { Hono } from "hono";
import type { OwnerAuthenticator } from "../auth.js";
import type { AgentRecord, Storage } from "../storage.js";

interface RouterDeps {
  storage: Storage;
  ownerAuth: OwnerAuthenticator;
}

export function createAgentsRouter({ storage, ownerAuth }: RouterDeps): Hono {
  const router = new Hono();

  // Publish or update a manifest. Requires a bearer token; updates
  // are restricted to the owner that originally published the AID.
  router.post("/", async (c) => {
    const token = extractBearer(c.req.header("authorization"));
    if (!token) {
      return c.json({ error: "unauthorized", message: "missing bearer token" }, 401);
    }
    const ownerId = await ownerAuth.resolve(token);
    if (!ownerId) {
      return c.json({ error: "unauthorized", message: "invalid bearer token" }, 401);
    }

    // Validate body explicitly so we can short-circuit on auth before
    // accepting/rejecting the manifest payload.
    const parsed = ManifestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "invalid_manifest", issues: parsed.error.issues }, 400);
    }
    const manifest = parsed.data;

    const existing = await storage.getAgent(manifest.aid);
    if (existing && existing.publishedBy !== ownerId) {
      return c.json(
        {
          error: "forbidden",
          message: `aid ${manifest.aid} is owned by a different account`,
        },
        403,
      );
    }

    const record: AgentRecord = {
      manifest,
      // Mock JWT until task #4 wires real OIDC issuance.
      identityJwt: `mock.jwt.${manifest.aid.replace(/[:/]/g, "_")}`,
      publishedAt: new Date().toISOString(),
      publishedBy: ownerId,
    };
    await storage.putAgent(record);
    return c.json(
      {
        aid: manifest.aid,
        identity_jwt: record.identityJwt,
        published_at: record.publishedAt,
        published_by: record.publishedBy,
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

function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}
