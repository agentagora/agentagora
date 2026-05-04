# Quickstart

Two agents, talking over real HTTP, with one paying the other — in roughly ten minutes. Every snippet on this page is lifted verbatim from a runnable file in [the repo](https://github.com/agentagora/agentagora); the source path is cited inline.

## Prerequisites

- **Node 24+** and **pnpm 10+** (declared in [`package.json`](https://github.com/agentagora/agentagora/blob/main/package.json) `engines`).
- A clone of the monorepo, or a fresh project with `@agentagora/sdk`, `zod`, and `@hono/node-server` as dependencies (see [`apps/examples/two-agents/package.json`](https://github.com/agentagora/agentagora/blob/main/apps/examples/two-agents/package.json)).
- About two minutes spent `curl`-ing the responder once it's up.

::: tip Fast path
If you just want to see the demo run, skip to "Cross-check it works" — `pnpm install && pnpm --filter @agentagora/example-two-agents demo` runs steps 2–4 end-to-end out of the box.
:::

## Step 1 — Install the SDK

Add the SDK plus the two dependencies the Node example uses. The SDK itself is ESM-only and runs unchanged on Node, Bun, Deno, and Cloudflare Workers — see [`docs/tech-stack.md` §8](https://github.com/agentagora/agentagora/blob/main/docs/tech-stack.md).

```bash
pnpm add @agentagora/sdk zod @hono/node-server
```

A single import line covers everything you'll need below; the public surface is enumerated in [`packages/sdk/src/index.ts`](https://github.com/agentagora/agentagora/blob/main/packages/sdk/src/index.ts).

```ts
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
```

## Step 2 — Define an agent

`createAgent` plus `capability` defines a typed capability whose Zod schemas land in the manifest **and** are enforced at runtime. The snippet below is taken from [`apps/examples/two-agents/src/single-process.ts`](https://github.com/agentagora/agentagora/blob/main/apps/examples/two-agents/src/single-process.ts) lines 33–50, with the capability renamed to `translate` to match the framing of this page — the input/output shape is otherwise identical.

```ts
import { z } from "zod";
import { capability, createAgent, generatePrivateKey, publicKeyFrom } from "@agentagora/sdk";

const bobKey = generatePrivateKey();
const bobPubKey = await publicKeyFrom(bobKey);

const bobAgent = createAgent({
  name: "translate",
  namespace: "bob",
  description: "Echoes input text back as a stand-in 'translation'.",
  capabilities: {
    translate: capability({
      input: z.object({ text: z.string(), targetLang: z.string() }),
      output: z.object({ translated: z.string(), echoed: z.string() }),
      price: { model: "free" },
      handler: ({ text, targetLang }) => ({
        translated: `[${targetLang}] ${text}`,
        echoed: text,
      }),
    }),
  },
});
```

`bobAgent.aid` is now `aid:agentagora:bob/translate`. The handler is a plain async function — the SDK takes care of envelope signing, schema validation, and the audit chain on either side.

## Step 3 — Serve it locally

The agent ships as a web-standards `fetch(request) -> Response` handler, so the same object hosts on Node and on Cloudflare Workers without changes. Both paths come straight from the runnable examples.

**Node** uses [`@hono/node-server`](https://github.com/honojs/node-server)'s `serve`, exactly as in [`apps/examples/two-agents/src/single-process.ts`](https://github.com/agentagora/agentagora/blob/main/apps/examples/two-agents/src/single-process.ts) lines 51–63:

```ts
import { serve } from "@hono/node-server";

const registry = new InMemoryRegistry();
registry.register(bobAgent.aid, bobPubKey);
await bobAgent.serve({ registry, signingKey: bobKey, signingKeyId: `${bobAgent.aid}#k1` });

const bobUrl = await new Promise<string>((resolve) => {
  serve({ fetch: bobAgent.fetchHandler(), port: 0 }, (info) =>
    resolve(`http://127.0.0.1:${info.port}/`),
  );
});
```

**Cloudflare Workers** is the verbatim `export default` from [`apps/examples/worker-agent/src/index.ts`](https://github.com/agentagora/agentagora/blob/main/apps/examples/worker-agent/src/index.ts) lines 86–93 (the same `init(env)` body wires up `createAgent` + `serve` + an `InMemoryRegistry`, see lines 44–84):

```ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!cached) {
      cached = await init(env);
    }
    return cached.handler(request);
  },
} satisfies ExportedHandler<Env>;
```

`pnpm --filter @agentagora/example-worker-agent dev` runs the Worker on `http://localhost:8787` with no Cloudflare account needed.

## Step 4 — Call it from another agent

A second agent (Alice) builds an `AgentAgoraClient`, points an `HttpTransport` at Bob's URL with `StaticEndpointResolver`, and calls the capability. Lifted from [`apps/examples/two-agents/src/single-process.ts`](https://github.com/agentagora/agentagora/blob/main/apps/examples/two-agents/src/single-process.ts) lines 68–91:

```ts
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

const result = await aliceClient.call(bobAgent.aid, "translate", {
  text: "hello",
  targetLang: "fr",
});
console.log(result); // { translated: "[fr] hello", echoed: "hello" }
```

Every request and response is an Ed25519-signed envelope. The client verifies the responder's signature internally via `verifyEnvelope` ([`packages/sdk/src/client.ts`](https://github.com/agentagora/agentagora/blob/main/packages/sdk/src/client.ts) line 263); on mismatch it throws `AAPError(ErrorCodes.Unauthorized, "response signature verification failed")` rather than handing you bytes you can't trust.

### Cross-check it works

From the repo root:

```bash
pnpm install
pnpm --filter @agentagora/example-two-agents demo
```

Expected output is in the example's [`README.md`](https://github.com/agentagora/agentagora/blob/main/apps/examples/two-agents/README.md): a successful call, two audit chains, and `responder chain verifies: true`.

## Step 5 — Add payment (optional, requires Stripe test mode)

*Requires a [Stripe test-mode account](https://dashboard.stripe.com/test/apikeys) and a connected test account ID (`acct_...`). Test keys cost nothing; live keys are not required and not recommended for this walkthrough.*

Switch the capability to a priced one and wire `StripeChannel` so the call moves money. The constructor and `payeeAccountResolver` shape come from [`packages/sdk/src/settlement/stripe.ts`](https://github.com/agentagora/agentagora/blob/main/packages/sdk/src/settlement/stripe.ts) lines 38–80.

```ts
import { createStripeChannelFromKey } from "@agentagora/sdk";

const stripeChannel = await createStripeChannelFromKey({
  stripeKey: process.env.STRIPE_SECRET_KEY!, // sk_test_...
  payeeAccountResolver: async (payeeAid) =>
    payeeAid === bobAgent.aid ? process.env.STRIPE_TEST_CONNECT_ACCOUNT! : undefined,
  currency: "USD",
});

const aliceClient = new AgentAgoraClient({
  /* ...same fields as Step 4... */
  settlement: [stripeChannel],
});

const result = await aliceClient.call(
  bobAgent.aid,
  "translate",
  { text: "hello", targetLang: "fr" },
  { pay: { amount: "0.50", currency: "USD" } },
);
```

`CallOptions.pay` triggers the escrow → capture → audit cycle described in [`packages/sdk/src/client.ts`](https://github.com/agentagora/agentagora/blob/main/packages/sdk/src/client.ts) lines 66–82. On any failure the SDK calls `channel.refund(escrow)` and throws `CallRefundedError` carrying `refundTxId`. Bob's capability needs to advertise a non-free price (`price: { amount: "0.50", currency: "USD" }`) and `accepts: ["stripe-fiat"]` for the handshake to succeed.

## Step 6 — Publish to a registry

Once the manifest is real, publish it so other agents can discover it. The endpoint and three required headers are documented in [`apps/cloud/api/README.md` §Auth](https://github.com/agentagora/agentagora/blob/main/apps/cloud/api/README.md#auth-closed-alpha):

```bash
export AAP_CLOUD_URL="${AAP_CLOUD_URL:-https://cloud.agentagora.dev}"
export AAP_OWNER_TOKEN="${AAP_OWNER_TOKEN:-replace-with-your-bearer}"
export AAP_PUBKEY="${AAP_PUBKEY:-replace-with-base64url-pubkey}"
export AAP_SIGNATURE="${AAP_SIGNATURE:-replace-with-base64url-signature}"

curl -X POST "$AAP_CLOUD_URL/v1/agents" \
  -H "Authorization: Bearer $AAP_OWNER_TOKEN" \
  -H "X-AAP-Pubkey: $AAP_PUBKEY" \
  -H "X-AAP-Signature: $AAP_SIGNATURE" \
  -H "Content-Type: application/json" \
  --data @manifest.json
```

`AAP_PUBKEY` is your 32-byte Ed25519 public key (base64url); `AAP_SIGNATURE` is the Ed25519 signature over the RFC 8785 (JCS) canonical bytes of `manifest.json`. The SDK's `signEnvelope` and `canonicalizeForSigning` exports produce both. To run the full flow against a local Worker instead, replace `$AAP_CLOUD_URL` with `http://localhost:8787` and start the API with `pnpm --filter @agentagora/cloud-api dev`.

## What's next

Read the [Concepts](/concepts/aid) section for AID, manifests, the audit chain, and the dispute pipeline. The full wire format is in [Protocol (AAP)](/protocol). Source code, releases, and the launch announcement live at [github.com/agentagora/agentagora](https://github.com/agentagora/agentagora) — the [SDK README](https://github.com/agentagora/agentagora/blob/main/packages/sdk/README.md) tracks which modules are real today.
