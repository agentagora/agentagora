import { describe, expect, it } from "vitest";
import { StaticOwnerAuth } from "../src/auth.js";
import { createApi } from "../src/index.js";
import { InMemoryStorage } from "../src/storage.js";
import {
  type AuditEventDraft,
  type SigningKey,
  chainHash,
  generateSigningKey,
  signAuditEvent,
  signManifest,
} from "./_signing.js";

const validManifest = {
  manifest_version: 1 as const,
  aid: "aid:agentagora:acme/code-review",
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

const ALICE_AID = "aid:agentagora:acme/code-review";
const CONVO = "convo-0001";

let aliceKey: SigningKey;
let bobKey: SigningKey;

async function setup() {
  aliceKey = aliceKey ?? (await generateSigningKey(1));
  bobKey = bobKey ?? (await generateSigningKey(2));
  const storage = new InMemoryStorage();
  const ownerAuth = new StaticOwnerAuth({ "tok-alice": "alice" });
  const app = createApi({ storage, ownerAuth });

  // Publish alice's manifest so her pubkey is pinned in storage.
  const signed = await signManifest(validManifest, aliceKey);
  const res = await app.request("/v1/agents", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer tok-alice",
      "x-aap-pubkey": signed.pubkey,
      "x-aap-signature": signed.signature,
    },
    body: JSON.stringify(validManifest),
  });
  if (res.status !== 201) throw new Error(`setup: publish failed (${res.status})`);

  return { app, storage };
}

function draft(
  overrides: Partial<AuditEventDraft> = {},
  index = 0,
  prevHash: string | null = null,
): AuditEventDraft {
  return {
    event_id: `evt-${String(index).padStart(4, "0")}`,
    conversation_id: CONVO,
    type: "rpc.request.received",
    timestamp: `2026-05-01T00:00:0${index}.000Z`,
    actor_aid: ALICE_AID,
    previous_event_hash: prevHash,
    data: {},
    ...overrides,
  };
}

async function ingest(app: ReturnType<typeof createApi>, events: unknown[]) {
  return app.request("/v1/audit/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events }),
  });
}

describe("POST /v1/audit/ingest — happy path", () => {
  it("ingests a single first-of-chain event (201)", async () => {
    const { app, storage } = await setup();
    const event = await signAuditEvent(draft({}, 0, null), aliceKey);
    const res = await ingest(app, [event]);

    expect(res.status).toBe(201);
    const body = (await res.json()) as { ingested: string[]; rejected: unknown[] };
    expect(body.ingested).toEqual([event.event_id]);
    expect(body.rejected).toEqual([]);

    const stored = await storage.getConversationEvents(CONVO);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.event_id).toBe(event.event_id);
  });

  it("ingests a multi-event chain in a single call", async () => {
    const { app, storage } = await setup();
    const e1 = await signAuditEvent(draft({}, 0, null), aliceKey);
    const e2 = await signAuditEvent(draft({}, 1, chainHash(e1)), aliceKey);
    const e3 = await signAuditEvent(draft({}, 2, chainHash(e2)), aliceKey);

    const res = await ingest(app, [e1, e2, e3]);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ingested: string[]; rejected: unknown[] };
    expect(body.ingested).toEqual([e1.event_id, e2.event_id, e3.event_id]);
    expect(body.rejected).toEqual([]);

    const stored = await storage.getConversationEvents(CONVO);
    expect(stored.map((e) => e.event_id)).toEqual([e1.event_id, e2.event_id, e3.event_id]);
  });

  it("accepts BOTH parties' chains for one conversation (per-actor linkage)", async () => {
    // Audit chains are per-party: the initiator and the responder each
    // keep their own chain for the same conversation_id, both starting at
    // previous_event_hash = null. Linkage must be validated against the
    // actor's own chain — the responder's first event landing after the
    // initiator's chain is NOT a broken chain. (Regression: the golden-path
    // demo's responder sync was rejected before this.)
    const { app, storage } = await setup();
    const BOB_AID = "aid:agentagora:acme/echo";
    const bobManifest = { ...validManifest, aid: BOB_AID };
    const signed = await signManifest(bobManifest, bobKey);
    const pub = await app.request("/v1/agents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer tok-alice",
        "x-aap-pubkey": signed.pubkey,
        "x-aap-signature": signed.signature,
      },
      body: JSON.stringify(bobManifest),
    });
    expect(pub.status).toBe(201);

    // Alice's chain ingests first…
    const a1 = await signAuditEvent(draft({}, 0, null), aliceKey);
    const a2 = await signAuditEvent(draft({}, 1, chainHash(a1)), aliceKey);
    expect((await ingest(app, [a1, a2])).status).toBe(201);

    // …then Bob's chain for the SAME conversation starts fresh at null.
    const b1 = await signAuditEvent(
      draft({ event_id: "evt-b-0000", actor_aid: BOB_AID }, 2, null),
      bobKey,
    );
    const b2 = await signAuditEvent(
      draft({ event_id: "evt-b-0001", actor_aid: BOB_AID }, 3, chainHash(b1)),
      bobKey,
    );
    const res = await ingest(app, [b1, b2]);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ingested: string[]; rejected: unknown[] };
    expect(body.rejected).toEqual([]);
    expect(body.ingested).toEqual([b1.event_id, b2.event_id]);

    // The merged conversation view holds all four events.
    const stored = await storage.getConversationEvents(CONVO);
    expect(stored).toHaveLength(4);
  });

  it("serves ingested feedback via GET /v1/agents/:aid/feedback (M7-lite)", async () => {
    const { app } = await setup();
    // Alice records feedback about herself-as-subject? No — subject is the
    // published agent (validManifest.aid); the actor is also alice here
    // because the test rig only pins her key. Shape is what matters.
    const fb = await signAuditEvent(
      draft(
        {
          type: "aap.feedback.recorded",
          data: { subject_aid: validManifest.aid, score: 91, capability: "review_pull_request" },
        },
        0,
        null,
      ),
      aliceKey,
    );
    expect((await ingest(app, [fb])).status).toBe(201);

    const res = await app.request(`/v1/agents/${encodeURIComponent(validManifest.aid)}/feedback`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      feedback: Array<{ score: number; capability: string; actor_aid: string }>;
    };
    expect(body.total).toBe(1);
    expect(body.feedback[0]?.score).toBe(91);
    expect(body.feedback[0]?.capability).toBe("review_pull_request");

    // Unknown agent → 404; agent with no feedback → empty list is fine.
    const missing = await app.request("/v1/agents/aid%3Aagentagora%3Anobody%2Fnothing/feedback");
    expect(missing.status).toBe(404);
  });

  it("is idempotent — re-ingesting reports duplicate without poisoning", async () => {
    const { app, storage } = await setup();
    const event = await signAuditEvent(draft({}, 0, null), aliceKey);
    await ingest(app, [event]);
    const second = await ingest(app, [event]);

    expect(second.status).toBe(207);
    const body = (await second.json()) as {
      ingested: string[];
      rejected: { event_id: string; error: string }[];
    };
    expect(body.ingested).toEqual([]);
    expect(body.rejected[0]?.error).toBe("duplicate_event");

    const stored = await storage.getConversationEvents(CONVO);
    expect(stored).toHaveLength(1);
  });
});

describe("POST /v1/audit/ingest — rejection paths", () => {
  it("400 on missing/invalid body shape", async () => {
    const { app } = await setup();
    const res = await app.request("/v1/audit/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("207 with validation_error when an event fails Zod", async () => {
    const { app } = await setup();
    const res = await ingest(app, [{ junk: true, event_id: "evt-bad" }]);
    expect(res.status).toBe(207);
    const body = (await res.json()) as { rejected: { event_id: string; error: string }[] };
    expect(body.rejected[0]?.error).toBe("validation_error");
  });

  it("rejects events from an actor that hasn't published a manifest", async () => {
    const { app } = await setup();
    const event = await signAuditEvent(
      draft({ actor_aid: "aid:agentagora:nobody/missing" }, 0, null),
      bobKey,
    );
    const res = await ingest(app, [event]);
    const body = (await res.json()) as { rejected: { error: string }[] };
    expect(body.rejected[0]?.error).toBe("unknown_actor");
  });

  it("rejects events whose signature was made with the wrong key", async () => {
    const { app } = await setup();
    // Same actor (alice's AID) but signed with bob's key.
    const event = await signAuditEvent(draft({}, 0, null), bobKey);
    const res = await ingest(app, [event]);
    const body = (await res.json()) as { rejected: { error: string }[] };
    expect(body.rejected[0]?.error).toBe("invalid_signature");
  });

  it("rejects events whose previous_event_hash doesn't match the chain tip", async () => {
    const { app } = await setup();
    const e1 = await signAuditEvent(draft({}, 0, null), aliceKey);
    await ingest(app, [e1]);

    const wrongPrev = await signAuditEvent(draft({}, 1, "sha256:0000"), aliceKey);
    const res = await ingest(app, [wrongPrev]);
    const body = (await res.json()) as { rejected: { error: string }[] };
    expect(body.rejected[0]?.error).toBe("broken_chain");
  });

  it("rejects a fresh chain whose first event has a non-null prev hash", async () => {
    const { app } = await setup();
    const event = await signAuditEvent(
      draft({ conversation_id: "fresh-convo" }, 0, "sha256:abc"),
      aliceKey,
    );
    const res = await ingest(app, [event]);
    const body = (await res.json()) as { rejected: { error: string }[] };
    expect(body.rejected[0]?.error).toBe("broken_chain");
  });

  it("partial success — first event ingests, second fails, third still tried", async () => {
    const { app, storage } = await setup();
    const e1 = await signAuditEvent(draft({}, 0, null), aliceKey);
    const broken = await signAuditEvent(draft({}, 1, "sha256:0000"), aliceKey);
    const e3 = await signAuditEvent(draft({}, 2, chainHash(e1)), aliceKey);

    const res = await ingest(app, [e1, broken, e3]);
    const body = (await res.json()) as {
      ingested: string[];
      rejected: { event_id: string; error: string }[];
    };
    expect(body.ingested).toEqual([e1.event_id, e3.event_id]);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0]?.event_id).toBe(broken.event_id);
    expect(body.rejected[0]?.error).toBe("broken_chain");

    const stored = await storage.getConversationEvents(CONVO);
    expect(stored.map((e) => e.event_id)).toEqual([e1.event_id, e3.event_id]);
  });
});

describe("GET /v1/conversations/:id", () => {
  it("returns the chain in timestamp order", async () => {
    const { app } = await setup();
    const e1 = await signAuditEvent(draft({}, 0, null), aliceKey);
    const e2 = await signAuditEvent(draft({}, 1, chainHash(e1)), aliceKey);
    await ingest(app, [e1, e2]);

    const res = await app.request(`/v1/conversations/${CONVO}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      conversation_id: string;
      total: number;
      events: { event_id: string }[];
    };
    expect(body.conversation_id).toBe(CONVO);
    expect(body.total).toBe(2);
    expect(body.events.map((e) => e.event_id)).toEqual([e1.event_id, e2.event_id]);
  });

  it("returns an empty list for an unknown conversation_id", async () => {
    const { app } = await setup();
    const res = await app.request("/v1/conversations/never-seen");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; events: unknown[] };
    expect(body.total).toBe(0);
    expect(body.events).toEqual([]);
  });
});

describe("D1Storage parity", () => {
  it("InMemoryStorage's clear() drops audit events too", async () => {
    const { app, storage } = await setup();
    const event = await signAuditEvent(draft({}, 0, null), aliceKey);
    await ingest(app, [event]);
    expect(await storage.getConversationEvents(CONVO)).toHaveLength(1);

    storage.clear();
    expect(await storage.getConversationEvents(CONVO)).toHaveLength(0);
    expect(await storage.hasAuditEvent(event.event_id)).toBe(false);
  });
});
