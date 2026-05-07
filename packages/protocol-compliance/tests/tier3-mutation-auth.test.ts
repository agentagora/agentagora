/**
 * Tier 3 compliance — auth gates on the remaining mutation endpoints.
 *
 * Routes covered:
 *   - POST /v1/audit/ingest    (audit-event chain ingest)
 *   - POST /v1/disputes        (file a dispute)
 *   - POST /v1/nonces/check    (replay-protection nonce write)
 *
 * Each MUST 401 on missing bearer, 401 on invalid bearer, and 400
 * on a body that doesn't match the route's required shape.
 *
 * Deeper assertions (chain integrity, replay semantics, dispute
 * authz against an actual filer/respondent) require either fixtures
 * from the provisioner (POST /v1/audit/ingest, /v1/disputes) or
 * cross-isolate state (POST /v1/nonces/check) — those land in a
 * later phase. Keeping Phase 2b focused on the universal auth
 * contract that every route shares.
 */

import { describe, expect, it } from "vitest";

import { loadConfig, shouldRunCompliance } from "../src/config.js";
import { probe } from "../src/probe.js";

const cfg = loadConfig();
const enabled = shouldRunCompliance();
const tier3AuthEnabled = enabled && cfg.bearer.length > 0;

interface ErrorEnvelope {
  error?: unknown;
  message?: unknown;
}

describe.skipIf(!tier3AuthEnabled)("Tier 3 · POST /v1/audit/ingest", () => {
  // Note: /v1/audit/ingest is INTENTIONALLY unauthenticated — the
  // per-event Ed25519 signature IS the auth. Bearer-gating the route
  // would force inspectors / auditors to coordinate credentials with
  // every owner whose chain they want to verify. The signature
  // verification path (each event's actor must sign with their
  // pinned key) provides equivalent or stronger forgery protection.
  //
  // Compliance therefore tests body-shape validation and signature
  // enforcement, not bearer auth.

  it("MUST 400 with `invalid_body` on body that's not `{ events: [...] }`", async () => {
    const res = await probe(`${cfg.baseUrl}/v1/audit/ingest`, {
      method: "POST",
      body: { not: "the right shape" },
    });
    expect(res.status, "wrong-shape body MUST 400").toBe(400);
    const body = res.body as ErrorEnvelope;
    expect(body.error).toBe("invalid_body");
  });

  it("MUST accept an empty events array (idempotent batch)", async () => {
    const res = await probe(`${cfg.baseUrl}/v1/audit/ingest`, {
      method: "POST",
      body: { events: [] },
    });
    // 200 or 201 — both signal "request processed, zero events".
    // The reference impl returns 201; other valid impls might return
    // 200. We accept either.
    expect([200, 201].includes(res.status), `empty batch MUST be 200/201 (got ${res.status})`).toBe(
      true,
    );
    const body = res.body as { ingested?: unknown; rejected?: unknown };
    expect(Array.isArray(body.ingested), "response.ingested MUST be an array").toBe(true);
    expect(Array.isArray(body.rejected), "response.rejected MUST be an array").toBe(true);
  });
});

describe.skipIf(!tier3AuthEnabled)("Tier 3 · POST /v1/disputes (auth)", () => {
  it("MUST 401 on missing bearer", async () => {
    const res = await probe(`${cfg.baseUrl}/v1/disputes`, {
      method: "POST",
      body: { conversation_id: "x", filer_aid: "y", respondent_aid: "z", reason: "other" },
    });
    expect(res.status, "file-dispute without bearer MUST be 401").toBe(401);
    const body = res.body as ErrorEnvelope;
    expect(body.error).toBe("unauthorized");
  });

  it("MUST 401 on invalid bearer", async () => {
    const res = await probe(`${cfg.baseUrl}/v1/disputes`, {
      method: "POST",
      bearer: "not-a-real-token-deadbeef",
      body: { conversation_id: "x", filer_aid: "y", respondent_aid: "z", reason: "other" },
    });
    expect(res.status).toBe(401);
  });

  it("MUST 400 with `invalid_body` on missing required fields", async () => {
    const res = await probe(`${cfg.baseUrl}/v1/disputes`, {
      method: "POST",
      bearer: cfg.bearer,
      body: { not: "the right shape" },
    });
    expect(res.status, "incomplete dispute body MUST 400").toBe(400);
    const body = res.body as ErrorEnvelope;
    expect(body.error).toBe("invalid_body");
  });
});

describe.skipIf(!tier3AuthEnabled)("Tier 3 · POST /v1/nonces/check (replay protection)", () => {
  it("MUST 401 on missing bearer", async () => {
    const res = await probe(`${cfg.baseUrl}/v1/nonces/check`, {
      method: "POST",
      body: { key: "compliance-suite-test-nonce" },
    });
    expect(res.status).toBe(401);
    const body = res.body as ErrorEnvelope;
    expect(body.error).toBe("unauthorized");
  });

  it("MUST 401 on invalid bearer", async () => {
    const res = await probe(`${cfg.baseUrl}/v1/nonces/check`, {
      method: "POST",
      bearer: "not-a-real-token-deadbeef",
      body: { key: "compliance-suite-test-nonce" },
    });
    expect(res.status).toBe(401);
  });

  it("MUST 200 with `first_seen:true` on first hit, 409 with `first_seen:false` on replay", async () => {
    // Generate a fresh key so we don't collide with a prior run on
    // the candidate's KV/in-memory store.
    const key = `compliance-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const first = await probe(`${cfg.baseUrl}/v1/nonces/check`, {
      method: "POST",
      bearer: cfg.bearer,
      body: { key },
    });
    expect(first.status, "first nonce check MUST be 200").toBe(200);
    const firstBody = first.body as { first_seen?: unknown };
    expect(firstBody.first_seen, "first hit MUST report first_seen:true").toBe(true);

    const second = await probe(`${cfg.baseUrl}/v1/nonces/check`, {
      method: "POST",
      bearer: cfg.bearer,
      body: { key },
    });
    expect(second.status, "replay nonce check MUST be 409 (conflict)").toBe(409);
    const secondBody = second.body as { first_seen?: unknown };
    expect(secondBody.first_seen, "replay MUST report first_seen:false").toBe(false);
  });
});
