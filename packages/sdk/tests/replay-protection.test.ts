/**
 * Replay protection per AAP-spec §11.1.
 *
 * Receivers MUST reject envelopes whose timestamp is more than 5
 * minutes in the past or 30 seconds in the future, AND MUST reject
 * envelopes whose nonce has been seen for the same
 * (conversation_id, from) pair.
 *
 * These tests bypass the normal client.call() flow and directly
 * craft envelopes so we can manipulate timestamp and nonce.
 */

import {
  AAP_VERSION,
  type AidString,
  Methods,
  type RpcRequestEnvelope,
  type RpcResponseEnvelope,
} from "@agentagora/protocol";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type Agent,
  InMemoryRegistry,
  capability,
  createAgent,
  generatePrivateKey,
  publicKeyFrom,
  signEnvelope,
} from "../src/index.js";

interface TestRig {
  agent: Agent;
  aliceAid: string;
  aliceKey: Uint8Array;
  aliceKeyId: string;
}

async function rig(): Promise<TestRig> {
  const registry = new InMemoryRegistry();

  const bobKey = generatePrivateKey();
  const agent = createAgent({
    name: "echo",
    namespace: "bob",
    capabilities: {
      ping: capability({
        input: z.object({ message: z.string() }),
        output: z.object({ reply: z.string() }),
        price: { model: "free" },
        handler: ({ message }) => ({ reply: `pong: ${message}` }),
      }),
    },
  });
  registry.register(agent.aid, await publicKeyFrom(bobKey));

  const aliceAid = "aid:agentagora:alice/orchestrator";
  const aliceKey = generatePrivateKey();
  registry.register(aliceAid, await publicKeyFrom(aliceKey));
  const aliceKeyId = `${aliceAid}#k1`;

  await agent.serve({
    registry,
    signingKey: bobKey,
    signingKeyId: `${agent.aid}#k1`,
  });

  return { agent, aliceAid, aliceKey, aliceKeyId };
}

async function makeRequest(
  r: TestRig,
  options: {
    timestamp?: string;
    nonce?: string;
    conversationId?: string;
  } = {},
): Promise<RpcRequestEnvelope> {
  const env: RpcRequestEnvelope = {
    jsonrpc: "2.0",
    id: "req_test",
    method: Methods.Invoke,
    params: { capability: "ping", input: { message: "hi" } },
    aap: {
      version: AAP_VERSION,
      conversation_id: options.conversationId ?? "conv_test",
      timestamp: options.timestamp ?? new Date().toISOString(),
      nonce: options.nonce ?? `nonce_${Math.random().toString(36).slice(2)}`,
      from: r.aliceAid as AidString,
      to: r.agent.aid as AidString,
      signature: { alg: "EdDSA", key_id: r.aliceKeyId, value: "" },
    },
  };
  await signEnvelope(env, { privateKey: r.aliceKey, keyId: r.aliceKeyId });
  return env;
}

function isError(res: RpcResponseEnvelope): res is RpcResponseEnvelope & {
  error: { code: number; message: string };
} {
  return "error" in res;
}

describe("replay protection — timestamp window", () => {
  it("accepts a fresh envelope (now)", async () => {
    const r = await rig();
    const env = await makeRequest(r);
    const res = await r.agent.handle(env);
    expect(isError(res)).toBe(false);
  });

  it("accepts an envelope at the edge of the past tolerance (4 min ago)", async () => {
    const r = await rig();
    const env = await makeRequest(r, {
      timestamp: new Date(Date.now() - 4 * 60_000).toISOString(),
    });
    const res = await r.agent.handle(env);
    expect(isError(res)).toBe(false);
  });

  it("rejects an envelope > 5 minutes in the past", async () => {
    const r = await rig();
    const env = await makeRequest(r, {
      timestamp: new Date(Date.now() - 6 * 60_000).toISOString(),
    });
    const res = await r.agent.handle(env);
    expect(isError(res)).toBe(true);
    if (isError(res)) {
      expect(res.error.code).toBe(-32001); // Unauthorized
      expect(res.error.message).toMatch(/too old/);
    }
  });

  it("rejects an envelope > 30 seconds in the future", async () => {
    const r = await rig();
    const env = await makeRequest(r, {
      timestamp: new Date(Date.now() + 60_000).toISOString(),
    });
    const res = await r.agent.handle(env);
    expect(isError(res)).toBe(true);
    if (isError(res)) {
      expect(res.error.code).toBe(-32001);
      expect(res.error.message).toMatch(/future/);
    }
  });

  it("rejects an envelope with malformed timestamp", async () => {
    const r = await rig();
    const env = await makeRequest(r, { timestamp: "not-a-date" });
    // Need to bypass validation since the schema requires a specific
    // format — manually construct without re-running through the schema.
    const env2 = { ...env, aap: { ...env.aap, timestamp: "not-a-date" } };
    await signEnvelope(env2, { privateKey: r.aliceKey, keyId: r.aliceKeyId });
    const res = await r.agent.handle(env2);
    expect(isError(res)).toBe(true);
    if (isError(res)) {
      expect(res.error.message).toMatch(/invalid envelope timestamp/);
    }
  });
});

describe("replay protection — nonce uniqueness", () => {
  it("accepts the first occurrence of a nonce", async () => {
    const r = await rig();
    const env = await makeRequest(r);
    const res = await r.agent.handle(env);
    expect(isError(res)).toBe(false);
  });

  it("rejects a second envelope with the same (conv_id, from, nonce)", async () => {
    const r = await rig();
    const env = await makeRequest(r, { conversationId: "conv_a", nonce: "n1" });
    const first = await r.agent.handle(env);
    expect(isError(first)).toBe(false);

    // Re-send the exact same envelope (signature still valid).
    const replayed = await r.agent.handle(env);
    expect(isError(replayed)).toBe(true);
    if (isError(replayed)) {
      expect(replayed.error.code).toBe(-32001);
      expect(replayed.error.message).toMatch(/replay/);
    }
  });

  it("allows the same nonce in a different conversation_id", async () => {
    const r = await rig();
    const a = await makeRequest(r, { conversationId: "conv_a", nonce: "shared" });
    const b = await makeRequest(r, { conversationId: "conv_b", nonce: "shared" });
    expect(isError(await r.agent.handle(a))).toBe(false);
    expect(isError(await r.agent.handle(b))).toBe(false);
  });
});
