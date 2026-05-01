/**
 * AgentAgora agent deployed as a Cloudflare Worker.
 *
 * The same @agentagora/sdk that runs on Node powers this Worker
 * unchanged — proof of the "web-standards-only" design principle in
 * docs/tech-stack.md §8.
 *
 * Endpoints:
 *   GET  /            — liveness JSON `{ aid, ok: true }`
 *   POST /            — AAP RPC envelope (signed JSON-RPC 2.0)
 *
 * Local dev:  pnpm --filter @agentagora/example-worker-agent dev
 * Dry-run build: pnpm --filter @agentagora/example-worker-agent check
 * Real deploy:    pnpm --filter @agentagora/example-worker-agent deploy
 *                 (requires `wrangler login` first)
 */

import {
  type Agent,
  InMemoryRegistry,
  capability,
  createAgent,
  generatePrivateKey,
  publicKeyFrom,
} from "@agentagora/sdk";
import { z } from "zod";

interface Env {
  /** Optional override for the namespace segment of the AID. */
  AGENT_NAMESPACE?: string;
  /** Optional override for the name segment of the AID. */
  AGENT_NAME?: string;
}

// Module-scope cache: persists across requests served by the same
// Worker isolate. Cold starts (new isolates) re-initialize.
let cached:
  | {
      agent: Agent;
      handler: (request: Request) => Promise<Response>;
    }
  | undefined;

async function init(env: Env): Promise<NonNullable<typeof cached>> {
  const namespace = env.AGENT_NAMESPACE ?? "demo";
  const name = env.AGENT_NAME ?? "echo";

  // NB: ephemeral key — fine for a public demo, NOT for production.
  // For production, plumb a stable key in via a Wrangler secret
  // binding and decode it here.
  const signingKey = generatePrivateKey();
  const publicKey = await publicKeyFrom(signingKey);

  const registry = new InMemoryRegistry();

  const agent = createAgent({
    name,
    namespace,
    description: "Demo AgentAgora agent running on Cloudflare Workers.",
    capabilities: {
      ping: capability({
        input: z.object({ message: z.string() }),
        output: z.object({
          reply: z.string(),
          servedFrom: z.string(),
        }),
        price: { model: "free" },
        handler: ({ message }) => ({
          reply: `pong from worker: ${message}`,
          servedFrom: "cloudflare-workers",
        }),
      }),
    },
  });

  registry.register(agent.aid, publicKey);
  await agent.serve({
    registry,
    signingKey,
    signingKeyId: `${agent.aid}#k1`,
  });

  return { agent, handler: agent.fetchHandler() };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!cached) {
      cached = await init(env);
    }
    return cached.handler(request);
  },
} satisfies ExportedHandler<Env>;
