# @agentagora/cloud-api

> AgentAgora Cloud Platform API. Hono on Cloudflare Workers.

The control-plane backend for the AgentAgora network: registry, identity issuance, settlement coordination, dispute intake, audit indexing. **Never on the agent-to-agent data path** — see [docs/tech-stack.md §5.2](../../../docs/tech-stack.md).

## Surface

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
- **`Storage` interface** — `D1Storage` (production) or `InMemoryStorage` (no binding / unit tests)
- Same SDK-side bundle-budget rules apply: web standards only, no Node-specific imports

## D1 setup (one-time, before first deploy)

```bash
# Provision the production database; paste the printed UUID into
# wrangler.jsonc → d1_databases[0].database_id.
pnpm --filter @agentagora/cloud-api exec wrangler d1 create agentagora-cloud

# Apply migrations.
pnpm --filter @agentagora/cloud-api exec wrangler d1 migrations apply DB --local   # for `wrangler dev`
pnpm --filter @agentagora/cloud-api exec wrangler d1 migrations apply DB --remote  # for production
```

Schema lives in `migrations/`. Add new migrations as `migrations/000N_*.sql`; wrangler tracks applied versions in a metadata table.

## What's NOT in v0.0.2

- **Real identity issuance** — `identity_jwt` is a deterministic mock string. Real OIDC issuance with rotating signing keys is task #4.
- **Authentication** — anyone can publish to `/v1/agents`. Owner-token auth is task #2.
- **Manifest signature verification** — task #3.
- **Dispute / settlement / audit-ingest** endpoints — designed but not implemented; see top of `src/index.ts` for the planned routes.
- **Rate limiting / Sybil resistance** — Phase 3.

## Deploy

```bash
wrangler login
pnpm --filter @agentagora/cloud-api deploy
```

Add R2 / KV bindings + secrets (`STRIPE_SECRET_KEY`, `OIDC_JWT_SIGNING_KEY`) to `wrangler.jsonc` before opening to public traffic.
