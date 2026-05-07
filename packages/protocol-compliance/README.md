# `@agentagora/protocol-compliance`

> Conformance test suite for the AgentAgora Protocol (AAP). Run it against any cloud-api candidate URL — the AgentAgora reference cloud, a self-host runtime, a third-party registry — and read a green/red report saying which spec requirements the candidate satisfies.

This package is **deliberately runtime-agnostic**: it does not import the cloud-api's source code, does not assume Cloudflare Workers / D1 / Stripe, and has no opinion on what storage or settlement layer the candidate uses. It only knows the wire shapes from `@agentagora/protocol` and the HTTP contract the AAP spec defines.

Status: **Tier 1 (read-path public surface) + Tier 2 (auth read paths) + Tier 3 (mutation contracts).** Phase 3 (RFC-style spec hardening + traceability matrix) follows — see [`docs/m4-plan.md`](../../docs/m4-plan.md).

## "AgentAgora-compatible" badge

Per maintainer decision F.2 ([`docs/maintainer-tasks.md`](../../docs/maintainer-tasks.md)):

> **Passing Tier 1 + Tier 2 earns the public "AgentAgora-compatible" badge.**
>
> Passing Tier 3 additionally earns "registered peer registry" status (relevant once federation goes live in M10+).

Badge wording: *"This service implements AgentAgora Protocol v0.x — Tier 1 (public surface) + Tier 2 (auth)."*

## Quick start

```bash
# 1. Have a cloud-api candidate running somewhere
#    (the reference impl: `pnpm --filter @agentagora/cloud-api dev` in another terminal)

# 2a. Point the suite at it (Tier 1 only — public surface, no auth)
AAP_BASE_URL=http://localhost:8787 \
  pnpm --filter @agentagora/protocol-compliance test

# 2b. Or run Tier 1 + Tier 2 (authenticated reads)
AAP_BASE_URL=http://localhost:8787 \
AAP_TEST_BEARER=<your-test-bearer> \
AAP_TEST_OWNER_ID=<owner-id-the-bearer-resolves-to> \
AAP_TEST_OWNED_AID=aid:agentagora:<owner>/<name> \
  pnpm --filter @agentagora/protocol-compliance test

# 3. Read the report
#    Each test names the spec section it enforces and what level
#    (MUST / SHOULD / MAY) the requirement is.
```

The default `AAP_BASE_URL` is `http://localhost:8787` (i.e., a local `wrangler dev`). Set it explicitly to test against:

- A deployed reference cloud (e.g., `https://agentagora-cloud-api.workers.dev`)
- A self-host runtime (e.g., `https://my-cloud.example.com`)
- A third-party registry (e.g., `https://aap.example.org`)

## What's tested today

### Tier 1 — public read paths (no auth, safe against production)

| File | Spec requirement |
|---|---|
| `tests/tier1-liveness.test.ts` (4 tests) | `GET /healthz` 200, JWKS publish, JWK shape (Ed25519, kid+x), CORS |
| `tests/tier1-registry.test.ts` (6 tests) | `GET /v1/agents` shape, `GET /v1/agents/:aid` 200/404, URL-decode |
| `tests/tier1-error-envelope.test.ts` (5 tests) | `{ error: snake_case, message?, request_id? }` shape |

Tier 1 makes no destructive writes; safe to run against a production candidate.

### Tier 2 — authenticated read paths (require `AAP_TEST_BEARER`)

| File | Spec requirement |
|---|---|
| `tests/tier2-auth.test.ts` (~12 tests) | `?owner=`, `?actor=`, `?filer=` ownership scoping; 401 on missing/invalid bearer; 403 on cross-owner; `/v1/connect/account` auth |

Tier 2 makes no destructive writes either, but requires a test bearer that the candidate accepts. Some sub-tests additionally need `AAP_TEST_OWNER_ID` and/or `AAP_TEST_OWNED_AID` — those tests skip individually when those env vars are empty, so a partial run still produces useful signal.

### Tier 3 — mutation contracts (sandbox-only)

| File | Spec requirement |
|---|---|
| `tests/tier3-publish.test.ts` (5 tests) | `POST /v1/agents` auth + signature header contract; published-AID round-trip via fixtures |
| `tests/tier3-mutation-auth.test.ts` (9 tests) | `POST /v1/audit/ingest` body shape + empty-batch; `POST /v1/disputes` auth; `POST /v1/nonces/check` auth + replay protection (200 first / 409 conflict) |

Tier 3 makes destructive writes against the candidate's storage. Run only against a sandbox / dev candidate, never production. Some tests need fixtures from the provisioner — see "Provisioning fixtures" below.

### Provisioning fixtures (Tier 3)

Per F.3 decision, the suite uses a **CLI provisioner** as the primary path:

```bash
# 1. Have a sandbox cloud-api running with an OWNER_TOKENS env var set,
#    e.g. via wrangler dev --var OWNER_TOKENS:owner1:bearer-token-here

# 2. Provision fixtures (publishes a fresh manifest, saves keypair)
pnpm --filter @agentagora/protocol-compliance compliance:setup -- \
  --setup \
  --base-url=http://localhost:8788 \
  --bearer=bearer-token-here

# Output:
#   ✓ Published manifest: aid:agentagora:compliance-suite/tier3-fixture
#   ✓ fixtures saved to node_modules/.cache/protocol-compliance/fixtures.json

# 3. Run the suite — fixture-gated tests now activate
AAP_BASE_URL=http://localhost:8788 \
AAP_TEST_BEARER=bearer-token-here \
  pnpm --filter @agentagora/protocol-compliance test
```

Fallback for impls that don't yet support full publish flow:

```bash
# Hand-craft fixtures.json matching the Fixtures shape in src/setup.ts,
# then copy it into the cache slot:
pnpm --filter @agentagora/protocol-compliance compliance:setup -- \
  --seed-file=path/to/your/fixtures.json
```

Those impls run only Tier 1 + 2 toward the badge.

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
