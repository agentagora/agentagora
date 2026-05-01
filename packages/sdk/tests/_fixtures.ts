/**
 * Shared test fixtures.
 *
 * Three test files (happy-path, audit-trail, settlement-flow) all
 * needed near-identical setup — two agents (Bob the responder, Alice
 * the initiator), an in-memory registry, a transport, and Bob serving
 * over MockTransport. This module provides one canonical builder.
 *
 * Replay-protection tests deliberately keep their own minimal `rig()`
 * because they construct envelopes manually and don't need Alice's
 * client at all.
 */

import { describe } from "vitest";
import { z } from "zod";
import {
  type Agent,
  AgentAgoraClient,
  InMemoryRegistry,
  MockTransport,
  type SettlementChannel,
  capability,
  createAgent,
  generatePrivateKey,
  publicKeyFrom,
} from "../src/index.js";

// `vitest` requires at least one test in a test-classified file, but
// `_fixtures.ts` is meant to be helpers only. Keep this no-op suite
// to satisfy the runner if it ever picks the file up.
describe.skip("fixtures (helpers only)", () => {});

export interface TwoAgentRig {
  transport: MockTransport;
  registry: InMemoryRegistry;
  bobAgent: Agent;
  bobKey: Uint8Array;
  bobKeyId: string;
  aliceClient: AgentAgoraClient;
  aliceAid: string;
  aliceKey: Uint8Array;
  aliceKeyId: string;
}

export interface TwoAgentRigOptions {
  /** Override Bob's namespace (default "bob"). */
  bobNamespace?: string;
  /** Override Bob's name (default "echo"). */
  bobName?: string;
  /** Pre-configured settlement channels for Alice's client. */
  channels?: SettlementChannel[];
  /** Override Alice's full AID (default "aid:agentagora:alice/orchestrator"). */
  aliceAid?: string;
  /**
   * Add additional capabilities to Bob beyond the defaults.
   * Default: ping (echoes a message) + crash (throws).
   */
  extraCapabilities?: Record<string, Parameters<typeof capability>[0]>;
}

/**
 * Build the canonical two-agent rig used across the SDK test suite.
 * Bob serves immediately via MockTransport; both AIDs are registered
 * in the InMemoryRegistry. Alice's client is wired with optional
 * settlement channels.
 */
export async function makeTwoAgentRig(options: TwoAgentRigOptions = {}): Promise<TwoAgentRig> {
  const transport = new MockTransport();
  const registry = new InMemoryRegistry();

  const bobNamespace = options.bobNamespace ?? "bob";
  const bobName = options.bobName ?? "echo";

  const bobKey = generatePrivateKey();
  const bobAgent = createAgent({
    name: bobName,
    namespace: bobNamespace,
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
      ...(options.extraCapabilities ?? {}),
    },
  });
  registry.register(bobAgent.aid, await publicKeyFrom(bobKey));
  const bobKeyId = `${bobAgent.aid}#k1`;
  await bobAgent.serve({
    transport,
    registry,
    signingKey: bobKey,
    signingKeyId: bobKeyId,
  });

  const aliceAid = options.aliceAid ?? "aid:agentagora:alice/orchestrator";
  const aliceKey = generatePrivateKey();
  registry.register(aliceAid, await publicKeyFrom(aliceKey));
  const aliceKeyId = `${aliceAid}#k1`;

  const aliceClient = new AgentAgoraClient({
    token: "test",
    transport,
    registryResolver: registry,
    fromAid: aliceAid,
    signingKey: aliceKey,
    signingKeyId: aliceKeyId,
    settlement: options.channels,
  });

  return {
    transport,
    registry,
    bobAgent,
    bobKey,
    bobKeyId,
    aliceClient,
    aliceAid,
    aliceKey,
    aliceKeyId,
  };
}
