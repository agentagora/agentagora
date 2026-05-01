/**
 * Single-process demo: spins up Bob the responder behind a Hono +
 * @hono/node-server HTTP listener, then has Alice's client call him
 * through the real HttpTransport. Logs everything you'd want to see
 * to convince yourself the pipeline is end-to-end signed and audited.
 *
 * Run with:
 *
 *   pnpm --filter @agentagora/example-two-agents demo
 */

import type { AddressInfo } from "node:net";
import {
  AgentAgoraClient,
  HttpTransport,
  InMemoryRegistry,
  StaticEndpointResolver,
  capability,
  createAgent,
  generatePrivateKey,
  publicKeyFrom,
} from "@agentagora/sdk";
import { serve } from "@hono/node-server";
import { z } from "zod";

const sep = (label: string) => console.log(`\n── ${label} ${"─".repeat(60 - label.length - 4)}`);

async function main() {
  sep("setup");
  const registry = new InMemoryRegistry();

  // Bob runs an "echo" agent.
  const bobKey = generatePrivateKey();
  const bobPubKey = await publicKeyFrom(bobKey);
  const bobAgent = createAgent({
    name: "echo",
    namespace: "bob",
    description: "Returns the message you sent it, prefixed with 'pong: '",
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
    },
  });
  registry.register(bobAgent.aid, bobPubKey);
  await bobAgent.serve({
    registry,
    signingKey: bobKey,
    signingKeyId: `${bobAgent.aid}#k1`,
  });

  // Bind Bob's fetchHandler behind a real HTTP listener on a random port.
  const bobUrl = await new Promise<string>((resolve) => {
    serve({ fetch: bobAgent.fetchHandler(), port: 0 }, (info: AddressInfo) => {
      resolve(`http://127.0.0.1:${info.port}/`);
    });
  });
  console.log(`bob serving at ${bobUrl}`);
  console.log(`bob aid:       ${bobAgent.aid}`);

  // Alice's client uses HttpTransport pointing at Bob.
  const aliceKey = generatePrivateKey();
  const alicePubKey = await publicKeyFrom(aliceKey);
  const aliceAid = "aid:agentagora:alice/orchestrator";
  registry.register(aliceAid, alicePubKey);

  const aliceClient = new AgentAgoraClient({
    token: "demo",
    transport: new HttpTransport({
      endpointResolver: new StaticEndpointResolver({ [bobAgent.aid]: bobUrl }),
    }),
    registryResolver: registry,
    fromAid: aliceAid,
    signingKey: aliceKey,
    signingKeyId: `${aliceAid}#k1`,
  });
  console.log(`alice aid:     ${aliceAid}`);

  // ---- The actual call ----
  sep("call");
  const conv = await aliceClient.callRich(bobAgent.aid, "ping", {
    message: "hello from alice",
  });
  console.log("status:        ", conv.status);
  console.log("result:        ", conv.result);

  // ---- Verify both audit logs ----
  sep("audit");
  console.log(`initiator events (alice, ${conv.audit.events.length}):`);
  for (const ev of conv.audit.events) {
    console.log(`  ${ev.timestamp}  ${ev.type.padEnd(28)}  by ${ev.actor_aid}`);
  }
  console.log(`initiator chain verifies: ${conv.audit.verifyChain()}`);

  const responderLog = bobAgent.getAuditLog(conv.id);
  console.log(`\nresponder events (bob, ${responderLog?.events.length ?? 0}):`);
  for (const ev of responderLog?.events ?? []) {
    console.log(`  ${ev.timestamp}  ${ev.type.padEnd(28)}  by ${ev.actor_aid}`);
  }
  console.log(`responder chain verifies: ${responderLog?.verifyChain()}`);

  sep("done");
  console.log("if you reached here, the SDK is working end-to-end over HTTP.");
  process.exit(0);
}

main().catch((err) => {
  console.error("demo failed:", err);
  process.exit(1);
});
