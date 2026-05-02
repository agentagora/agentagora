# @agentagora/cloud-api

> AgentAgora Cloud Platform API. Hono on Cloudflare Workers.

The control-plane backend for the AgentAgora network: registry, identity issuance, settlement coordination, dispute intake, audit indexing. **Never on the agent-to-agent data path** — see [docs/tech-stack.md §5.2](../../../docs/tech-stack.md).

## Surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/` | – | Service metadata |
| GET | `/healthz` | – | Liveness ping |
| GET | `/.well-known/jwks.json` | – | Active OIDC public keys (`503` until `OIDC_SIGNING_KEY` is set) |
| POST | `/v1/agents` | Bearer + sig | Publish (or update) a manifest |
| GET | `/v1/agents` | – | List / search agents (`?capability=`, `?accepts=`, `?q=`) |
| GET | `/v1/agents/:aid` | – | Resolve one AID |

All requests/responses are JSON. Manifest validation uses the canonical Zod schemas from `@agentagora/protocol` — invalid bodies return `400` with the Zod issues array.

## Auth (closed alpha)

`POST /v1/agents` requires three things per request:

1. `Authorization: Bearer <token>` — resolved against `OWNER_TOKENS`, format `<ownerId>:<token>,<ownerId>:<token>,...`
2. `X-AAP-Pubkey: <base64url>` — the publisher's 32-byte Ed25519 public key
3. `X-AAP-Signature: <base64url>` — Ed25519 signature over the RFC 8785 (JCS) canonical bytes of the JSON body

Three rejection paths:

| Failure | Status |
|---|---|
| Missing/invalid bearer | `401 unauthorized` |
| Pubkey/signature header missing or malformed | `400 missing_signature` / `400 malformed_signature` |
| Signature does not verify | `401 unauthorized` |
| Bearer is valid but a different owner already published this AID | `403 forbidden` |
| Same owner re-publishes with a different signing key (TOFU pin) | `403 forbidden` |

The pubkey is bound to the AID on first publish; subsequent updates must produce a signature that verifies against the same key. This is defence in depth: even if a bearer token leaks, the attacker also needs the private signing key.

Real OIDC issuance (task #4) replaces the bearer scheme without changing the route shape.

```bash
pnpm --filter @agentagora/cloud-api exec wrangler secret put OWNER_TOKENS
```

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

## Deploy

End-to-end provisioning (D1, secrets, smoke test, rollback) lives in [DEPLOY.md](./DEPLOY.md). Day-to-day:

```bash
pnpm --filter @agentagora/cloud-api deploy
```

## What's NOT in v0.0.2

- **Dispute / settlement / audit-ingest** endpoints — designed but not implemented; see top of `src/index.ts` for the planned routes.
- **Rate limiting / Sybil resistance** — Phase 3.
- **JWT key rotation** — single active kid; multi-kid rotation comes when KV-backed key store lands.
