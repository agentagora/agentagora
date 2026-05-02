# @agentagora/cloud-api

> AgentAgora Cloud Platform API. Hono on Cloudflare Workers.

The control-plane backend for the AgentAgora network: registry, identity issuance, settlement coordination, dispute intake, audit indexing. **Never on the agent-to-agent data path** — see [docs/tech-stack.md §5.2](../../../docs/tech-stack.md).

## v0.0.1 surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Service metadata |
| GET | `/healthz` | Liveness ping |
| POST | `/v1/agents` | Publish (or update) a manifest |
| GET | `/v1/agents` | List / search agents (`?capability=`, `?accepts=`, `?q=`) |
| GET | `/v1/agents/:aid` | Resolve one AID |

All requests/responses are JSON. Manifest validation uses the canonical Zod schemas from `@agentagora/protocol` — invalid bodies return `400` with biome-validator details.

## Dev

```bash
pnpm install
pnpm --filter @agentagora/cloud-api typecheck
pnpm --filter @agentagora/cloud-api test
pnpm --filter @agentagora/cloud-api dev   # local Worker on :8787
pnpm --filter @agentagora/cloud-api check # bundle dry-run
```

## Architecture

- **Hono** for routing (Workers-native)
- **`@hono/zod-validator`** for body/param validation
- **`Storage` interface** with `InMemoryStorage` default; `D1Storage` lands in Phase 3
- Same SDK-side bundle-budget rules apply: web standards only, no Node-specific imports

## What's NOT in v0.0.1

- **Persistent storage** — currently in-memory per Worker isolate. Cold starts wipe data. D1 binding lands in Phase 3.
- **Real identity issuance** — `identity_jwt` is a deterministic mock string. Real OIDC issuance with rotating signing keys lands in Phase 3.
- **Authentication** — anyone can publish to `/v1/agents`. Phase 3 adds owner-token auth.
- **Dispute / settlement / audit-ingest** endpoints — designed but not implemented; see top of `src/index.ts` for the planned routes.
- **Rate limiting / Sybil resistance** — Phase 3.

## Deploy (when ready)

```bash
wrangler login
pnpm --filter @agentagora/cloud-api deploy
```

The Worker has no bindings configured yet, so it will be a stateless registry. Add D1/R2/KV bindings to `wrangler.jsonc` before any production traffic.
