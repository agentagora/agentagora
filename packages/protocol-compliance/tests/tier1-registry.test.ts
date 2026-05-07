/**
 * Tier 1 compliance — public registry read paths.
 *
 * Spec section: AAP-spec.md §5.2 ("Public registry API"). Every
 * cloud-api candidate MUST expose the following read endpoints
 * without any bearer token:
 *
 *   - GET /v1/agents              → list (paginated)
 *   - GET /v1/agents/:aid          → 200 with manifest + identity_jwt
 *                                    OR 404 with error envelope on miss
 *
 * The wire shape is locked by `@agentagora/protocol`'s
 * `tests/json-schema-lock.test.ts`. This suite verifies the HTTP
 * surface only — that the routes exist, return the right status
 * codes, and emit JSON bodies of the right top-level shape. We do
 * NOT validate every nested manifest field here (that's the
 * implementer's own unit-test job).
 */

import { describe, expect, it } from "vitest";

import { loadConfig, shouldRunCompliance } from "../src/config.js";
import { probe } from "../src/probe.js";

const cfg = loadConfig();
const enabled = shouldRunCompliance();

describe.skipIf(!enabled)("Tier 1 · Public registry read paths", () => {
  describe("GET /v1/agents (catalog list)", () => {
    it("MUST respond 200 with `{ total: number, agents: [...] }`", async () => {
      const res = await probe(`${cfg.baseUrl}/v1/agents`);
      expect(res.status).toBe(200);
      const body = res.body as { total?: unknown; agents?: unknown };
      expect(typeof body.total, "response.total MUST be a non-negative integer").toBe("number");
      expect((body.total as number) >= 0).toBe(true);
      expect(Array.isArray(body.agents), "response.agents MUST be an array").toBe(true);
    });

    it("MUST be readable without a bearer token (public surface)", async () => {
      const res = await probe(`${cfg.baseUrl}/v1/agents`, { bearer: "" });
      expect(res.status, "anonymous read MUST succeed").toBe(200);
    });

    it("each agent entry SHOULD carry aid + capabilities + published_at", async () => {
      const res = await probe(`${cfg.baseUrl}/v1/agents`);
      const body = res.body as { agents: Array<Record<string, unknown>> };
      // If the candidate hasn't published any agents yet, this is a
      // legitimate empty response. We don't fail Tier 1 on that.
      if (body.agents.length === 0) return;
      const sample = body.agents[0] as Record<string, unknown>;
      expect(typeof sample.aid, "agent.aid MUST be a string").toBe("string");
      expect(Array.isArray(sample.capabilities), "agent.capabilities MUST be an array").toBe(true);
      expect(
        typeof sample.published_at,
        "agent.published_at MUST be an RFC 3339 timestamp string",
      ).toBe("string");
    });

    it("SHOULD accept `?capability=` filter without error", async () => {
      // A candidate that doesn't yet implement the filter SHOULD
      // return the full catalog (i.e., ignore the unknown query
      // param) rather than 400 — same as the reference impl.
      const res = await probe(`${cfg.baseUrl}/v1/agents?capability=nonexistent.cap`);
      expect(res.status, "filter MUST NOT 4xx with unknown values").toBe(200);
    });
  });

  describe("GET /v1/agents/:aid (detail)", () => {
    it("MUST respond 404 with `{ error, message }` envelope on missing AID", async () => {
      const aid = "aid:agentagora:compliance-suite/intentionally-missing";
      const res = await probe(`${cfg.baseUrl}/v1/agents/${encodeURIComponent(aid)}`);
      expect(res.status, "missing AID MUST return 404").toBe(404);
      const body = res.body as { error?: unknown; message?: unknown };
      expect(typeof body.error, "404 body MUST carry an `error` string").toBe("string");
      expect(body.error, "404 error code MUST be `not_found`").toBe("not_found");
    });

    it("MUST URL-decode the AID parameter", async () => {
      // AIDs include `:` and `/` which need encoding in path segments;
      // the candidate MUST round-trip the decoded form so a missing
      // AID with weird chars returns the same `not_found` envelope
      // rather than 400 / 500.
      const aid = "aid:agentagora:compliance-suite/has spaces";
      const res = await probe(`${cfg.baseUrl}/v1/agents/${encodeURIComponent(aid)}`);
      // We accept 404 (most likely) or 400 (if the candidate's AID
      // parser rejects "has spaces"). 5xx is the failure mode.
      expect(
        res.status,
        `URL-encoded AID with spaces MUST not 5xx (got ${res.status})`,
      ).toBeLessThan(500);
    });
  });
});
