/**
 * End-to-end happy-path test.
 *
 * Two clients, two agents, no HTTP — everything routes through
 * MockTransport in memory. Exercises the full sign / send / verify
 * / dispatch / validate / sign-response / verify-response pipeline
 * that production HTTP transport will sit underneath.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AAPError,
  AgentAgoraClient,
  InMemoryRegistry,
  InputInvalidError,
  MockTransport,
  capability,
  createAgent,
  generatePrivateKey,
  publicKeyFrom,
} from "../src/index.js";

describe("happy path: two-agent round trip via MockTransport", () => {
  const setupTwoAgents = async () => {
    const transport = new MockTransport();
    const registry = new InMemoryRegistry();

    // ----- Responder side (Bob runs an echo agent) -----
    const bobKey = generatePrivateKey();
    const bobPubKey = await publicKeyFrom(bobKey);
    const bobAgent = createAgent({
      name: "echo",
      namespace: "bob",
      accepts: [],
      capabilities: {
        ping: capability({
          input: z.object({ message: z.string() }),
          output: z.object({ reply: z.string(), echoedMessage: z.string() }),
          price: { model: "free" },
          handler: ({ message }) => ({
            reply: `pong: ${message}`,
            echoedMessage: message,
          }),
        }),
        crash: capability({
          input: z.object({}),
          output: z.object({ ok: z.boolean() }),
          price: { model: "free" },
          handler: () => {
            throw new Error("intentional handler failure");
          },
        }),
      },
    });
    registry.register(bobAgent.aid, bobPubKey);
    await bobAgent.serve({
      transport,
      registry,
      signingKey: bobKey,
      signingKeyId: `${bobAgent.aid}#k1`,
    });

    // ----- Initiator side (Alice's orchestrator client) -----
    const aliceKey = generatePrivateKey();
    const alicePubKey = await publicKeyFrom(aliceKey);
    const aliceAid = "aid:agentagora:alice/orchestrator";
    registry.register(aliceAid, alicePubKey);

    const aliceClient = new AgentAgoraClient({
      token: "test-token",
      transport,
      registryResolver: registry,
      fromAid: aliceAid,
      signingKey: aliceKey,
      signingKeyId: `${aliceAid}#k1`,
    });

    return { aliceClient, bobAgent, transport, registry, aliceAid };
  };

  it("returns the responder's result on a valid call", async () => {
    const { aliceClient, bobAgent } = await setupTwoAgents();
    const result = await aliceClient.call<{ reply: string; echoedMessage: string }>(
      bobAgent.aid,
      "ping",
      { message: "hello world" },
    );
    expect(result.reply).toBe("pong: hello world");
    expect(result.echoedMessage).toBe("hello world");
  });

  it("rejects input that fails the responder's schema", async () => {
    const { aliceClient, bobAgent } = await setupTwoAgents();
    await expect(
      aliceClient.call(bobAgent.aid, "ping", { wrongField: 123 }),
    ).rejects.toBeInstanceOf(InputInvalidError);
  });

  it("rejects calls to an unknown capability", async () => {
    const { aliceClient, bobAgent } = await setupTwoAgents();
    await expect(aliceClient.call(bobAgent.aid, "does_not_exist", {})).rejects.toBeInstanceOf(
      InputInvalidError,
    );
  });

  it("propagates handler exceptions as Internal errors", async () => {
    const { aliceClient, bobAgent } = await setupTwoAgents();
    await expect(aliceClient.call(bobAgent.aid, "crash", {})).rejects.toMatchObject({
      code: -32099, // Internal
      message: expect.stringMatching(/intentional handler failure/),
    });
  });

  it("rejects messages from unknown senders (signature pubkey not in registry)", async () => {
    const { transport, bobAgent } = await setupTwoAgents();
    const evilKey = generatePrivateKey();
    const localRegistry = new InMemoryRegistry(); // missing bob
    localRegistry.register("aid:agentagora:eve/imposter", await publicKeyFrom(evilKey));

    const evilClient = new AgentAgoraClient({
      token: "test",
      transport,
      registryResolver: localRegistry,
      fromAid: "aid:agentagora:eve/imposter",
      signingKey: evilKey,
      signingKeyId: "aid:agentagora:eve/imposter#k1",
    });

    // The responder's registry doesn't know Eve's pubkey, so the responder
    // will reject the request with Unauthorized.
    await expect(evilClient.call(bobAgent.aid, "ping", { message: "x" })).rejects.toThrow(
      /Unauthorized|response signature verification failed|InMemoryRegistry|signature|public key/i,
    );
  });

  it("call() requires transport, resolver, signingKey, signingKeyId, fromAid", async () => {
    const c = new AgentAgoraClient({ token: "t" });
    await expect(c.call("aid:agentagora:bob/echo", "ping", {})).rejects.toThrow(/transport/);
  });

  it("AAPError thrown from server is reconstructed into the right typed subclass", async () => {
    const { aliceClient, bobAgent } = await setupTwoAgents();
    try {
      await aliceClient.call(bobAgent.aid, "does_not_exist", {});
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AAPError);
      expect(e).toBeInstanceOf(InputInvalidError);
    }
  });
});
