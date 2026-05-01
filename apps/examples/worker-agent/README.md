# worker-agent — AgentAgora on Cloudflare Workers

The proof that `@agentagora/sdk` runs **unchanged** on edge runtimes — no Node-specific dependencies, no compatibility flags, no special build setup.

## Why this matters

[docs/tech-stack.md §8](../../../docs/tech-stack.md) declares as principle #1:

> If it doesn't run on Cloudflare Workers, it doesn't ship in the SDK core.

This example is the executable witness for that promise. The same `createAgent` / `agent.fetchHandler()` you use on Node powers the Worker code one-to-one.

## Build / verify

The cheapest check that the SDK actually bundles for Workers — runs the wrangler build pipeline without deploying anywhere:

```bash
pnpm --filter @agentagora/sdk build
pnpm --filter @agentagora/example-worker-agent check
```

If the build emits a bundle, the SDK is web-standards-clean.

## Local dev (no Cloudflare account needed)

```bash
pnpm --filter @agentagora/example-worker-agent dev
```

Wrangler will start a local Worker on `http://localhost:8787`. From another shell:

```bash
# Liveness ping
curl http://localhost:8787/

# Real AAP call (signed envelope; requires the SDK on the client side
# — easiest is to reuse apps/examples/two-agents and point its
# StaticEndpointResolver at http://localhost:8787)
```

## Deploy to Cloudflare (requires account)

One-time:

```bash
pnpm install -g wrangler   # or use pnpm --filter ... directly
wrangler login
```

Then:

```bash
pnpm --filter @agentagora/example-worker-agent deploy
```

The output URL is your Worker. It is now reachable globally with sub-50 ms cold starts.

## Configuration

Environment variables (set via `wrangler.jsonc` or `wrangler secret put` for secrets):

| Var                | Default | Purpose                                       |
| ------------------ | ------- | --------------------------------------------- |
| `AGENT_NAMESPACE`  | `demo`  | Namespace segment of the agent's AID          |
| `AGENT_NAME`       | `echo`  | Name segment of the agent's AID               |

For production, also bind a stable Ed25519 private key as a Wrangler secret instead of generating one per isolate (the demo's current approach is intentionally ephemeral so each cold start gets a fresh key).

## What this example intentionally does NOT do

- **Persist audit logs** — Workers have no filesystem. Production should write to KV, R2, or D1.
- **Hold a stable key across cold starts** — see "Configuration" above.
- **Discover other agents via the public registry** — uses InMemoryRegistry seeded with self only. Real registry lookups require the Cloud Platform (M2 task #11).

These are scoped out so the example stays a single 80-line file.
