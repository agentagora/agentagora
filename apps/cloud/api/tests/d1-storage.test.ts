/**
 * Direct D1Storage tests.
 *
 * Runs against an in-memory node:sqlite database wrapped to look like
 * a `D1Database` (see `_d1-mock.ts`). The shim covers exactly the
 * subset of D1's API that D1Storage uses, so SQL behaviour — JSON1
 * filters, upsert, ordering — is exercised the same way it will be
 * in production.
 */

import { AuditEventSchema, ManifestSchema } from "@agentagora/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { D1Storage } from "../src/d1-storage.js";
import type { AgentRecord, DisputeRecord } from "../src/storage.js";
import { createMockD1 } from "./_d1-mock.js";

type ManifestInput = Parameters<typeof ManifestSchema.parse>[0];

function record(
  aid: string,
  overrides: Partial<Record<string, unknown>> = {},
  publishedAt = "2026-05-01T00:00:00.000Z",
): AgentRecord {
  const input: ManifestInput = {
    manifest_version: 1,
    aid,
    description: "Reviews PRs",
    endpoints: { rpc: "https://example.com/aap/v1/rpc" },
    capabilities: [
      {
        name: "review_pull_request",
        input_schema: { type: "object" },
        output_schema: { type: "object" },
        pricing: { model: "per_call", amount: "0.50", currency: "USD" },
        accepts: ["stripe-fiat"],
      },
    ],
    ...overrides,
  };
  return {
    manifest: ManifestSchema.parse(input),
    identityJwt: `mock.jwt.${aid.replace(/[:/]/g, "_")}`,
    publishedAt,
    publishedBy: "anonymous",
    pubkey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  };
}

describe("D1Storage", () => {
  let storage: D1Storage;

  beforeEach(() => {
    storage = new D1Storage(createMockD1());
  });

  it("round-trips a published manifest", async () => {
    const rec = record("aid:agentagora:weijt606/code-review");
    await storage.putAgent(rec);

    const got = await storage.getAgent(rec.manifest.aid);
    expect(got).toBeDefined();
    expect(got?.manifest).toEqual(rec.manifest);
    expect(got?.identityJwt).toBe(rec.identityJwt);
    expect(got?.publishedAt).toBe(rec.publishedAt);
    expect(got?.publishedBy).toBe(rec.publishedBy);
  });

  it("returns undefined for a missing AID", async () => {
    expect(await storage.getAgent("aid:agentagora:nobody/missing")).toBeUndefined();
  });

  it("upserts when the same AID is published twice", async () => {
    const aid = "aid:agentagora:weijt606/code-review";
    await storage.putAgent(record(aid, { description: "first" }, "2026-05-01T00:00:00.000Z"));
    await storage.putAgent(record(aid, { description: "second" }, "2026-05-02T00:00:00.000Z"));

    const got = await storage.getAgent(aid);
    expect(got?.manifest.description).toBe("second");
    expect(got?.publishedAt).toBe("2026-05-02T00:00:00.000Z");

    const all = await storage.listAgents();
    expect(all).toHaveLength(1);
  });

  it("listAgents returns newest first", async () => {
    await storage.putAgent(record("aid:agentagora:a/x", {}, "2026-05-01T00:00:00.000Z"));
    await storage.putAgent(record("aid:agentagora:b/y", {}, "2026-05-03T00:00:00.000Z"));
    await storage.putAgent(record("aid:agentagora:c/z", {}, "2026-05-02T00:00:00.000Z"));

    const all = await storage.listAgents();
    expect(all.map((r) => r.manifest.aid)).toEqual([
      "aid:agentagora:b/y",
      "aid:agentagora:c/z",
      "aid:agentagora:a/x",
    ]);
  });

  describe("searchAgents", () => {
    beforeEach(async () => {
      await storage.putAgent(record("aid:agentagora:weijt606/code-review"));
      await storage.putAgent(
        record("aid:agentagora:alice/translator", {
          description: "Translates text between languages",
          capabilities: [
            {
              name: "translate",
              input_schema: { type: "object" },
              output_schema: { type: "object" },
              pricing: { model: "free" },
              accepts: [],
            },
          ],
        }),
      );
      await storage.putAgent(
        record("aid:agentagora:bob/usdc-shop", {
          description: "Sells widgets",
          capabilities: [
            {
              name: "buy_widget",
              input_schema: { type: "object" },
              output_schema: { type: "object" },
              pricing: { model: "per_call", amount: "0.10", currency: "USDC" },
              accepts: ["usdc-base"],
            },
          ],
        }),
      );
    });

    it("filters by capability name", async () => {
      const hits = await storage.searchAgents({ capability: "translate" });
      expect(hits.map((r) => r.manifest.aid)).toEqual(["aid:agentagora:alice/translator"]);
    });

    it("filters by accepted settlement channel", async () => {
      const hits = await storage.searchAgents({ accepts: "stripe-fiat" });
      expect(hits.map((r) => r.manifest.aid)).toEqual(["aid:agentagora:weijt606/code-review"]);

      const usdc = await storage.searchAgents({ accepts: "usdc-base" });
      expect(usdc.map((r) => r.manifest.aid)).toEqual(["aid:agentagora:bob/usdc-shop"]);
    });

    it("filters by free-text q (description and AID)", async () => {
      const byDesc = await storage.searchAgents({ q: "translates" });
      expect(byDesc.map((r) => r.manifest.aid)).toEqual(["aid:agentagora:alice/translator"]);

      const byAid = await storage.searchAgents({ q: "weijt606" });
      expect(byAid.map((r) => r.manifest.aid)).toEqual(["aid:agentagora:weijt606/code-review"]);
    });

    it("combines filters with AND", async () => {
      const empty = await storage.searchAgents({
        capability: "translate",
        accepts: "stripe-fiat",
      });
      expect(empty).toHaveLength(0);

      const matched = await storage.searchAgents({
        capability: "review_pull_request",
        accepts: "stripe-fiat",
      });
      expect(matched.map((r) => r.manifest.aid)).toEqual(["aid:agentagora:weijt606/code-review"]);
    });

    it("returns empty list when no filter matches", async () => {
      const none = await storage.searchAgents({ capability: "does_not_exist" });
      expect(none).toHaveLength(0);
    });
  });

  describe("audit events", () => {
    function event(eventId: string, ts: string, prevHash: string | null = null) {
      return AuditEventSchema.parse({
        event_id: eventId,
        conversation_id: "convo-x",
        type: "rpc.request.received",
        timestamp: ts,
        actor_aid: "aid:agentagora:weijt606/code-review",
        previous_event_hash: prevHash,
        data: {},
        signature: { alg: "EdDSA", key_id: "k1", value: "AAAA" },
      });
    }

    it("ingests and reads back events ordered by timestamp", async () => {
      await storage.ingestAuditEvent(event("e1", "2026-05-01T00:00:00.000Z"), "now");
      await storage.ingestAuditEvent(event("e2", "2026-05-01T00:00:01.000Z", "sha256:aaa"), "now");
      const events = await storage.getConversationEvents("convo-x");
      expect(events.map((e) => e.event_id)).toEqual(["e1", "e2"]);

      const latest = await storage.getLatestAuditEvent("convo-x");
      expect(latest?.event_id).toBe("e2");
    });

    it("hasAuditEvent reports presence", async () => {
      expect(await storage.hasAuditEvent("e1")).toBe(false);
      await storage.ingestAuditEvent(event("e1", "2026-05-01T00:00:00.000Z"), "now");
      expect(await storage.hasAuditEvent("e1")).toBe(true);
    });

    it("ingest is idempotent (INSERT OR IGNORE on duplicate event_id)", async () => {
      await storage.ingestAuditEvent(event("e1", "2026-05-01T00:00:00.000Z"), "first");
      await storage.ingestAuditEvent(event("e1", "2026-05-01T00:00:00.000Z"), "second");
      const events = await storage.getConversationEvents("convo-x");
      expect(events).toHaveLength(1);
    });
  });

  describe("disputes", () => {
    function dispute(overrides: Partial<DisputeRecord> = {}): DisputeRecord {
      return {
        disputeId: "disp_test_0001",
        conversationId: "convo-d1",
        filedBy: "alice",
        filerAid: "aid:agentagora:alice/code-review",
        respondentAid: "aid:agentagora:bob/translator",
        reason: "non_delivery",
        state: "open",
        filedAt: "2026-05-01T12:00:00.000Z",
        ...overrides,
      };
    }

    it("round-trips a dispute with optional fields populated", async () => {
      await storage.createDispute(dispute({ narrative: "broke things", claimedRemedy: "refund" }));
      const got = await storage.getDispute("disp_test_0001");
      expect(got?.disputeId).toBe("disp_test_0001");
      expect(got?.narrative).toBe("broke things");
      expect(got?.claimedRemedy).toBe("refund");
      expect(got?.resolvedAt).toBeUndefined();
    });

    it("round-trips a dispute with optional fields omitted", async () => {
      await storage.createDispute(dispute());
      const got = await storage.getDispute("disp_test_0001");
      expect(got?.narrative).toBeUndefined();
      expect(got?.claimedRemedy).toBeUndefined();
      expect(got?.resolvedAt).toBeUndefined();
      expect(got?.resolution).toBeUndefined();
    });

    it("returns undefined for an unknown dispute_id", async () => {
      expect(await storage.getDispute("disp_nope")).toBeUndefined();
    });

    it("getOpenDisputesByConversation returns only open rows for the convo", async () => {
      await storage.createDispute(dispute({ disputeId: "disp_open", state: "open" }));
      await storage.createDispute(
        dispute({
          disputeId: "disp_other_convo",
          conversationId: "convo-different",
          state: "open",
        }),
      );
      await storage.createDispute(
        dispute({
          disputeId: "disp_resolved",
          state: "resolved",
          resolvedAt: "2026-05-02T00:00:00.000Z",
          resolution: "ops_settled",
        }),
      );
      const got = await storage.getOpenDisputesByConversation("convo-d1");
      expect(got.map((d) => d.disputeId)).toEqual(["disp_open"]);
    });

    it("resolveDispute transitions only open disputes; redelivery is a no-op", async () => {
      await storage.createDispute(dispute({ disputeId: "disp_to_resolve", state: "open" }));
      await storage.resolveDispute("disp_to_resolve", "auto_refunded", "2026-05-03T00:00:00.000Z");
      const after = await storage.getDispute("disp_to_resolve");
      expect(after?.state).toBe("resolved");
      expect(after?.resolution).toBe("auto_refunded");
      expect(after?.resolvedAt).toBe("2026-05-03T00:00:00.000Z");

      // Second call must not mutate state again.
      await storage.resolveDispute("disp_to_resolve", "ops_overrode", "2026-05-04T00:00:00.000Z");
      const second = await storage.getDispute("disp_to_resolve");
      expect(second?.resolution).toBe("auto_refunded");
    });
  });

  describe("refunds ledger", () => {
    it("records and reads back refunds, newest first", async () => {
      await storage.recordRefund({
        refundId: "re_1",
        conversationId: "convo-r",
        amount: "0.50",
        currency: "USD",
        refundedAt: "2026-05-01T00:00:00.000Z",
        reason: "requested_by_customer",
      });
      await storage.recordRefund({
        refundId: "re_2",
        conversationId: "convo-r",
        amount: "1.25",
        currency: "USD",
        refundedAt: "2026-05-02T00:00:00.000Z",
      });
      const got = await storage.getRefundsByConversation("convo-r");
      expect(got.map((r) => r.refundId)).toEqual(["re_2", "re_1"]);
      expect(got[0]?.reason).toBeUndefined();
      expect(got[1]?.reason).toBe("requested_by_customer");
    });

    it("recordRefund is idempotent on refund_id", async () => {
      const rec = {
        refundId: "re_dup",
        conversationId: "convo-r",
        amount: "0.50",
        currency: "USD",
        refundedAt: "2026-05-01T00:00:00.000Z",
      };
      await storage.recordRefund(rec);
      await storage.recordRefund({ ...rec, amount: "999.00" }); // would-be-poison value
      const got = await storage.getRefundsByConversation("convo-r");
      expect(got).toHaveLength(1);
      expect(got[0]?.amount).toBe("0.50");
    });

    it("returns an empty list for a conversation with no refunds", async () => {
      expect(await storage.getRefundsByConversation("convo-empty")).toEqual([]);
    });
  });
});
