import { describe, expect, it } from "vitest";
import { AidSchema, formatAid, isPublicRegistry, parseAid } from "../src/identity.js";

describe("parseAid", () => {
  it("parses a basic public-registry AID", () => {
    const a = parseAid("aid:agentagora:weijt606/code-review");
    expect(a.registry).toBe("agentagora");
    expect(a.namespace).toBe("weijt606");
    expect(a.name).toBe("code-review");
    expect(a.fragment).toBeUndefined();
  });

  it("parses an AID with a fragment", () => {
    const a = parseAid("aid:agentagora:weijt606/code-review#v2");
    expect(a.fragment).toBe("v2");
  });

  it("parses a self-hosted AID", () => {
    const a = parseAid("aid:registry.example.com:ops/incident-bot");
    expect(a.registry).toBe("registry.example.com");
    expect(isPublicRegistry(a)).toBe(false);
  });

  it("recognizes the public registry", () => {
    const a = parseAid("aid:agentagora:foo/bar");
    expect(isPublicRegistry(a)).toBe(true);
  });

  it.each([
    "",
    "not-an-aid",
    "aid:registry:foo",
    "aid::foo/bar",
    "aid:registry:/bar",
    "aid:registry:foo/",
    "did:agentagora:foo/bar",
    "aid:agentagora:foo bar/x",
    "aid:agentagora:foo/bar baz",
  ])("rejects invalid AID %j", (bad) => {
    expect(() => parseAid(bad)).toThrow();
  });
});

describe("formatAid", () => {
  it("roundtrips parse → format", () => {
    const s = "aid:agentagora:acme-corp/procurement#v1";
    expect(formatAid(parseAid(s))).toBe(s);
  });

  it("omits the fragment when undefined", () => {
    expect(formatAid({ registry: "r", namespace: "n", name: "x" })).toBe("aid:r:n/x");
  });
});

describe("AidSchema", () => {
  it("accepts a valid AID and returns a branded string", () => {
    const out = AidSchema.parse("aid:agentagora:foo/bar");
    expect(out).toBe("aid:agentagora:foo/bar");
  });

  it("rejects an invalid AID with a useful message", () => {
    const r = AidSchema.safeParse("nope");
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/invalid AID/);
    }
  });
});
