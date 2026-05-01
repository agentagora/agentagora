/**
 * Integration test: real HTTP between two agents in one process.
 *
 * Spins up @hono/node-server on a random localhost port, hosting
 * Bob's agent's fetchHandler. Alice's client uses HttpTransport to
 * call him over real HTTP — exercising the production code path
 * end-to-end (signing, fetch, parsing, signature verification, audit
 * log writing on both sides).
 */

import type { AddressInfo } from "node:net";
import { type ServerType, serve } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AgentAgoraClient,
  HttpTransport,
  InMemoryRegistry,
  StaticEndpointResolver,
  capability,
  createAgent,
  generatePrivateKey,
  publicKeyFrom,
} from "../src/index.js";
import type { Agent } from "../src/index.js";

let server: ServerType | undefined;
let bobAgent: Agent;
let aliceClient: AgentAgoraClient;
let bobUrl: string;

beforeAll(async () => {
  const registry = new InMemoryRegistry();

  // Responder side.
  const bobKey = generatePrivateKey();
  const bobPubKey = await publicKeyFrom(bobKey);
  bobAgent = createAgent({
    name: "echo",
    namespace: "bob",
    accepts: [],
    capabilities: {
      ping: capability({
        input: z.object({ message: z.string() }),
        output: z.object({ reply: z.string() }),
        price: { model: "free" },
        handler: ({ message }) => ({ reply: `pong: ${message}` }),
      }),
    },
  });
  registry.register(bobAgent.aid, bobPubKey);
  await bobAgent.serve({
    registry,
    signingKey: bobKey,
    signingKeyId: `${bobAgent.aid}#k1`,
  });

  // Bind Bob's fetch handler to a random localhost port.
  await new Promise<void>((resolve) => {
    server = serve({ fetch: bobAgent.fetchHandler(), port: 0 }, (info: AddressInfo) => {
      bobUrl = `http://127.0.0.1:${info.port}/`;
      resolve();
    });
  });

  // Initiator side.
  const aliceKey = generatePrivateKey();
  const alicePubKey = await publicKeyFrom(aliceKey);
  const aliceAid = "aid:agentagora:alice/orchestrator";
  registry.register(aliceAid, alicePubKey);

  aliceClient = new AgentAgoraClient({
    token: "test",
    transport: new HttpTransport({
      endpointResolver: new StaticEndpointResolver({ [bobAgent.aid]: bobUrl }),
    }),
    registryResolver: registry,
    fromAid: aliceAid,
    signingKey: aliceKey,
    signingKeyId: `${aliceAid}#k1`,
  });
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  }
});

describe("real HTTP round-trip via @hono/node-server", () => {
  it("Alice calls Bob over HTTP and gets a verified result", async () => {
    const result = await aliceClient.call<{ reply: string }>(bobAgent.aid, "ping", {
      message: "hello over http",
    });
    expect(result.reply).toBe("pong: hello over http");
  });

  it("audit logs from both sides verify after a real-HTTP call", async () => {
    const conv = await aliceClient.callRich(bobAgent.aid, "ping", { message: "logged" });
    expect(conv.audit.verifyChain()).toBe(true);

    const responderLog = bobAgent.getAuditLog(conv.id);
    expect(responderLog?.verifyChain()).toBe(true);
    expect(responderLog?.events).toHaveLength(2);
  });

  it("liveness GET returns ok", async () => {
    const res = await fetch(bobUrl);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { aid: string; ok: boolean };
    expect(body.ok).toBe(true);
    expect(body.aid).toBe(bobAgent.aid);
  });
});
