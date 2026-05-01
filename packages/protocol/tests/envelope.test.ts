import { describe, expect, it } from "vitest";
import { AAP_VERSION } from "../src/constants.js";
import { RpcRequestEnvelopeSchema } from "../src/envelope.js";

const validEnvelope = {
  jsonrpc: "2.0" as const,
  id: "req_01HX",
  method: "aap.invoke",
  params: { capability: "review_pr", input: { pr: 42 } },
  aap: {
    version: AAP_VERSION,
    conversation_id: "conv_01HX",
    timestamp: "2026-04-30T12:34:56.789Z",
    nonce: "abc123",
    from: "aid:agentagora:alice/orchestrator",
    to: "aid:agentagora:bob/code-review",
    signature: {
      alg: "EdDSA" as const,
      key_id: "alice/orchestrator#k1",
      value: "base64url-sig",
    },
  },
};

describe("RpcRequestEnvelopeSchema", () => {
  it("accepts a complete signed envelope", () => {
    expect(RpcRequestEnvelopeSchema.safeParse(validEnvelope).success).toBe(true);
  });

  it("rejects unsupported jsonrpc version", () => {
    const r = RpcRequestEnvelopeSchema.safeParse({
      ...validEnvelope,
      jsonrpc: "1.0",
    });
    expect(r.success).toBe(false);
  });

  it("rejects timestamp without millisecond precision", () => {
    const r = RpcRequestEnvelopeSchema.safeParse({
      ...validEnvelope,
      aap: { ...validEnvelope.aap, timestamp: "2026-04-30T12:34:56Z" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid AID in `from`", () => {
    const r = RpcRequestEnvelopeSchema.safeParse({
      ...validEnvelope,
      aap: { ...validEnvelope.aap, from: "not-an-aid" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown signature alg", () => {
    const r = RpcRequestEnvelopeSchema.safeParse({
      ...validEnvelope,
      aap: {
        ...validEnvelope.aap,
        signature: { ...validEnvelope.aap.signature, alg: "RS256" },
      },
    });
    expect(r.success).toBe(false);
  });

  it("requires conversation_id", () => {
    const { conversation_id: _omit, ...aapWithout } = validEnvelope.aap;
    const r = RpcRequestEnvelopeSchema.safeParse({ ...validEnvelope, aap: aapWithout });
    expect(r.success).toBe(false);
  });
});
