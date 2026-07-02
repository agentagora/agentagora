/**
 * Golden-path demo, responder side ("Bob").
 *
 * What this demonstrates that single-process.ts does not: the full
 * PRODUCT loop against a running cloud-api (docs/local-dev.md):
 *
 *   1. Bob publishes his signed manifest to the registry (POST /v1/agents)
 *   2. Bob serves over real HTTP, verifying INBOUND callers' signatures
 *      by resolving their identity certificates from the same registry
 *      (HttpRegistry — no InMemoryRegistry, no hardcoded keys)
 *   3. Bob's audit chain is pushed to the cloud (POST /v1/audit/ingest)
 *      so his owner can watch conversations in the dashboard
 *
 * Run (after the local-dev cloud-api is up):
 *
 *   export AGENTAGORA_TOKEN=<owner token from local-dev seed>
 *   pnpm --filter @agentagora/example-two-agents demo:server
 */

import type { AddressInfo } from "node:net";
import {
  type AidString,
  CloudAuditSink,
  HttpRegistry,
  capability,
  createAgent,
  publishAgent,
} from "@agentagora/sdk";
import { serve } from "@hono/node-server";
import { z } from "zod";
import { CLOUD_URL, loadOrCreateKey, requireOwnerToken, sep } from "./_shared.js";

const PORT = Number(process.env.PORT ?? 4602);

const FORTUNES = [
  "An agent that audits its own escrow never loses sleep.",
  "The chain that hashes together, stays together.",
  "Trust is earned one signed envelope at a time.",
];

async function main() {
  sep("bob: identity");
  const ownerToken = requireOwnerToken();
  const bobKey = loadOrCreateKey(new URL("../.bob.key", import.meta.url).pathname);

  const bobAgent = createAgent({
    name: "echo",
    namespace: "bob",
    description: "Echo + fortunes. The responder half of the golden-path demo.",
    capabilities: {
      ping: capability({
        input: z.object({ message: z.string() }),
        output: z.object({ reply: z.string(), echoedMessage: z.string() }),
        price: { model: "free" },
        handler: ({ message }) => ({ reply: `pong: ${message}`, echoedMessage: message }),
      }),
      fortune: capability({
        input: z.object({ topic: z.string() }),
        output: z.object({ fortune: z.string() }),
        price: { model: "per_call", amount: "0.50", currency: "USD" },
        handler: ({ topic }) => ({
          fortune: `${FORTUNES[topic.length % FORTUNES.length]}`,
        }),
      }),
    },
  });

  sep("bob: serve over HTTP");
  // Bob verifies inbound callers against the SAME registry Alice publishes
  // to — this is the cross-party trust link the mocks always faked.
  const registry = new HttpRegistry({ baseUrl: CLOUD_URL });
  await bobAgent.serve({
    registry,
    signingKey: bobKey,
    signingKeyId: `${bobAgent.aid}#k1`,
  });
  const url = await new Promise<string>((resolve) => {
    serve({ fetch: bobAgent.fetchHandler(), port: PORT }, (info: AddressInfo) =>
      resolve(process.env.PUBLIC_URL ?? `http://localhost:${info.port}`),
    );
  });
  console.log(`bob (${bobAgent.aid}) listening at ${url}`);

  sep("bob: publish manifest to registry");
  const result = await publishAgent({
    baseUrl: CLOUD_URL,
    ownerToken,
    privateKey: bobKey,
    manifest: {
      manifest_version: 1,
      aid: bobAgent.aid as AidString,
      description: "Echo + fortunes. The responder half of the golden-path demo.",
      endpoints: { rpc: url },
      capabilities: [
        {
          name: "ping",
          input_schema: { type: "object", properties: { message: { type: "string" } } },
          output_schema: { type: "object", properties: { reply: { type: "string" } } },
          pricing: { model: "free" },
          sla: {},
          accepts: [],
        },
        {
          name: "fortune",
          input_schema: { type: "object", properties: { topic: { type: "string" } } },
          output_schema: { type: "object", properties: { fortune: { type: "string" } } },
          pricing: { model: "per_call", amount: "0.50", currency: "USD" },
          sla: {},
          accepts: ["stripe-fiat"],
        },
      ],
      privacy: { data_retention_days: 7, pii_handling: "redact", region_restriction: [] },
      metadata: { tags: ["demo"], languages: ["en"], models_used: [] },
    },
  });
  console.log(`published: ${result.aid} (pinned pubkey ${result.pubkey.slice(0, 12)}…)`);

  sep("bob: audit sync loop");
  // Push every conversation's chain to the cloud so the dashboard's
  // conversation viewer shows what Bob did, as it happens.
  const sink = new CloudAuditSink({ baseUrl: CLOUD_URL });
  setInterval(async () => {
    for (const conversationId of bobAgent.listConversations()) {
      const log = bobAgent.getAuditLog(conversationId);
      if (!log) continue;
      try {
        const { pushed } = await sink.sync(log);
        if (pushed > 0) console.log(`audit: pushed ${pushed} event(s) for ${conversationId}`);
      } catch (err) {
        console.warn(`audit: sync failed for ${conversationId}: ${(err as Error).message}`);
      }
    }
  }, 2000);

  console.log("\nready — run the client in another terminal:");
  console.log("  pnpm --filter @agentagora/example-two-agents demo:client");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
