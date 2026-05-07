/**
 * Tier 2 compliance — authenticated read paths.
 *
 * Spec section: AAP-spec.md §5.2 (registry API) + §3.4 (scopes) +
 * cloud-api's bearer-token convention.
 *
 * Every cloud-api candidate that supports authenticated reads MUST:
 *   - Reject missing bearers with 401 + `unauthorized` envelope
 *   - Reject invalid/unknown bearers with 401 + `unauthorized`
 *   - On valid bearer + scoped query, return 200 with data scoped
 *     strictly to the bearer's owner
 *   - On cross-owner query (`?owner=other`), return 403 + `forbidden`
 *
 * Tier 2 is opt-in: tests run only when `AAP_TEST_BEARER` is set.
 * Some tests additionally require `AAP_TEST_OWNER_ID` (owner-id the
 * bearer resolves to) and/or `AAP_TEST_OWNED_AID` (an AID owned by
 * the bearer); those tests skip individually when those vars are
 * empty, so a partial Tier 2 run still produces useful signal.
 *
 * To run locally:
 *   AAP_BASE_URL=http://localhost:8788 \
 *   AAP_TEST_BEARER=<your-test-bearer> \
 *   AAP_TEST_OWNER_ID=<resolved-owner-id> \
 *   AAP_TEST_OWNED_AID=aid:agentagora:<owner>/<name> \
 *     pnpm --filter @agentagora/protocol-compliance test
 */

import { describe, expect, it } from "vitest";

import { loadConfig, shouldRunCompliance } from "../src/config.js";
import { probe } from "../src/probe.js";

const cfg = loadConfig();
const enabled = shouldRunCompliance();
const tier2Enabled = enabled && cfg.bearer.length > 0;

interface ErrorEnvelope {
  error?: unknown;
  message?: unknown;
}

describe.skipIf(!tier2Enabled)("Tier 2 · Authenticated read paths", () => {
  // ── /v1/agents?owner= ────────────────────────────────────────────
  describe("GET /v1/agents?owner=<id>", () => {
    it("MUST return 401 with `unauthorized` envelope on missing bearer", async () => {
      const ownerId = cfg.testOwnerId || "any-owner-id";
      const res = await probe(`${cfg.baseUrl}/v1/agents?owner=${encodeURIComponent(ownerId)}`);
      expect(res.status, "owner-scoped query without bearer MUST be 401").toBe(401);
      const body = res.body as ErrorEnvelope;
      expect(body.error).toBe("unauthorized");
    });

    it("MUST return 401 on invalid bearer", async () => {
      const ownerId = cfg.testOwnerId || "any-owner-id";
      const res = await probe(`${cfg.baseUrl}/v1/agents?owner=${encodeURIComponent(ownerId)}`, {
        bearer: "not-a-real-token-deadbeef",
      });
      expect(res.status, "invalid bearer MUST be 401").toBe(401);
      const body = res.body as ErrorEnvelope;
      expect(body.error).toBe("unauthorized");
    });

    it.skipIf(!cfg.testOwnerId)(
      "MUST return 200 with owner-scoped list on valid bearer + matching ?owner=",
      async () => {
        const res = await probe(
          `${cfg.baseUrl}/v1/agents?owner=${encodeURIComponent(cfg.testOwnerId)}`,
          {
            bearer: cfg.bearer,
          },
        );
        expect(res.status, "valid bearer + matching owner MUST be 200").toBe(200);
        const body = res.body as { agents?: unknown };
        expect(Array.isArray(body.agents), "response.agents MUST be an array").toBe(true);
      },
    );

    it.skipIf(!cfg.testOwnerId)(
      "MUST return 403 with `forbidden` on cross-owner query (bearer owns A, queries owner=B)",
      async () => {
        // Pick an "other" owner-id that's nearly certain to be different
        // from cfg.testOwnerId. Using a UUID-shaped string makes the
        // collision probability vanishingly small for real candidates.
        const otherOwner = "compliance-suite-other-owner-aaaaaaaaaaaa";
        const res = await probe(
          `${cfg.baseUrl}/v1/agents?owner=${encodeURIComponent(otherOwner)}`,
          {
            bearer: cfg.bearer,
          },
        );
        expect(res.status, "cross-owner query MUST be 403").toBe(403);
        const body = res.body as ErrorEnvelope;
        expect(body.error).toBe("forbidden");
      },
    );
  });

  // ── /v1/conversations?actor= ─────────────────────────────────────
  describe("GET /v1/conversations?actor=<aid>", () => {
    it("MUST return 401 on missing bearer", async () => {
      const aid = cfg.testOwnedAid || "aid:agentagora:any/agent";
      const res = await probe(`${cfg.baseUrl}/v1/conversations?actor=${encodeURIComponent(aid)}`);
      expect(res.status, "actor-scoped query without bearer MUST be 401").toBe(401);
      const body = res.body as ErrorEnvelope;
      expect(body.error).toBe("unauthorized");
    });

    it("MUST return 401 on invalid bearer", async () => {
      const aid = cfg.testOwnedAid || "aid:agentagora:any/agent";
      const res = await probe(`${cfg.baseUrl}/v1/conversations?actor=${encodeURIComponent(aid)}`, {
        bearer: "not-a-real-token-deadbeef",
      });
      expect(res.status).toBe(401);
    });

    it.skipIf(!cfg.testOwnedAid)("MUST return 200 on valid bearer + owned AID", async () => {
      const res = await probe(
        `${cfg.baseUrl}/v1/conversations?actor=${encodeURIComponent(cfg.testOwnedAid)}`,
        { bearer: cfg.bearer },
      );
      expect(res.status, "valid bearer + owned AID MUST be 200").toBe(200);
      const body = res.body as { conversations?: unknown };
      expect(Array.isArray(body.conversations), "response.conversations MUST be an array").toBe(
        true,
      );
    });
  });

  // ── /v1/disputes?filer= / ?respondent= ───────────────────────────
  describe("GET /v1/disputes (owner-scoped queries)", () => {
    it("MUST return 401 on missing bearer with `?filer=`", async () => {
      const aid = cfg.testOwnedAid || "aid:agentagora:any/agent";
      const res = await probe(`${cfg.baseUrl}/v1/disputes?filer=${encodeURIComponent(aid)}`);
      expect(res.status).toBe(401);
    });

    it("MUST return 401 on missing bearer with `?respondent=`", async () => {
      const aid = cfg.testOwnedAid || "aid:agentagora:any/agent";
      const res = await probe(`${cfg.baseUrl}/v1/disputes?respondent=${encodeURIComponent(aid)}`);
      expect(res.status).toBe(401);
    });

    it.skipIf(!cfg.testOwnedAid)(
      "MUST return 200 + disputes array on valid bearer + owned AID `?filer=`",
      async () => {
        const res = await probe(
          `${cfg.baseUrl}/v1/disputes?filer=${encodeURIComponent(cfg.testOwnedAid)}`,
          { bearer: cfg.bearer },
        );
        expect(res.status).toBe(200);
        const body = res.body as { disputes?: unknown };
        expect(Array.isArray(body.disputes)).toBe(true);
      },
    );
  });

  // ── /v1/connect/account ──────────────────────────────────────────
  //
  // Note on 503 acceptance below: the reference cloud-api short-circuits
  // with `503 not_configured` whenever `STRIPE_SECRET_KEY` is unset
  // (dev / mock mode), BEFORE running the auth check. That's a
  // documented graceful-degradation path, so a candidate that returns
  // 503 here in lieu of 401 is still spec-conformant — it just means
  // the test environment doesn't have Stripe wired. We accept both;
  // a maintainer running this suite against a production candidate
  // (where Stripe IS wired) will get the strict 401 path tested.
  describe("GET /v1/connect/account", () => {
    it("MUST require auth (401) OR signal service-unavailable (503) when Stripe is unconfigured", async () => {
      const res = await probe(`${cfg.baseUrl}/v1/connect/account`);
      expect(
        [401, 503].includes(res.status),
        `expected 401 (auth required) or 503 (Stripe unconfigured); got ${res.status}`,
      ).toBe(true);
      if (res.status === 401) {
        const body = res.body as ErrorEnvelope;
        expect(body.error, "401 envelope MUST be `unauthorized`").toBe("unauthorized");
      }
    });

    it("on valid bearer MAY return 200 (account exists) / 404 (no account yet) / 503 (unconfigured)", async () => {
      const res = await probe(`${cfg.baseUrl}/v1/connect/account`, { bearer: cfg.bearer });
      // 200 = the bearer's owner has a Stripe Connect account on this candidate
      // 404 = the bearer's owner doesn't yet — dashboard would prompt onboarding
      // 503 = candidate has STRIPE_SECRET_KEY unset (dev mode)
      // 401 = bearer is invalid — but we already supplied a "valid" bearer per
      //       env config, so this would be a candidate misconfiguration
      expect([200, 404, 503].includes(res.status), `expected 200/404/503 (got ${res.status})`).toBe(
        true,
      );
      if (res.status === 200) {
        const body = res.body as { account_id?: unknown; status?: unknown };
        expect(typeof body.account_id, "200 body MUST carry account_id").toBe("string");
        expect(typeof body.status, "200 body MUST carry status object").toBe("object");
      }
    });
  });
});
