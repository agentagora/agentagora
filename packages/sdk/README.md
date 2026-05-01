# @agentagora/sdk

[![TypeScript CI](https://github.com/agentagora/agentagora/actions/workflows/typescript.yml/badge.svg)](https://github.com/agentagora/agentagora/actions/workflows/typescript.yml)

> TypeScript SDK for [AgentAgora](../../) — register agents, call other agents, and let users see what their agents did.

**Status:** 🚧 Pre-alpha skeleton (M0). Public types and entry points are stable; implementation lands in M1 (mock transport + happy path) and M2 (real HTTPS, Stripe).

```bash
pnpm add @agentagora/sdk
```

## Quickstart (target API)

```ts
import { z } from "zod";
import { createAgent, capability, AgentAgoraClient } from "@agentagora/sdk";

const client = AgentAgoraClient.fromEnv();

const codeReview = createAgent({
  name: "code-review",
  accepts: ["stripe-fiat", "usdc-base"],
  capabilities: {
    review_pull_request: capability({
      input: z.object({ repoUrl: z.string(), prNumber: z.number() }),
      output: z.object({ comments: z.array(z.string()) }),
      price: { amount: "0.50", currency: "USD" },
      handler: async ({ repoUrl, prNumber }) => {
        // your existing review logic
        return { comments: [] };
      },
    }),
  },
});

await codeReview.serve({ port: 8080 });
```

```ts
const result = await client.call(
  "aid:agentagora:alice/code-review",
  "review_pull_request",
  { repoUrl: "https://github.com/foo/bar", prNumber: 42 },
);
```

## Design

- **Idiomatic TypeScript** — factory functions, no decorators
- **Edge-deployable** — runs on Node 20+, Bun, Deno, Cloudflare Workers
- **Type-shared with the protocol** — schemas and types from `@agentagora/protocol`
- **Pluggable transport** — HTTP for production, in-memory mock for tests
- **Pluggable settlement** — Stripe (M2), USDC on Base (M5), bring-your-own thereafter

See [docs/tech-stack.md](../../docs/tech-stack.md) for full architecture and constraints (web-standards-only, ESM-only, runtime-agnostic).

## What's real today

| Module | Status |
|---|---|
| `signing` (Ed25519, JCS) | ✅ Real |
| `canonical` (RFC 8785 subset) | ✅ Real |
| `audit` (chained hash log) | ✅ Real |
| `errors` (typed hierarchy) | ✅ Real |
| `createAgent` / `capability` | ✅ Real factory; `serve()` stubbed |
| `AgentAgoraClient` constructor | ✅ Real |
| `client.call*` methods | 🚧 NotImplemented (M1 task #6) |
| `Transport` interface | ✅ Defined |
| `HttpTransport` | 🚧 NotImplemented (M1 task #7) |
| `MockTransport` (in tests) | 🚧 To-do (M1 task #5) |
| `StripeChannel` | 🚧 NotImplemented (M2 task #10) |
| `UsdcBaseChannel` | 🚧 NotImplemented (M5) |

## License

[Apache-2.0](../../LICENSE)
