/**
 * Tier 1 compliance — error envelope shape.
 *
 * Spec section: AAP-spec.md §6.4 (Errors) — although §6.4 covers the
 * AAP wire-protocol JSON-RPC error codes, the cloud-api's HTTP
 * REST surface uses a parallel envelope:
 *
 *   { error: "<snake_case_code>", message?: string, request_id?: string, ... }
 *
 * A second cloud implementation MUST emit the same envelope so
 * dashboards, SDKs, and the marketing site can key on `error`
 * regardless of which cloud they're talking to.
 *
 * This test elicits a few intentional bad requests against the
 * public surface (no bearer required) and checks that the responses
 * conform.
 */

import { describe, expect, it } from "vitest";

import { loadConfig, shouldRunCompliance } from "../src/config.js";
import { probe } from "../src/probe.js";

const cfg = loadConfig();
const enabled = shouldRunCompliance();

const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;

interface ErrorEnvelope {
  error?: unknown;
  message?: unknown;
  request_id?: unknown;
}

describe.skipIf(!enabled)("Tier 1 · Error envelope", () => {
  it("404 from /v1/agents/:aid MUST emit { error: 'not_found' }", async () => {
    const aid = "aid:agentagora:compliance-suite/intentionally-missing";
    const res = await probe(`${cfg.baseUrl}/v1/agents/${encodeURIComponent(aid)}`);
    expect(res.status).toBe(404);
    const body = res.body as ErrorEnvelope;
    expect(typeof body.error, "envelope.error MUST be a string").toBe("string");
    expect(SNAKE_CASE.test(body.error as string), "envelope.error MUST be snake_case").toBe(true);
    expect(body.error, "envelope.error MUST be `not_found` for missing-resource 404").toBe(
      "not_found",
    );
  });

  it("404 envelope MAY include `message` (informational, human-readable)", async () => {
    const aid = "aid:agentagora:compliance-suite/intentionally-missing";
    const res = await probe(`${cfg.baseUrl}/v1/agents/${encodeURIComponent(aid)}`);
    const body = res.body as ErrorEnvelope;
    if (body.message !== undefined) {
      expect(typeof body.message).toBe("string");
      expect((body.message as string).length, "message must be non-empty").toBeGreaterThan(0);
    }
  });

  it("/v1/conversations/:id on missing id MAY return 200-empty OR 404", async () => {
    // The spec doesn't (yet) mandate which shape the cloud uses for an
    // unknown conversation_id. The reference impl returns
    // 200 `{ conversation_id, total: 0, events: [] }` — treating the
    // conversation as a virtual aggregation of any event row that
    // happens to carry that id. Other impls might return 404 with our
    // standard envelope. Both are spec-compatible at Tier 1; what we
    // gate is "if 404, the envelope is well-formed."
    //
    // M4 Phase 3 spec hardening (docs/m4-plan.md) needs to pick one.
    // Until then, accept both shapes here.
    const id = "conv-compliance-suite-intentionally-missing";
    const res = await probe(`${cfg.baseUrl}/v1/conversations/${id}`);
    if (res.status === 404) {
      const body = res.body as ErrorEnvelope;
      expect(body.error, "404 envelope.error MUST be `not_found`").toBe("not_found");
      return;
    }
    expect(res.status, "MUST be 200 or 404 (got something else)").toBe(200);
    const body = res.body as { events?: unknown };
    expect(Array.isArray(body.events), "200-empty MUST carry `events: []`").toBe(true);
  });

  it("404 from /v1/disputes/:id MUST emit `not_found`", async () => {
    const id = "disp-compliance-suite-intentionally-missing";
    const res = await probe(`${cfg.baseUrl}/v1/disputes/${id}`);
    expect(res.status, `GET /v1/disputes/${id} MUST be 404 on miss`).toBe(404);
    const body = res.body as ErrorEnvelope;
    expect(body.error).toBe("not_found");
  });

  it("error code values MUST always be snake_case strings", async () => {
    // Probe a handful of "almost certainly going to error" surfaces
    // and inspect every error envelope returned.
    const probes = [
      `${cfg.baseUrl}/v1/agents/aid:agentagora:compliance-suite/missing`,
      `${cfg.baseUrl}/v1/conversations/missing-conv`,
      `${cfg.baseUrl}/v1/disputes/missing-disp`,
    ];
    for (const url of probes) {
      const res = await probe(url);
      // We only assert on responses that are 4xx/5xx and carry an
      // `error` field. (200 responses are fine — the candidate
      // happened to have that resource.)
      if (res.status >= 400 && res.status < 600) {
        const body = res.body as ErrorEnvelope;
        if (typeof body.error === "string") {
          expect(
            SNAKE_CASE.test(body.error),
            `${url} returned error="${body.error}" — expected snake_case`,
          ).toBe(true);
        }
      }
    }
  });
});
