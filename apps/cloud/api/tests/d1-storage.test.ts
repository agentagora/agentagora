/**
 * Direct D1Storage tests.
 *
 * Runs against an in-memory node:sqlite database wrapped to look like
 * a `D1Database` (see `_d1-mock.ts`). The shim covers exactly the
 * subset of D1's API that D1Storage uses, so SQL behaviour — JSON1
 * filters, upsert, ordering — is exercised the same way it will be
 * in production.
 */

import { ManifestSchema } from "@agentagora/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { D1Storage } from "../src/d1-storage.js";
import type { AgentRecord } from "../src/storage.js";
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
});
