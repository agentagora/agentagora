/**
 * /v1/nonces — global nonce dedup.
 *
 *   POST /v1/nonces/check   reserve a nonce; 200 first-seen, 409 replay
 *
 * Receivers consult this endpoint before honouring an incoming request
 * so replays across Worker isolates / cold restarts are caught — the
 * SDK's in-process NonceTracker handles a single isolate only.
 *
 * Auth: Bearer. The resolved owner ID prefixes every key under the
 * hood, so each owner has its own nonce namespace and one tenant
 * cannot poison another's namespace.
 */

import { Hono } from "hono";
import type { OwnerAuthenticator } from "../auth.js";
import type { NonceStore } from "../nonces.js";

interface RouterDeps {
  ownerAuth: OwnerAuthenticator;
  store: NonceStore;
  /** Default TTL when the body omits `ttl_seconds`. KV's floor is 60s. */
  defaultTtlSeconds?: number;
}

const TTL_MIN = 60;
const TTL_MAX = 24 * 3600;

export function createNoncesRouter({
  ownerAuth,
  store,
  defaultTtlSeconds = 600,
}: RouterDeps): Hono {
  const router = new Hono();

  router.post("/check", async (c) => {
    const token = extractBearer(c.req.header("authorization"));
    if (!token) {
      return c.json({ error: "unauthorized", message: "missing bearer token" }, 401);
    }
    const ownerId = await ownerAuth.resolve(token);
    if (!ownerId) {
      return c.json({ error: "unauthorized", message: "invalid bearer token" }, 401);
    }

    const raw = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") {
      return c.json({ error: "invalid_body", message: "body must be a JSON object" }, 400);
    }
    if (typeof raw.key !== "string" || raw.key.length === 0 || raw.key.length > 256) {
      return c.json(
        {
          error: "invalid_body",
          field: "key",
          message: "key must be a non-empty string ≤ 256 chars",
        },
        400,
      );
    }
    let ttl = defaultTtlSeconds;
    if (raw.ttl_seconds !== undefined) {
      if (typeof raw.ttl_seconds !== "number" || !Number.isInteger(raw.ttl_seconds)) {
        return c.json(
          {
            error: "invalid_body",
            field: "ttl_seconds",
            message: "ttl_seconds must be an integer",
          },
          400,
        );
      }
      if (raw.ttl_seconds < TTL_MIN || raw.ttl_seconds > TTL_MAX) {
        return c.json(
          {
            error: "invalid_body",
            field: "ttl_seconds",
            message: `ttl_seconds must be in [${TTL_MIN}, ${TTL_MAX}]`,
          },
          400,
        );
      }
      ttl = raw.ttl_seconds;
    }

    // Prefix with the owner ID so two tenants can never collide on
    // each other's nonce namespace. The bearer-resolved owner is
    // authoritative — clients never send their own ownerId.
    const scoped = `nonce/${ownerId}/${raw.key}`;
    const result = await store.check(scoped, ttl);

    const status = result.firstSeen ? 200 : 409;
    return c.json(
      {
        first_seen: result.firstSeen,
        expires_at: result.expiresAt,
      },
      status,
    );
  });

  return router;
}

function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}
