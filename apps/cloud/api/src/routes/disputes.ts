/**
 * /v1/disputes — case-file intake.
 *
 *   POST /v1/disputes        file a dispute    [Bearer]
 *   GET  /v1/disputes/:id    read the case file (public-by-ID)
 *
 * Per PRD §16, M2 closed alpha uses team adjudication: the route
 * captures the case file, ops resolves out-of-band by writing back
 * resolution / state via direct DB. Council voting and a state
 * machine land in a later phase.
 *
 * GET is intentionally not bearer-gated — dispute IDs are unguessable
 * (UUIDv4-equivalent random) and public case files seed the
 * "公开判例" (public precedent) library called out in the PRD.
 */

import { Hono } from "hono";
import type { OwnerAuthenticator } from "../auth.js";
import { DEFAULT_LIMITS, type RateLimiter, enforceRateLimit } from "../rate-limit.js";
import type { DisputeReason, DisputeRecord, Storage } from "../storage.js";

interface RouterDeps {
  storage: Storage;
  ownerAuth: OwnerAuthenticator;
  /** Generates an opaque dispute_id. Tests pass a deterministic stub. */
  newDisputeId?: () => string;
  /** Override the wall clock for deterministic tests. */
  now?: () => Date;
  /** Optional per-owner dispute filing rate limiter. */
  rateLimiter?: RateLimiter;
}

const REASONS: DisputeReason[] = ["non_delivery", "wrong_output", "fraud", "other"];
const NARRATIVE_MAX = 8192;
const REMEDY_MAX = 256;

interface FilingBody {
  conversation_id: string;
  filer_aid: string;
  respondent_aid: string;
  reason: DisputeReason;
  narrative?: string;
  claimed_remedy?: string;
}

interface ValidationFailure {
  ok: false;
  field: string;
  message: string;
}

function parseFilingBody(raw: unknown): { ok: true; value: FilingBody } | ValidationFailure {
  if (!raw || typeof raw !== "object") {
    return { ok: false, field: "$", message: "body must be a JSON object" };
  }
  const r = raw as Record<string, unknown>;
  const requiredString = (key: string): string | ValidationFailure => {
    const v = r[key];
    if (typeof v !== "string" || v.length === 0) {
      return { ok: false, field: key, message: `${key} must be a non-empty string` };
    }
    return v;
  };
  const cid = requiredString("conversation_id");
  if (typeof cid !== "string") return cid;
  const fid = requiredString("filer_aid");
  if (typeof fid !== "string") return fid;
  const rid = requiredString("respondent_aid");
  if (typeof rid !== "string") return rid;

  const reasonRaw = r.reason;
  if (typeof reasonRaw !== "string" || !REASONS.includes(reasonRaw as DisputeReason)) {
    return {
      ok: false,
      field: "reason",
      message: `reason must be one of: ${REASONS.join(", ")}`,
    };
  }

  const out: FilingBody = {
    conversation_id: cid,
    filer_aid: fid,
    respondent_aid: rid,
    reason: reasonRaw as DisputeReason,
  };

  if (r.narrative !== undefined) {
    if (typeof r.narrative !== "string" || r.narrative.length > NARRATIVE_MAX) {
      return {
        ok: false,
        field: "narrative",
        message: `narrative must be a string ≤ ${NARRATIVE_MAX} chars`,
      };
    }
    out.narrative = r.narrative;
  }
  if (r.claimed_remedy !== undefined) {
    if (typeof r.claimed_remedy !== "string" || r.claimed_remedy.length > REMEDY_MAX) {
      return {
        ok: false,
        field: "claimed_remedy",
        message: `claimed_remedy must be a string ≤ ${REMEDY_MAX} chars`,
      };
    }
    out.claimed_remedy = r.claimed_remedy;
  }

  return { ok: true, value: out };
}

export function createDisputesRouter({
  storage,
  ownerAuth,
  newDisputeId = defaultDisputeId,
  now = () => new Date(),
  rateLimiter,
}: RouterDeps): Hono {
  const router = new Hono();

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
        `${ownerId}:dispute`,
        DEFAULT_LIMITS.dispute,
      );
      if (reject) return reject;
    }

    const parsed = parseFilingBody(await c.req.json().catch(() => null));
    if (!parsed.ok) {
      return c.json({ error: "invalid_body", field: parsed.field, message: parsed.message }, 400);
    }
    const body = parsed.value;

    // The conversation must actually exist — otherwise dispute filing
    // becomes a free-text spam channel against arbitrary AIDs.
    const events = await storage.getConversationEvents(body.conversation_id);
    if (events.length === 0) {
      return c.json(
        {
          error: "conversation_not_found",
          message: `no audit events recorded for ${body.conversation_id}`,
        },
        404,
      );
    }

    // Filer must own the AID they're filing on behalf of.
    const filer = await storage.getAgent(body.filer_aid);
    if (!filer) {
      return c.json(
        { error: "unknown_filer", message: `filer_aid ${body.filer_aid} is not registered` },
        400,
      );
    }
    if (filer.publishedBy !== ownerId) {
      return c.json(
        {
          error: "forbidden",
          message: `filer_aid ${body.filer_aid} is not owned by the calling account`,
        },
        403,
      );
    }

    // Respondent must be a known agent — disputes against ghosts are
    // unactionable. (We do NOT require them to have appeared in the
    // conversation; that's a judgement-time check, not intake.)
    const respondent = await storage.getAgent(body.respondent_aid);
    if (!respondent) {
      return c.json(
        {
          error: "unknown_respondent",
          message: `respondent_aid ${body.respondent_aid} is not registered`,
        },
        400,
      );
    }

    const record: DisputeRecord = {
      disputeId: newDisputeId(),
      conversationId: body.conversation_id,
      filedBy: ownerId,
      filerAid: body.filer_aid,
      respondentAid: body.respondent_aid,
      reason: body.reason,
      state: "open",
      filedAt: now().toISOString(),
    };
    if (body.narrative !== undefined) record.narrative = body.narrative;
    if (body.claimed_remedy !== undefined) record.claimedRemedy = body.claimed_remedy;

    await storage.createDispute(record);

    return c.json(disputeView(record), 201);
  });

  router.get("/:id", async (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    const record = await storage.getDispute(id);
    if (!record) {
      return c.json({ error: "not_found", message: `dispute ${id} not found` }, 404);
    }
    return c.json(disputeView(record));
  });

  return router;
}

function disputeView(record: DisputeRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {
    dispute_id: record.disputeId,
    conversation_id: record.conversationId,
    filed_by: record.filedBy,
    filer_aid: record.filerAid,
    respondent_aid: record.respondentAid,
    reason: record.reason,
    state: record.state,
    filed_at: record.filedAt,
  };
  if (record.narrative !== undefined) out.narrative = record.narrative;
  if (record.claimedRemedy !== undefined) out.claimed_remedy = record.claimedRemedy;
  if (record.resolvedAt !== undefined) out.resolved_at = record.resolvedAt;
  if (record.resolution !== undefined) out.resolution = record.resolution;
  return out;
}

function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}

/**
 * Default ID generator: 128 random bits, base64url-encoded. Workers
 * provide `crypto.randomUUID` and `crypto.getRandomValues`; using
 * getRandomValues + base64url avoids the dash-separated UUID look,
 * which doesn't add value here.
 */
function defaultDisputeId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return `disp_${btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}
