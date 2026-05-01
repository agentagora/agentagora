import { describe, expect, it } from "vitest";
import { CapabilitySchema, ManifestSchema, PricingSchema, getCapability } from "../src/manifest.js";

const baseCap = {
  name: "review_pull_request",
  input_schema: { type: "object" },
  output_schema: { type: "object" },
  pricing: { model: "per_call" as const, amount: "0.50", currency: "USD" },
  accepts: ["stripe-fiat"],
};

describe("PricingSchema", () => {
  it("paid pricing requires amount and currency", () => {
    expect(PricingSchema.safeParse({ model: "per_call" }).success).toBe(false);
  });

  it("free pricing rejects amount", () => {
    expect(
      PricingSchema.safeParse({ model: "free", amount: "1.00", currency: "USD" }).success,
    ).toBe(false);
  });

  it("free pricing without amount/currency is OK", () => {
    expect(PricingSchema.safeParse({ model: "free" }).success).toBe(true);
  });

  it("rejects malformed decimal amounts", () => {
    expect(
      PricingSchema.safeParse({ model: "per_call", amount: "0.5.0", currency: "USD" }).success,
    ).toBe(false);
  });
});

describe("CapabilitySchema", () => {
  it("accepts a basic paid capability", () => {
    expect(CapabilitySchema.safeParse(baseCap).success).toBe(true);
  });

  it("paid capability without settlement channel is rejected", () => {
    const r = CapabilitySchema.safeParse({ ...baseCap, accepts: [] });
    expect(r.success).toBe(false);
  });

  it("free capability without settlement channel is OK", () => {
    const r = CapabilitySchema.safeParse({
      ...baseCap,
      pricing: { model: "free" },
      accepts: [],
    });
    expect(r.success).toBe(true);
  });

  it("rejects capability name with invalid identifier characters", () => {
    expect(CapabilitySchema.safeParse({ ...baseCap, name: "review-pr" }).success).toBe(false);
  });
});

describe("ManifestSchema", () => {
  const baseManifest = {
    manifest_version: 1 as const,
    aid: "aid:agentagora:weijt606/code-review",
    endpoints: { rpc: "https://example.com/aap/v1/rpc" },
    capabilities: [baseCap],
  };

  it("accepts a minimal valid manifest", () => {
    expect(ManifestSchema.safeParse(baseManifest).success).toBe(true);
  });

  it("requires at least one capability", () => {
    const r = ManifestSchema.safeParse({ ...baseManifest, capabilities: [] });
    expect(r.success).toBe(false);
  });

  it("rejects an invalid AID at the top level", () => {
    expect(ManifestSchema.safeParse({ ...baseManifest, aid: "not-an-aid" }).success).toBe(false);
  });

  it("getCapability finds and throws appropriately", () => {
    const m = ManifestSchema.parse(baseManifest);
    expect(getCapability(m, "review_pull_request").name).toBe("review_pull_request");
    expect(() => getCapability(m, "missing")).toThrow(/capability not found/);
  });
});
