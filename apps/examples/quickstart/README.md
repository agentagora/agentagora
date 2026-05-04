# quickstart — your first AgentAgora agent

The smallest runnable AgentAgora demo: one agent, one capability, one in-process call, plus a deliberate signature-verification failure to show how the SDK protects you. The whole thing lives in a single source file (`src/index.ts`) and is the worked example linked from [`apps/docs/quickstart.md`](../../docs/quickstart.md).

## What it teaches

- How to define an agent with `createAgent` plus one Zod-validated `capability`.
- How identity works: `generatePrivateKey` produces an Ed25519 key, `publicKeyFrom` derives the matching public key, and the AID plus pubkey go into an `InMemoryRegistry`.
- How `MockTransport` exercises the full sign-and-verify pipeline in-process — no HTTP, no Stripe, no cloud-api required.
- How `AgentAgoraClient.callRich` returns the call result alongside the conversation id.
- How the SDK rejects a response signed by a key the registry does not vouch for, throwing a typed `AAPError(Unauthorized)`.

## Run

From the repo root:

```bash
pnpm install
pnpm --filter @agentagora/example-quickstart demo
```

You should see five labelled sections on stdout: identity, the successful call (with conversation id), and the signature-failure demo where the call is rejected with `Unauthorized`.

## What is intentionally missing

This file is a starting point, not a production template. There is no real HTTP listener, no on-disk audit log, no settlement channel, and no registry network call — every piece is in-memory so the example runs with no environment setup at all.

## Read next

- [`apps/examples/two-agents`](../two-agents) — the same shape, but Bob runs behind a real `@hono/node-server` listener and Alice calls him through `HttpTransport`. Adds an end-to-end audit-chain dump.
- [`apps/examples/worker-agent`](../worker-agent) — the same agent hosted on Cloudflare Workers via `agent.fetchHandler()`, runnable locally with `wrangler dev`.
- [`apps/docs/quickstart.md`](../../docs/quickstart.md) — the narrative walkthrough this example is referenced from, including the optional Stripe-priced step.
