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
import { b64uDecode, canonicalizeJsonBytes, verifyEd25519 } from "../_crypto.js";
import type { OwnerAuthenticator } from "../auth.js";
import type { AgentRecord, Storage } from "../storage.js";

interface RouterDeps {
  storage: Storage;
  ownerAuth: OwnerAuthenticator;
}

export function createAgentsRouter({ storage, ownerAuth }: RouterDeps): Hono {
  const router = new Hono();

  // Publish or update a manifest. Three checks, in order:
  //   1. Bearer token resolves to an owner          → 401 if not
  //   2. Detached Ed25519 signature verifies        → 401 if not
  //   3. Owner + pubkey match the existing record   → 403 if not
  router.post("/", async (c) => {
    const token = extractBearer(c.req.header("authorization"));
    if (!token) {
      return c.json({ error: "unauthorized", message: "missing bearer token" }, 401);
    }
    const ownerId = await ownerAuth.resolve(token);
    if (!ownerId) {
      return c.json({ error: "unauthorized", message: "invalid bearer token" }, 401);
    }

    const pubkeyHeader = c.req.header("x-aap-pubkey");
    const sigHeader = c.req.header("x-aap-signature");
    if (!pubkeyHeader || !sigHeader) {
      return c.json(
        {
          error: "missing_signature",
          message: "X-AAP-Pubkey and X-AAP-Signature headers are required",
        },
        400,
      );
    }
    let pubkeyBytes: Uint8Array;
    let sigBytes: Uint8Array;
    try {
      pubkeyBytes = b64uDecode(pubkeyHeader);
      sigBytes = b64uDecode(sigHeader);
    } catch {
      return c.json(
        { error: "malformed_signature", message: "pubkey/signature must be base64url" },
        400,
      );
    }
    if (pubkeyBytes.length !== 32 || sigBytes.length !== 64) {
      return c.json(
        {
          error: "malformed_signature",
          message: "expected 32-byte Ed25519 public key and 64-byte signature",
        },
        400,
      );
    }

    const raw = await c.req.json().catch(() => null);
    if (raw === null || typeof raw !== "object") {
      return c.json({ error: "invalid_manifest", message: "body must be a JSON object" }, 400);
    }

    // Verify the signature against the JSON the client actually posted,
    // before applying any Zod transforms / defaults — the client and
    // server must canonicalize exactly the same value.
    let canonical: Uint8Array;
    try {
      canonical = canonicalizeJsonBytes(raw);
    } catch (err) {
      return c.json({ error: "noncanonical_manifest", message: (err as Error).message }, 400);
    }
    const sigOk = await verifyEd25519(sigBytes, canonical, pubkeyBytes);
    if (!sigOk) {
      return c.json({ error: "unauthorized", message: "manifest signature does not verify" }, 401);
    }

    const parsed = ManifestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_manifest", issues: parsed.error.issues }, 400);
    }
    const manifest = parsed.data;

    const existing = await storage.getAgent(manifest.aid);
    if (existing) {
      if (existing.publishedBy !== ownerId) {
        return c.json(
          {
            error: "forbidden",
            message: `aid ${manifest.aid} is owned by a different account`,
          },
          403,
        );
      }
      if (existing.pubkey && existing.pubkey !== pubkeyHeader) {
        return c.json(
          {
            error: "forbidden",
            message: `aid ${manifest.aid} is pinned to a different signing key`,
          },
          403,
        );
      }
    }

    const record: AgentRecord = {
      manifest,
      // Mock JWT until task #4 wires real OIDC issuance.
      identityJwt: `mock.jwt.${manifest.aid.replace(/[:/]/g, "_")}`,
      publishedAt: new Date().toISOString(),
      publishedBy: ownerId,
      pubkey: pubkeyHeader,
    };
    await storage.putAgent(record);
    return c.json(
      {
        aid: manifest.aid,
        identity_jwt: record.identityJwt,
        published_at: record.publishedAt,
        published_by: record.publishedBy,
        pubkey: record.pubkey,
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
