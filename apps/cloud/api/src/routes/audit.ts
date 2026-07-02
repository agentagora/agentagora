/**
 * /v1/audit and /v1/conversations — audit log ingest + read.
 *
 *   POST   /v1/audit/ingest             batch-ingest signed audit events
 *   GET    /v1/conversations/:id        read the chain for a conversation
 *
 * Auth model:
 *   The actor's signature on each event IS the auth — there is no
 *   separate bearer required to ingest. An ingester forging events
 *   would need the actor's private signing key (the same key already
 *   pinned to the AID by task #3). Bearer-gated read is also
 *   intentionally absent so disputes / inspectors can fetch a chain
 *   without coordinating credentials.
 */

import { type AuditEvent, AuditEventSchema } from "@agentagora/protocol";
import { Hono } from "hono";
import { b64uDecode, hashAuditEvent, verifyAuditEvent } from "../_crypto.js";
import type { OwnerAuthenticator } from "../auth.js";
import type { Storage } from "../storage.js";

interface IngestResultOk {
  ok: true;
  eventId: string;
}

interface IngestResultErr {
  ok: false;
  event_id: string;
  error: IngestErrorCode;
  message: string;
}

type IngestErrorCode =
  | "validation_error"
  | "unknown_actor"
  | "actor_unsigned"
  | "invalid_signature"
  | "broken_chain"
  | "duplicate_event";

export function createAuditRouter(storage: Storage): Hono {
  const router = new Hono();

  router.post("/ingest", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { events?: unknown } | null;
    if (!body || !Array.isArray(body.events)) {
      return c.json({ error: "invalid_body", message: "expected { events: AuditEvent[] }" }, 400);
    }

    const ingested: string[] = [];
    const rejected: Array<Omit<IngestResultErr, "ok">> = [];
    const ingestedAt = new Date().toISOString();

    // Sequential — chain validation requires reading the latest event
    // for a conversation, so parallel ingest in the same convo would
    // race. Across conversations this could parallelise; not worth
    // the complexity at v0.
    for (const raw of body.events) {
      const result = await ingestOne(raw, storage, ingestedAt);
      if (result.ok) {
        ingested.push(result.eventId);
      } else {
        const { ok: _ok, ...rest } = result;
        rejected.push(rest);
      }
    }

    const status = rejected.length === 0 ? 201 : 207; // 207 = multi-status
    return c.json({ ingested, rejected }, status);
  });

  return router;
}

interface ConversationsRouterDeps {
  storage: Storage;
  /** Required for the actor-scoped `?actor=` index; omit for the
   *  legacy public read-by-id only mount used by tests that don't
   *  exercise the index path. */
  ownerAuth?: OwnerAuthenticator;
}

export function createConversationsRouter(storageOrDeps: Storage | ConversationsRouterDeps): Hono {
  // Tolerate the historical `createConversationsRouter(storage)` shape
  // so existing test fixtures don't have to change. The owner-scoped
  // path is gated behind ownerAuth; without it the router still serves
  // GET /:id exactly as before. We discriminate by whether the arg has
  // a `getAgent` method — every Storage impl exposes it; the deps
  // bag is a plain object that doesn't.
  const isStorage = typeof (storageOrDeps as Partial<Storage>).getAgent === "function";
  const deps: ConversationsRouterDeps = isStorage
    ? { storage: storageOrDeps as Storage }
    : (storageOrDeps as ConversationsRouterDeps);
  const { storage, ownerAuth } = deps;
  const router = new Hono();

  // GET /v1/conversations?actor=<aid>  — owner-scoped index. Bearer
  // must own the AID. Without `?actor=` we fall through to the public
  // `:id` read below; mounted as a single Hono router so the existing
  // `/v1/conversations/:id` URL keeps working.
  router.get("/", async (c) => {
    const actor = c.req.query("actor");
    if (actor === undefined) {
      // No supported list mode without a filter today; return a hint
      // rather than a giant unscoped dump.
      return c.json(
        {
          error: "missing_filter",
          message: "specify ?actor=<aid> to list conversations for an actor you own",
        },
        400,
      );
    }
    if (!ownerAuth) {
      return c.json(
        {
          error: "not_configured",
          message: "owner authenticator is not wired into this conversations router",
        },
        503,
      );
    }
    const token = extractBearer(c.req.header("authorization"));
    if (!token) {
      return c.json({ error: "unauthorized", message: "missing bearer token" }, 401);
    }
    const ownerId = await ownerAuth.resolve(token);
    if (!ownerId) {
      return c.json({ error: "unauthorized", message: "invalid bearer token" }, 401);
    }
    const agent = await storage.getAgent(actor);
    if (!agent) {
      // The bearer may be valid but pointed at a ghost AID — treat
      // this as a 403 not a 404 because the request is fundamentally
      // a permissions claim against an AID that the bearer can't own.
      return c.json(
        {
          error: "forbidden",
          message: "actor AID does not exist or is not owned by the bearer",
        },
        403,
      );
    }
    if (agent.publishedBy !== ownerId) {
      return c.json(
        {
          error: "forbidden",
          message: "actor AID is not owned by the bearer",
        },
        403,
      );
    }

    const summaries = await storage.listConversationsByActor(actor);
    return c.json({
      total: summaries.length,
      conversations: summaries.map((s) => ({
        conversation_id: s.conversationId,
        first_seen_at: s.firstSeenAt,
        last_seen_at: s.lastSeenAt,
        event_count: s.eventCount,
        latest_event_type: s.latestEventType,
      })),
    });
  });

  router.get("/:id", async (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    const events = await storage.getConversationEvents(id);
    return c.json({
      conversation_id: id,
      total: events.length,
      events,
    });
  });

  return router;
}

function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}

async function ingestOne(
  raw: unknown,
  storage: Storage,
  ingestedAt: string,
): Promise<IngestResultOk | IngestResultErr> {
  const parsed = AuditEventSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      event_id: extractEventId(raw),
      error: "validation_error",
      message: parsed.error.issues[0]?.message ?? "schema validation failed",
    };
  }
  const event = parsed.data;

  if (await storage.hasAuditEvent(event.event_id)) {
    // Idempotent re-ingest: report duplicate but don't reject the
    // batch. Caller can treat duplicates as success.
    return {
      ok: false,
      event_id: event.event_id,
      error: "duplicate_event",
      message: `event ${event.event_id} already ingested`,
    };
  }

  const actor = await storage.getAgent(event.actor_aid);
  if (!actor) {
    return {
      ok: false,
      event_id: event.event_id,
      error: "unknown_actor",
      message: `actor ${event.actor_aid} has not published a manifest`,
    };
  }
  if (!actor.pubkey) {
    return {
      ok: false,
      event_id: event.event_id,
      error: "actor_unsigned",
      message: `actor ${event.actor_aid} has no pinned signing key`,
    };
  }

  let pubkeyBytes: Uint8Array;
  try {
    pubkeyBytes = b64uDecode(actor.pubkey);
  } catch {
    return {
      ok: false,
      event_id: event.event_id,
      error: "actor_unsigned",
      message: `actor ${event.actor_aid} has a malformed pinned key`,
    };
  }

  const sigOk = await verifyAuditEvent(event, pubkeyBytes);
  if (!sigOk) {
    return {
      ok: false,
      event_id: event.event_id,
      error: "invalid_signature",
      message: "audit event signature does not verify against the actor's pinned key",
    };
  }

  const latest = await storage.getLatestAuditEvent(event.conversation_id, event.actor_aid);
  const expectedPrev = latest ? hashAuditEvent(latest) : null;
  if (event.previous_event_hash !== expectedPrev) {
    return {
      ok: false,
      event_id: event.event_id,
      error: "broken_chain",
      message: `previous_event_hash mismatch: expected ${expectedPrev}, got ${event.previous_event_hash}`,
    };
  }

  await storage.ingestAuditEvent(event, ingestedAt);
  return { ok: true, eventId: event.event_id };
}

function extractEventId(raw: unknown): string {
  if (raw && typeof raw === "object" && "event_id" in raw) {
    const id = (raw as { event_id: unknown }).event_id;
    if (typeof id === "string") return id;
  }
  return "<unknown>";
}

// Re-export for tests that want to assert on the AuditEvent shape.
export type { AuditEvent };
