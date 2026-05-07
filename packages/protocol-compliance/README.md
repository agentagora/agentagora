# `@agentagora/protocol-compliance`

> Conformance test suite for the AgentAgora Protocol (AAP). Run it against any cloud-api candidate URL — the AgentAgora reference cloud, a self-host runtime, a third-party registry — and read a green/red report saying which spec requirements the candidate satisfies.

This package is **deliberately runtime-agnostic**: it does not import the cloud-api's source code, does not assume Cloudflare Workers / D1 / Stripe, and has no opinion on what storage or settlement layer the candidate uses. It only knows the wire shapes from `@agentagora/protocol` and the HTTP contract the AAP spec defines.

Status: **Tier 1 (read-path public surface).** Tier 2 (auth) and Tier 3 (mutation) ship in later phases — see [`docs/m4-plan.md`](../../docs/m4-plan.md).

## Quick start

```bash
# 1. Have a cloud-api candidate running somewhere
#    (the reference impl: `pnpm --filter @agentagora/cloud-api dev` in another terminal)

# 2. Point the suite at it
AAP_BASE_URL=http://localhost:8787 \
  pnpm --filter @agentagora/protocol-compliance test

# 3. Read the report
#    Each test names the spec section it enforces and what level
#    (MUST / SHOULD / MAY) the requirement is.
```

The default `AAP_BASE_URL` is `http://localhost:8787` (i.e., a local `wrangler dev`). Set it explicitly to test against:

- A deployed reference cloud (e.g., `https://agentagora-cloud-api.workers.dev`)
- A self-host runtime (e.g., `https://my-cloud.example.com`)
- A third-party registry (e.g., `https://aap.example.org`)

## What's tested today (Tier 1)

| Section | Test file | Spec requirement |
|---|---|---|
| Liveness | `tests/tier1-liveness.test.ts` | `GET /healthz` 200, JWKS publish, JWK shape (Ed25519, kid+x) |
| Registry | `tests/tier1-registry.test.ts` | `GET /v1/agents` shape, `GET /v1/agents/:aid` 200/404 |
| Errors | `tests/tier1-error-envelope.test.ts` | `{ error: snake_case, message?, request_id? }` envelope |

Tier 1 tests:
- Use no bearer-token auth
- Make no destructive writes
- Are safe to run against a production candidate

## Tier 2 / 3 (coming in M4 Phase 2)

Tier 2 — authenticated read paths (require `AAP_TEST_BEARER`):

- `GET /v1/agents?owner=` ownership scoping
- `GET /v1/conversations/:id` audit chain
- `GET /v1/disputes?filer=`
- `GET /v1/connect/account`

Tier 3 — mutation paths (require `AAP_TEST_BEARER` + sandbox):

- `POST /v1/agents` (manifest publish + Ed25519 verify)
- `POST /v1/audit/ingest` (chain integrity)
- `POST /v1/disputes`
- `POST /v1/nonces/check`

Tier 3 fixture-setup approach is a maintainer decision — see `docs/maintainer-tasks.md` §F.3.

## How a third-party impl uses this

1. `git clone` the AgentAgora repo (Apache-2.0).
2. `pnpm install`.
3. Stand up your candidate cloud at any URL.
4. `AAP_BASE_URL=https://your-cloud/ pnpm --filter @agentagora/protocol-compliance test`.
5. Fix the failures. Each test name + comment tells you exactly which spec section + AAP-spec.md MUST/SHOULD it enforces.

The "AgentAgora-compatible" badge level (Tier-1-only / Tier-1+2 / all-three) is a maintainer decision — see [`docs/maintainer-tasks.md`](../../docs/maintainer-tasks.md) §F.2.

## What this package is NOT

- **Not the SDK.** That's `@agentagora/sdk` (TypeScript) and `sdk/python/` (forthcoming).
- **Not the protocol types.** Those live in `@agentagora/protocol` (Zod schemas + JSON Schema export).
- **Not the cloud impl.** That's `apps/cloud/api/`. Don't read this package as "what cloud-api does"; read it as "what the spec demands of any cloud-api candidate."

## Stewardship

This package follows the same boundary-discipline as `@agentagora/protocol` — it MUST NOT depend on `apps/cloud/**` or any AgentAgora cloud-specific runtime. Verifies via the `@agentagora/protocol` boundary test (this package only depends on it, not the other way around). When the protocol repo eventually splits out (see [`docs/protocol-stewardship.md`](../../docs/protocol-stewardship.md)), this package goes with it.

## License

Apache-2.0.
