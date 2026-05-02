/**
 * Dispute intake tests.
 *
 *   POST /v1/disputes  →  201 dispute_id, 401 no bearer, 400 bad body,
 *                         403 not-the-owner, 404 unknown conversation,
 *                         400 unknown filer/respondent
 *   GET  /v1/disputes/:id  →  200 with case file, 404 unknown
 */

import { describe, expect, it } from "vitest";
import { StaticOwnerAuth } from "../src/auth.js";
import { createApi } from "../src/index.js";
import { InMemoryStorage } from "../src/storage.js";
import {
  type AuditEventDraft,
  type SigningKey,
  generateSigningKey,
  signAuditEvent,
  signManifest,
} from "./_signing.js";

const ALICE_AID = "aid:agentagora:alice/code-review";
const BOB_AID = "aid:agentagora:bob/translator";
const CONVO = "convo-dispute-0001";

const aliceManifest = {
  manifest_version: 1 as const,
  aid: ALICE_AID,
  description: "Reviews PRs",
  endpoints: { rpc: "https://example.com/aap/v1/rpc" },
  capabilities: [
    {
      name: "review_pull_request",
      input_schema: { type: "object" },
      output_schema: { type: "object" },
      pricing: { model: "per_call" as const, amount: "0.50", currency: "USD" },
      accepts: ["stripe-fiat"],
    },
  ],
};

const bobManifest = {
  ...aliceManifest,
  aid: BOB_AID,
  description: "Translates",
  capabilities: [
    {
      name: "translate",
      input_schema: { type: "object" },
      output_schema: { type: "object" },
      pricing: { model: "free" as const },
      accepts: [],
    },
  ],
};

interface SetupResult {
  app: ReturnType<typeof createApi>;
  storage: InMemoryStorage;
  aliceKey: SigningKey;
  bobKey: SigningKey;
}

async function setup(): Promise<SetupResult> {
  const aliceKey = await generateSigningKey(1);
  const bobKey = await generateSigningKey(2);
  const storage = new InMemoryStorage();
  const ownerAuth = new StaticOwnerAuth({ "tok-alice": "alice", "tok-bob": "bob" });
  const app = createApi({ storage, ownerAuth });

  // Both agents publish so their pubkeys are pinned.
  for (const [token, manifest, key] of [
    ["tok-alice", aliceManifest, aliceKey],
    ["tok-bob", bobManifest, bobKey],
  ] as const) {
    const signed = await signManifest(manifest, key);
    const res = await app.request("/v1/agents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-aap-pubkey": signed.pubkey,
        "x-aap-signature": signed.signature,
      },
      body: JSON.stringify(manifest),
    });
    if (res.status !== 201) throw new Error(`setup publish failed (${res.status})`);
  }

  // Seed an audit event so CONVO exists.
  const draft: AuditEventDraft = {
    event_id: "evt-0001",
    conversation_id: CONVO,
    type: "rpc.request.received",
    timestamp: "2026-05-01T00:00:00.000Z",
    actor_aid: ALICE_AID,
    previous_event_hash: null,
    data: {},
  };
  const event = await signAuditEvent(draft, aliceKey);
  const ingest = await app.request("/v1/audit/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events: [event] }),
  });
  if (ingest.status !== 201) throw new Error(`setup audit ingest failed (${ingest.status})`);

  return { app, storage, aliceKey, bobKey };
}

interface FileBody {
  conversation_id: string;
  filer_aid: string;
  respondent_aid: string;
  reason: string;
  narrative?: string;
  claimed_remedy?: string;
}

interface FileOptions {
  token?: string | null; // null → omit Authorization header entirely
}

async function file(
  app: ReturnType<typeof createApi>,
  body: Partial<FileBody>,
  options: FileOptions = {},
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = options.token === undefined ? "tok-alice" : options.token;
  if (token !== null) headers.authorization = `Bearer ${token}`;
  const merged: FileBody = {
    conversation_id: CONVO,
    filer_aid: ALICE_AID,
    respondent_aid: BOB_AID,
    reason: "non_delivery",
    ...body,
  };
  return app.request("/v1/disputes", {
    method: "POST",
    headers,
    body: JSON.stringify(merged),
  });
}

describe("POST /v1/disputes — happy path", () => {
  it("files a dispute and returns the case file (201)", async () => {
    const { app, storage } = await setup();
    const res = await file(app, {
      narrative: "Output never arrived after payment cleared",
      claimed_remedy: "refund",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      dispute_id: string;
      conversation_id: string;
      filed_by: string;
      filer_aid: string;
      respondent_aid: string;
      reason: string;
      state: string;
      narrative: string;
      claimed_remedy: string;
      filed_at: string;
    };
    expect(body.dispute_id).toMatch(/^disp_/);
    expect(body.conversation_id).toBe(CONVO);
    expect(body.filed_by).toBe("alice");
    expect(body.filer_aid).toBe(ALICE_AID);
    expect(body.respondent_aid).toBe(BOB_AID);
    expect(body.reason).toBe("non_delivery");
    expect(body.state).toBe("open");
    expect(body.narrative).toBe("Output never arrived after payment cleared");
    expect(body.claimed_remedy).toBe("refund");
    expect(body.filed_at).toMatch(/\d{4}-\d{2}-\d{2}T/);

    const stored = await storage.getDispute(body.dispute_id);
    expect(stored?.disputeId).toBe(body.dispute_id);
    expect(stored?.filedBy).toBe("alice");
  });

  it("omits optional fields when not provided", async () => {
    const { app } = await setup();
    const res = await file(app, {});
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.narrative).toBeUndefined();
    expect(body.claimed_remedy).toBeUndefined();
  });
});

describe("POST /v1/disputes — rejection paths", () => {
  it("401 on missing bearer", async () => {
    const { app } = await setup();
    const res = await file(app, {}, { token: null });
    expect(res.status).toBe(401);
  });

  it("401 on unknown bearer", async () => {
    const { app } = await setup();
    const res = await file(app, {}, { token: "tok-nope" });
    expect(res.status).toBe(401);
  });

  it("400 when body is missing required fields", async () => {
    const { app } = await setup();
    const res = await app.request("/v1/disputes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer tok-alice",
      },
      body: JSON.stringify({ conversation_id: CONVO }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; field: string };
    expect(body.error).toBe("invalid_body");
    expect(body.field).toBe("filer_aid");
  });

  it("400 when reason is not one of the known codes", async () => {
    const { app } = await setup();
    const res = await file(app, { reason: "vibes_off" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { field: string };
    expect(body.field).toBe("reason");
  });

  it("404 when conversation has no audit events", async () => {
    const { app } = await setup();
    const res = await file(app, { conversation_id: "ghost-convo" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("conversation_not_found");
  });

  it("400 when filer_aid is not a registered agent", async () => {
    const { app } = await setup();
    const res = await file(app, { filer_aid: "aid:agentagora:nobody/missing" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unknown_filer");
  });

  it("403 when filer_aid is owned by a different account", async () => {
    const { app } = await setup();
    // tok-bob trying to file a dispute claiming alice's AID as filer.
    const res = await file(app, {}, { token: "tok-bob" });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  it("400 when respondent_aid is not registered", async () => {
    const { app } = await setup();
    const res = await file(app, { respondent_aid: "aid:agentagora:ghost/x" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unknown_respondent");
  });
});

describe("GET /v1/disputes/:id", () => {
  it("returns the case file for a known ID (no auth)", async () => {
    const { app } = await setup();
    const filed = await file(app, { narrative: "n" });
    const created = (await filed.json()) as { dispute_id: string };

    const res = await app.request(`/v1/disputes/${created.dispute_id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dispute_id: string; state: string };
    expect(body.dispute_id).toBe(created.dispute_id);
    expect(body.state).toBe("open");
  });

  it("404 for an unknown ID", async () => {
    const { app } = await setup();
    const res = await app.request("/v1/disputes/disp_nope");
    expect(res.status).toBe(404);
  });
});
