/**
 * Owner-scoped index endpoints.
 *
 *   GET /v1/agents?owner=<id>          [Bearer]
 *   GET /v1/conversations?actor=<aid>  [Bearer]
 *   GET /v1/disputes?filer=<aid>       [Bearer]
 *   GET /v1/disputes?respondent=<aid>  [Bearer]
 *
 * Each endpoint covers four scenarios: missing-bearer (or missing
 * filter), cross-owner attempt, happy-path, empty-result.
 */

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

const ALICE_TOKEN = "tok-alice";
const BOB_TOKEN = "tok-bob";
const ALICE_AID = "aid:agentagora:alice/code-review";
const ALICE_AID_2 = "aid:agentagora:alice/translator";
const BOB_AID = "aid:agentagora:bob/widget-shop";

interface Fixture {
  app: ReturnType<typeof createApi>;
  storage: InMemoryStorage;
  aliceKey: SigningKey;
  bobKey: SigningKey;
}

function manifest(aid: string, description: string) {
  return {
    manifest_version: 1 as const,
    aid,
    description,
    endpoints: { rpc: "https://example.com/aap/v1/rpc" },
    capabilities: [
      {
        name: "do_thing",
        input_schema: { type: "object" },
        output_schema: { type: "object" },
        pricing: { model: "per_call" as const, amount: "0.50", currency: "USD" },
        accepts: ["stripe-fiat"],
      },
    ],
  };
}

async function publish(
  app: ReturnType<typeof createApi>,
  token: string,
  m: ReturnType<typeof manifest>,
  key: SigningKey,
): Promise<void> {
  const signed = await signManifest(m, key);
  const res = await app.request("/v1/agents", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-aap-pubkey": signed.pubkey,
      "x-aap-signature": signed.signature,
    },
    body: JSON.stringify(m),
  });
  if (res.status !== 201) throw new Error(`publish failed (${res.status})`);
}

async function setup(): Promise<Fixture> {
  const aliceKey = await generateSigningKey(1);
  const bobKey = await generateSigningKey(2);
  const storage = new InMemoryStorage();
  const ownerAuth = new StaticOwnerAuth({ [ALICE_TOKEN]: "alice", [BOB_TOKEN]: "bob" });
  const app = createApi({ storage, ownerAuth });
  await publish(app, ALICE_TOKEN, manifest(ALICE_AID, "Reviews PRs"), aliceKey);
  await publish(app, ALICE_TOKEN, manifest(ALICE_AID_2, "Translates text"), aliceKey);
  await publish(app, BOB_TOKEN, manifest(BOB_AID, "Sells widgets"), bobKey);
  return { app, storage, aliceKey, bobKey };
}

describe("GET /v1/agents?owner=<id>", () => {
  it("401 when no bearer is supplied", async () => {
    const { app } = await setup();
    const res = await app.request("/v1/agents?owner=alice");
    expect(res.status).toBe(401);
  });

  it("403 when the bearer's owner differs from ?owner=", async () => {
    const { app } = await setup();
    const res = await app.request("/v1/agents?owner=alice", {
      headers: { authorization: `Bearer ${BOB_TOKEN}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  it("happy path returns only the bearer's agents", async () => {
    const { app } = await setup();
    const res = await app.request("/v1/agents?owner=alice", {
      headers: { authorization: `Bearer ${ALICE_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      agents: { aid: string }[];
    };
    expect(body.total).toBe(2);
    const aids = body.agents.map((a) => a.aid).sort();
    expect(aids).toEqual([ALICE_AID, ALICE_AID_2].sort());
  });

  it("returns { total: 0, agents: [] } when the bearer owns nothing", async () => {
    const aliceKey = await generateSigningKey(1);
    const storage = new InMemoryStorage();
    const ownerAuth = new StaticOwnerAuth({ [ALICE_TOKEN]: "alice" });
    const app = createApi({ storage, ownerAuth });
    void aliceKey;
    const res = await app.request("/v1/agents?owner=alice", {
      headers: { authorization: `Bearer ${ALICE_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; agents: unknown[] };
    expect(body.total).toBe(0);
    expect(body.agents).toEqual([]);
  });
});

async function seedConversations(fix: Fixture): Promise<{
  aliceConvoA: string;
  aliceConvoB: string;
}> {
  const aliceConvoA = "convo-alice-a";
  const aliceConvoB = "convo-alice-b";
  // Two events in convo A signed by alice's first AID, one in convo B.
  const draftA1: AuditEventDraft = {
    event_id: "evt-a1",
    conversation_id: aliceConvoA,
    type: "rpc.request.received",
    timestamp: "2026-05-01T00:00:00.000Z",
    actor_aid: ALICE_AID,
    previous_event_hash: null,
    data: {},
  };
  const a1 = await signAuditEvent(draftA1, fix.aliceKey);
  const a2 = await signAuditEvent(
    {
      event_id: "evt-a2",
      conversation_id: aliceConvoA,
      type: "settlement.completed",
      timestamp: "2026-05-01T00:00:01.000Z",
      actor_aid: ALICE_AID,
      previous_event_hash: chainHash(a1),
      data: {},
    },
    fix.aliceKey,
  );
  const b1 = await signAuditEvent(
    {
      event_id: "evt-b1",
      conversation_id: aliceConvoB,
      type: "rpc.request.received",
      timestamp: "2026-05-02T00:00:00.000Z",
      actor_aid: ALICE_AID,
      previous_event_hash: null,
      data: {},
    },
    fix.aliceKey,
  );
  // Bob's totally separate conversation — should never leak into
  // alice's results.
  const c1 = await signAuditEvent(
    {
      event_id: "evt-c1",
      conversation_id: "convo-bob-only",
      type: "rpc.request.received",
      timestamp: "2026-05-03T00:00:00.000Z",
      actor_aid: BOB_AID,
      previous_event_hash: null,
      data: {},
    },
    fix.bobKey,
  );
  const ingest = await fix.app.request("/v1/audit/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events: [a1, a2, b1, c1] }),
  });
  if (ingest.status !== 201) throw new Error(`ingest failed (${ingest.status})`);
  return { aliceConvoA, aliceConvoB };
}

describe("GET /v1/conversations?actor=<aid>", () => {
  it("401 when no bearer is supplied", async () => {
    const fix = await setup();
    await seedConversations(fix);
    const res = await fix.app.request(`/v1/conversations?actor=${encodeURIComponent(ALICE_AID)}`);
    expect(res.status).toBe(401);
  });

  it("400 when ?actor= is missing entirely", async () => {
    const fix = await setup();
    const res = await fix.app.request("/v1/conversations", {
      headers: { authorization: `Bearer ${ALICE_TOKEN}` },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("missing_filter");
  });

  it("403 when the bearer doesn't own the AID", async () => {
    const fix = await setup();
    await seedConversations(fix);
    const res = await fix.app.request(`/v1/conversations?actor=${encodeURIComponent(ALICE_AID)}`, {
      headers: { authorization: `Bearer ${BOB_TOKEN}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  it("happy path groups events by conversation_id with roll-up metadata", async () => {
    const fix = await setup();
    const { aliceConvoA, aliceConvoB } = await seedConversations(fix);
    const res = await fix.app.request(`/v1/conversations?actor=${encodeURIComponent(ALICE_AID)}`, {
      headers: { authorization: `Bearer ${ALICE_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      conversations: {
        conversation_id: string;
        first_seen_at: string;
        last_seen_at: string;
        event_count: number;
        latest_event_type: string;
      }[];
    };
    expect(body.total).toBe(2);
    // Newest-last-seen first.
    expect(body.conversations[0]?.conversation_id).toBe(aliceConvoB);
    const a = body.conversations.find((c) => c.conversation_id === aliceConvoA);
    expect(a?.event_count).toBe(2);
    expect(a?.first_seen_at).toBe("2026-05-01T00:00:00.000Z");
    expect(a?.last_seen_at).toBe("2026-05-01T00:00:01.000Z");
    expect(a?.latest_event_type).toBe("settlement.completed");
  });

  it("returns { total: 0, conversations: [] } when the AID has no events", async () => {
    const fix = await setup();
    // No audit events seeded — the AID exists, but never participated.
    const res = await fix.app.request(
      `/v1/conversations?actor=${encodeURIComponent(ALICE_AID_2)}`,
      { headers: { authorization: `Bearer ${ALICE_TOKEN}` } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; conversations: unknown[] };
    expect(body.total).toBe(0);
    expect(body.conversations).toEqual([]);
  });
});

async function seedDisputes(fix: Fixture): Promise<void> {
  // Need a conversation with at least one event for dispute filing to
  // pass the conversation_not_found check.
  const draft: AuditEventDraft = {
    event_id: "evt-d-1",
    conversation_id: "convo-dispute-seed",
    type: "rpc.request.received",
    timestamp: "2026-05-01T00:00:00.000Z",
    actor_aid: ALICE_AID,
    previous_event_hash: null,
    data: {},
  };
  const ev = await signAuditEvent(draft, fix.aliceKey);
  await fix.app.request("/v1/audit/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events: [ev] }),
  });

  // Alice files a dispute against Bob.
  const r1 = await fix.app.request("/v1/disputes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ALICE_TOKEN}`,
    },
    body: JSON.stringify({
      conversation_id: "convo-dispute-seed",
      filer_aid: ALICE_AID,
      respondent_aid: BOB_AID,
      reason: "non_delivery",
      narrative: "First case",
    }),
  });
  if (r1.status !== 201) throw new Error(`dispute filing failed (${r1.status})`);

  // Alice files a second dispute, with a different filer AID (still
  // her), so we have something to test ?filer= AND ?respondent=
  // against — second filing is the other-AID filer.
  // Need another conversation for it.
  const draft2: AuditEventDraft = {
    event_id: "evt-d-2",
    conversation_id: "convo-dispute-seed-2",
    type: "rpc.request.received",
    timestamp: "2026-05-01T00:00:00.000Z",
    actor_aid: ALICE_AID_2,
    previous_event_hash: null,
    data: {},
  };
  const ev2 = await signAuditEvent(draft2, fix.aliceKey);
  await fix.app.request("/v1/audit/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events: [ev2] }),
  });
  const r2 = await fix.app.request("/v1/disputes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ALICE_TOKEN}`,
    },
    body: JSON.stringify({
      conversation_id: "convo-dispute-seed-2",
      filer_aid: ALICE_AID_2,
      respondent_aid: BOB_AID,
      reason: "wrong_output",
      narrative: "Second case",
    }),
  });
  if (r2.status !== 201) throw new Error(`dispute filing 2 failed (${r2.status})`);
}

describe("GET /v1/disputes?filer / ?respondent", () => {
  it("400 when neither ?filer= nor ?respondent= is supplied", async () => {
    const fix = await setup();
    const res = await fix.app.request("/v1/disputes", {
      headers: { authorization: `Bearer ${ALICE_TOKEN}` },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("missing_filter");
  });

  it("401 when no bearer is supplied", async () => {
    const fix = await setup();
    const res = await fix.app.request(`/v1/disputes?filer=${encodeURIComponent(ALICE_AID)}`);
    expect(res.status).toBe(401);
  });

  it("403 when the bearer doesn't own the queried filer AID", async () => {
    const fix = await setup();
    await seedDisputes(fix);
    const res = await fix.app.request(`/v1/disputes?filer=${encodeURIComponent(ALICE_AID)}`, {
      headers: { authorization: `Bearer ${BOB_TOKEN}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  it("403 when the bearer doesn't own the queried respondent AID", async () => {
    const fix = await setup();
    await seedDisputes(fix);
    // Alice is querying disputes against bob's AID — she doesn't own it.
    const res = await fix.app.request(`/v1/disputes?respondent=${encodeURIComponent(BOB_AID)}`, {
      headers: { authorization: `Bearer ${ALICE_TOKEN}` },
    });
    expect(res.status).toBe(403);
  });

  it("happy path with ?filer= returns disputes the AID filed", async () => {
    const fix = await setup();
    await seedDisputes(fix);
    const res = await fix.app.request(`/v1/disputes?filer=${encodeURIComponent(ALICE_AID)}`, {
      headers: { authorization: `Bearer ${ALICE_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      disputes: { filer_aid: string; respondent_aid: string }[];
    };
    expect(body.total).toBe(1);
    expect(body.disputes[0]?.filer_aid).toBe(ALICE_AID);
    expect(body.disputes[0]?.respondent_aid).toBe(BOB_AID);
  });

  it("happy path with ?respondent= returns disputes against the AID", async () => {
    const fix = await setup();
    await seedDisputes(fix);
    // bob queries disputes against his own AID (he owns BOB_AID).
    const res = await fix.app.request(`/v1/disputes?respondent=${encodeURIComponent(BOB_AID)}`, {
      headers: { authorization: `Bearer ${BOB_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      disputes: { respondent_aid: string }[];
    };
    expect(body.total).toBe(2);
    expect(body.disputes.every((d) => d.respondent_aid === BOB_AID)).toBe(true);
  });

  it("ANDs ?filer= and ?respondent= when both are supplied", async () => {
    const fix = await setup();
    await seedDisputes(fix);
    // bob would normally see two disputes against him; ALICE_AID_2 only
    // filed one of them, so the AND drops it to 1.
    // For this test bob can't query ALICE_AID_2 (not his), so we file
    // through alice — alice owns both AIDs, so she can ask for "where
    // I filed as ALICE_AID_2 AND respondent is …" — but she can't
    // query bob's AID. Use ?filer=ALICE_AID + ?respondent=BOB_AID
    // would still 403 because alice doesn't own BOB_AID.
    //
    // Workaround: alice files a self-dispute (alice → alice_aid_2) so
    // we have an AND combination she's authorized to query.
    // Need a fresh convo seeded by alice's other AID.
    const seed: AuditEventDraft = {
      event_id: "evt-self-1",
      conversation_id: "convo-self",
      type: "rpc.request.received",
      timestamp: "2026-05-01T00:00:00.000Z",
      actor_aid: ALICE_AID,
      previous_event_hash: null,
      data: {},
    };
    const ev = await signAuditEvent(seed, fix.aliceKey);
    await fix.app.request("/v1/audit/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: [ev] }),
    });
    const filing = await fix.app.request("/v1/disputes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ALICE_TOKEN}`,
      },
      body: JSON.stringify({
        conversation_id: "convo-self",
        filer_aid: ALICE_AID,
        respondent_aid: ALICE_AID_2,
        reason: "other",
      }),
    });
    expect(filing.status).toBe(201);

    const both = await fix.app.request(
      `/v1/disputes?filer=${encodeURIComponent(ALICE_AID)}&respondent=${encodeURIComponent(
        ALICE_AID_2,
      )}`,
      { headers: { authorization: `Bearer ${ALICE_TOKEN}` } },
    );
    expect(both.status).toBe(200);
    const body = (await both.json()) as {
      total: number;
      disputes: { filer_aid: string; respondent_aid: string }[];
    };
    expect(body.total).toBe(1);
    expect(body.disputes[0]?.filer_aid).toBe(ALICE_AID);
    expect(body.disputes[0]?.respondent_aid).toBe(ALICE_AID_2);

    // ?filer= alone returns 2 (Alice filed two disputes through ALICE_AID).
    const filerOnly = await fix.app.request(`/v1/disputes?filer=${encodeURIComponent(ALICE_AID)}`, {
      headers: { authorization: `Bearer ${ALICE_TOKEN}` },
    });
    const filerBody = (await filerOnly.json()) as { total: number };
    expect(filerBody.total).toBe(2);
  });

  it("returns { total: 0, disputes: [] } when the AID has no disputes", async () => {
    const fix = await setup();
    // No disputes seeded — alice owns ALICE_AID_2 but no one filed
    // anything involving it.
    const res = await fix.app.request(`/v1/disputes?filer=${encodeURIComponent(ALICE_AID_2)}`, {
      headers: { authorization: `Bearer ${ALICE_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; disputes: unknown[] };
    expect(body.total).toBe(0);
    expect(body.disputes).toEqual([]);
  });
});
