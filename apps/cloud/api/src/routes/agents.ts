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
import type { OidcIssuer } from "../oidc.js";
import { DEFAULT_LIMITS, type RateLimiter, enforceRateLimit } from "../rate-limit.js";
import type { AgentRecord, Storage } from "../storage.js";

interface RouterDeps {
  storage: Storage;
  ownerAuth: OwnerAuthenticator;
  /** When absent, the route falls back to a deterministic mock JWT
   *  (dev/test convenience; production must always wire an issuer). */
  oidc?: OidcIssuer;
  /** Optional per-owner publish rate limiter. */
  rateLimiter?: RateLimiter;
}

export function createAgentsRouter({ storage, ownerAuth, oidc, rateLimiter }: RouterDeps): Hono {
  const router = new Hono();

  // Publish or update a manifest. Four checks, in order:
  //   1. Bearer token resolves to an owner          → 401 if not
  //   2. Per-owner rate limit                       → 429 if exhausted
  //   3. Detached Ed25519 signature verifies        → 401 if not
  //   4. Owner + pubkey match the existing record   → 403 if not
  router.post("/", async (c) => {
    const token = extractBearer(c.req.header("authorization"));
    if (!token) {
      return c.json({ error: "unauthorized", message: "missing bearer token" }, 401);
    }
    const ownerId = await ownerAuth.resolve(token);
    if (!ownerId) {
      return c.json({ error: "unauthorized", message: "invalid bearer token" }, 401);
    }
    if (rateLimiter) {
      const reject = await enforceRateLimit(
        c,
        rateLimiter,
        `${ownerId}:publish`,
        DEFAULT_LIMITS.publish,
      );
      if (reject) return reject;
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
      // security-review-2026-05 §M2: legacy / failed-migration rows
      // can have an empty `pubkey` (the column was added with
      // `NOT NULL DEFAULT ''` in 0002_pubkey.sql). The previous truthy
      // guard `existing.pubkey && …` short-circuited on those rows,
      // letting any owner-controlled bearer rotate the signing key
      // past the TOFU pin. Compare against the empty string explicitly
      // so an empty pin always fails closed against a presented key.
      const pinnedPubkey = existing.pubkey;
      if (pinnedPubkey !== "" && pinnedPubkey !== pubkeyHeader) {
        return c.json(
          {
            error: "forbidden",
            message: `aid ${manifest.aid} is pinned to a different signing key`,
          },
          403,
        );
      }
      if (pinnedPubkey === "") {
        return c.json(
          {
            error: "forbidden",
            message: `aid ${manifest.aid} has no pinned signing key — contact ops to reset`,
          },
          403,
        );
      }
    }

    const identityJwt = oidc
      ? await oidc.issue({ manifest, ownerId, publisherPubkey: pubkeyHeader })
      : `mock.jwt.${manifest.aid.replace(/[:/]/g, "_")}`;

    const record: AgentRecord = {
      manifest,
      identityJwt,
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
      published_by: record.publishedBy,
      // The TOFU-pinned signing key. Advisory only — verifiers SHOULD
      // extract the pubkey from the identity_jwt (registry-signed) rather
      // than trusting this raw field; it exists so the dashboard detail
      // view can render the pin without JWT parsing.
      pubkey: record.pubkey,
    });
  });

  // List / search. The `?owner=<id>` mode is bearer-gated (closed
  // alpha: only self-lookup) and bypasses the capability/accepts/q
  // filters — they're list-time hints meant for catalog browsing, not
  // for "what do I own". Mixing them silently would just be confusing.
  router.get("/", async (c) => {
    const owner = c.req.query("owner");
    if (owner !== undefined) {
      const token = extractBearer(c.req.header("authorization"));
      if (!token) {
        return c.json({ error: "unauthorized", message: "missing bearer token" }, 401);
      }
      const ownerId = await ownerAuth.resolve(token);
      if (!ownerId) {
        return c.json({ error: "unauthorized", message: "invalid bearer token" }, 401);
      }
      // Closed alpha: bearer's resolved owner must equal ?owner=<id>.
      // No admin-override path yet — when one lands it'll branch here.
      if (ownerId !== owner) {
        return c.json(
          {
            error: "forbidden",
            message: "owner query param does not match the bearer's owner",
          },
          403,
        );
      }
      const records = await storage.listAgentsByOwner(ownerId);
      return c.json({
        total: records.length,
        agents: records.map(viewAgent),
      });
    }

    const capability = c.req.query("capability");
    const accepts = c.req.query("accepts");
    const q = c.req.query("q");

    const records =
      capability || accepts || q
        ? await storage.searchAgents({ capability, accepts, q })
        : await storage.listAgents();

    return c.json({
      total: records.length,
      agents: records.map(viewAgent),
    });
  });

  return router;
}

function viewAgent(rec: AgentRecord): {
  aid: string;
  description: string | undefined;
  capabilities: { name: string; pricing: unknown; accepts: string[] }[];
  published_at: string;
} {
  return {
    aid: rec.manifest.aid,
    description: rec.manifest.description,
    capabilities: rec.manifest.capabilities.map((cap) => ({
      name: cap.name,
      pricing: cap.pricing,
      accepts: cap.accepts,
    })),
    published_at: rec.publishedAt,
  };
}

function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}
