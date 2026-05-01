import { AAP_VERSION } from "@agentagora/protocol";
import type { RpcRequestEnvelope } from "@agentagora/protocol";
import { describe, expect, it } from "vitest";
import { generatePrivateKey, publicKeyFrom, signEnvelope, verifyEnvelope } from "../src/signing.js";

function makeEnvelope(): RpcRequestEnvelope {
  return {
    jsonrpc: "2.0",
    id: "req_01",
    method: "aap.invoke",
    params: { capability: "review_pr", input: { pr: 42 } },
    aap: {
      version: AAP_VERSION,
      conversation_id: "conv_01",
      timestamp: "2026-04-30T12:34:56.789Z",
      nonce: "abc123",
      from: "aid:agentagora:alice/orchestrator" as never,
      to: "aid:agentagora:bob/code-review" as never,
      signature: { alg: "EdDSA", key_id: "", value: "" },
    },
  };
}

describe("signEnvelope/verifyEnvelope", () => {
  it("signs and verifies a valid envelope", async () => {
    const sk = generatePrivateKey();
    const pk = await publicKeyFrom(sk);
    const env = makeEnvelope();
    await signEnvelope(env, { privateKey: sk, keyId: "alice/orchestrator#k1" });

    expect(env.aap.signature.alg).toBe("EdDSA");
    expect(env.aap.signature.key_id).toBe("alice/orchestrator#k1");
    expect(env.aap.signature.value).not.toBe("");

    expect(await verifyEnvelope(env, pk)).toBe(true);
  });

  it("detects tampering in params", async () => {
    const sk = generatePrivateKey();
    const pk = await publicKeyFrom(sk);
    const env = makeEnvelope();
    await signEnvelope(env, { privateKey: sk, keyId: "k1" });
    (env.params as { input: { pr: number } }).input.pr = 43;
    expect(await verifyEnvelope(env, pk)).toBe(false);
  });

  it("detects tampering in aap meta (from)", async () => {
    const sk = generatePrivateKey();
    const pk = await publicKeyFrom(sk);
    const env = makeEnvelope();
    await signEnvelope(env, { privateKey: sk, keyId: "k1" });
    env.aap.from = "aid:agentagora:eve/orchestrator" as never;
    expect(await verifyEnvelope(env, pk)).toBe(false);
  });

  it("rejects verification with the wrong public key", async () => {
    const sk1 = generatePrivateKey();
    const sk2 = generatePrivateKey();
    const pk2 = await publicKeyFrom(sk2);
    const env = makeEnvelope();
    await signEnvelope(env, { privateKey: sk1, keyId: "k1" });
    expect(await verifyEnvelope(env, pk2)).toBe(false);
  });

  it("returns false on missing signature value", async () => {
    const sk = generatePrivateKey();
    const pk = await publicKeyFrom(sk);
    const env = makeEnvelope();
    expect(await verifyEnvelope(env, pk)).toBe(false);
  });
});
