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
| POST | `/v1/audit/ingest` | Per-event sig | Batch-ingest signed audit events |
| GET | `/v1/conversations/:id` | – | Read the audit chain for a conversation |
| POST | `/v1/disputes` | Bearer | File a dispute case |
| GET | `/v1/disputes/:id` | – | Read a case file by opaque ID |
| POST | `/v1/nonces/check` | Bearer | Reserve a nonce (200 first-seen / 409 replay) |
| POST | `/v1/connect/onboarding` | Bearer | Start (or refresh) Stripe Connect Express onboarding |
| GET | `/v1/connect/account` | Bearer | Read the caller's Connect account status |
| GET | `/v1/connect/accounts/:aid` | – | Public destination-account lookup for an AID (404 until onboarding completes) |
| POST | `/v1/stripe/webhook` | Stripe-Signature | Stripe → cloud event ingestion (HMAC-SHA256) |

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
- **Zod schemas from `@agentagora/protocol`** for body/param validation (parse-at-the-route-handler pattern)
- **`Storage` interface** — `D1Storage` (production) or `InMemoryStorage` (no binding / unit tests)
- Same SDK-side bundle-budget rules apply: web standards only, no Node-specific imports

## Deploy

End-to-end provisioning (D1, secrets, smoke test, rollback) lives in [DEPLOY.md](./DEPLOY.md). Steady-state ops + incident response (migrations, secret rotations, D1 backup drills) lives in [RUNBOOK.md](./RUNBOOK.md). Day-to-day:

```bash
pnpm --filter @agentagora/cloud-api deploy
```

## Audit ingest

`POST /v1/audit/ingest` accepts a batch of signed audit events:

```json
{ "events": [ { "event_id": "...", "conversation_id": "...", ... } ] }
```

There is no bearer token — each event's Ed25519 signature is the auth, verified against the actor's pinned manifest pubkey. Batches return `201` when every event lands, `207 Multi-Status` when some are rejected:

```json
{
  "ingested": ["evt-0001", "evt-0003"],
  "rejected": [
    { "event_id": "evt-0002", "error": "broken_chain", "message": "..." }
  ]
}
```

Reject codes: `validation_error`, `unknown_actor`, `actor_unsigned`, `invalid_signature`, `broken_chain`, `duplicate_event`. Re-ingest is idempotent (duplicates are reported, not poisoned).

`GET /v1/conversations/:id` returns the chain in timestamp order. Public — disputes / inspectors fetch without coordinating credentials.

## Disputes

`POST /v1/disputes` (Bearer-authenticated) files a case file:

```json
{
  "conversation_id": "convo-...",
  "filer_aid": "aid:...",          // must be owned by the bearer's owner
  "respondent_aid": "aid:...",     // must be a registered AID
  "reason": "non_delivery" | "wrong_output" | "fraud" | "other",
  "narrative": "free text, ≤ 8KiB",
  "claimed_remedy": "refund | rework | …, ≤ 256 chars"
}
```

Response is the case file with a server-assigned opaque `dispute_id`. The conversation must already have at least one ingested audit event — preventing dispute filings against ghost conversations.

Per [PRD §16](../../../docs/PRD.md), M2 closed alpha uses team adjudication: the route captures the case file; ops resolves out-of-band by writing back `state` / `resolution` directly. Council voting and a state-machine API land in a later phase.

`GET /v1/disputes/:id` is **not** bearer-gated — IDs are unguessable random tokens, and public case files seed the public-precedent library called out in the PRD.

## Auto-refund

Per [PRD §9.3 #3](../../../docs/PRD.md), failed paid calls refund automatically — no human in the loop. Two halves cooperate:

1. **SDK side** (`@agentagora/sdk`): when `client.call()` throws after escrow has funded (transport failure, signature mismatch, RPC error, etc.), the SDK invokes `channel.refund(escrow)` before the call promise rejects. The thrown `CallRefundedError` carries `refundTxId` so the caller can prove they were made whole without inspecting audit logs.
2. **Cloud side**: the Stripe webhook listens for `charge.refunded` on charges carrying `aap_conversation_id` metadata and writes one row into the `refunds` table per refund. Schema in `migrations/0006_refunds.sql`:

   | column | type | notes |
   |---|---|---|
   | `refund_id` | TEXT (PK) | Stripe `re_…` |
   | `conversation_id` | TEXT | from charge metadata |
   | `amount` | TEXT | decimal string |
   | `currency` | TEXT | ISO 4217 |
   | `refunded_at` | TEXT | ISO 8601 |
   | `reason` | TEXT (nullable) | e.g. `requested_by_customer` |

The dispute pipeline closes the loop:

- A dispute filed against a conversation that **already** has a refund record auto-resolves to `state=resolved`, `resolution=auto_refunded`.
- A dispute filed **before** the refund event → the webhook handler retroactively resolves any open dispute on the conversation when the refund lands. Re-deliveries are no-ops thanks to `INSERT OR IGNORE` on `refund_id` and the `WHERE state='open'` guard on `resolveDispute`.

## Global nonce dedup

`POST /v1/nonces/check` lets receivers detect replays across Worker isolates and cold restarts — the SDK's in-process `NonceTracker` only covers a single isolate.

```json
{ "key": "<convo:from:nonce>", "ttl_seconds": 600 }
```

- `200 { first_seen: true,  expires_at }` — first sighting; the key is reserved
- `409 { first_seen: false, expires_at }` — replay; the call should be rejected
- Bearer-authed; the resolved owner ID prefixes every key under the hood, so tenants can't poison each other's nonce namespace

Backed by Workers KV in production (native TTL); falls back to in-memory in tests / `wrangler dev`. KV's get-then-put has a microsecond race window — a Durable Object or D1 PRIMARY KEY can replace the implementation later without changing the route shape.

> SDK opt-in (a `CloudNonceTracker` that consults this endpoint before honoring incoming envelopes) is a follow-up — agents that want global dedup will wire it through `AgentOptions.nonceTracker`.

## Rate limiting

Bearer-authed write endpoints enforce a fixed-window per-minute cap, scoped per owner:

| Route | Cap (req/min/owner) |
|---|---|
| `POST /v1/agents` | 30 |
| `POST /v1/disputes` | 5 |
| `POST /v1/nonces/check` | 6 000 |

Audit ingest is intentionally not rate-limited — every event already carries a signature and chain-hash check, which is the cost gate. Exhausted buckets return `429 rate_limited` with a `Retry-After` header counting seconds to the next minute boundary.

Backed by Workers KV in production (cross-isolate counters with native TTL); falls back to a per-isolate `Map` for tests / dev. Document race-acceptable: a coordinated burst at the second-edge can over-count by a handful of requests, irrelevant for abuse-prevention.

## What's NOT in v0.0.2

- **Dispute resolution state machine** — task #6 captures intake only; ops writes the resolution.
- **SDK-side opt-in for cloud nonce dedup** — endpoint is live; SDK still uses per-isolate `NonceTracker` until a `CloudNonceTracker` is wired in.
- **JWT key rotation** — single active kid; multi-kid rotation comes when KV-backed key store lands.
