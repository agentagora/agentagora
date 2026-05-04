# Deploying `@agentagora/cloud-api`

End-to-end deploy steps for the AgentAgora Cloud control-plane Worker. Run from the repo root unless noted.

> **Audience**: anyone provisioning a fresh Cloudflare account or rotating a deploy. For day-to-day code changes the only step that matters is `pnpm --filter @agentagora/cloud-api deploy`.

---

## 0. Prerequisites

- Cloudflare account with Workers + D1 enabled
- `wrangler` authenticated locally:
  ```bash
  pnpm --filter @agentagora/cloud-api exec wrangler login
  ```
- pnpm install completed at the repo root

---

## 1. Provision the D1 database (one-time)

> **First-run bootstrap (security-review-2026-05 §M1)**: a fresh checkout has no `apps/cloud/api/wrangler.jsonc` — the file is git-ignored to prevent shipping placeholder UUIDs to production. Copy the example and edit it:
>
> ```bash
> cp apps/cloud/api/wrangler.jsonc.example apps/cloud/api/wrangler.jsonc
> ```
>
> The example carries `REPLACE_BEFORE_DEPLOY` sentinels. Wrangler will refuse those at provisioning time, so the deploy fails fast instead of silently binding to placeholder resources.

```bash
pnpm --filter @agentagora/cloud-api exec wrangler d1 create agentagora-cloud
```

Wrangler prints a UUID. Paste it into `apps/cloud/api/wrangler.jsonc` at:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "agentagora-cloud",
    "database_id": "<paste UUID here>",
    "migrations_dir": "migrations"
  }
]
```

**Do not commit the change.** `apps/cloud/api/wrangler.jsonc` is git-ignored — the real D1 / KV IDs only ever live in your local checkout (and on Cloudflare). The committed template is `wrangler.jsonc.example`.

## 1b. Provision the KV namespaces (one-time)

```bash
pnpm --filter @agentagora/cloud-api exec wrangler kv namespace create NONCES
pnpm --filter @agentagora/cloud-api exec wrangler kv namespace create RATE_LIMITS
```

Wrangler prints an `id` for each. Paste them into `apps/cloud/api/wrangler.jsonc`:

```jsonc
"kv_namespaces": [
  { "binding": "NONCES",      "id": "<paste id here>" },
  { "binding": "RATE_LIMITS", "id": "<paste id here>" }
]
```

Without `NONCES`, `/v1/nonces/check` falls back to a per-isolate in-memory store. Without `RATE_LIMITS`, rate-limit counters are per-isolate (lossy across the fleet). Both fallbacks log a warning at boot. Fine for `wrangler dev`, not for production scale.

## 2. Apply migrations

```bash
# Local SQLite under .wrangler/state, used by `wrangler dev`:
pnpm --filter @agentagora/cloud-api exec wrangler d1 migrations apply DB --local

# Production:
pnpm --filter @agentagora/cloud-api exec wrangler d1 migrations apply DB --remote
```

Schema lives in `apps/cloud/api/migrations/`. Add new migrations as `000N_*.sql`; wrangler tracks applied versions in a metadata table.

## 3. Configure secrets

### `OWNER_TOKENS` (required)

Comma-separated owner credentials, format `<ownerId>:<token>,<ownerId>:<token>,...`. The Worker logs a warning at boot if this is unset, and every `POST /v1/agents` returns `401`.

```bash
pnpm --filter @agentagora/cloud-api exec wrangler secret put OWNER_TOKENS
# When prompted, paste e.g.:  alice:tok-A1,bob:tok-B2
```

Tokens should be high-entropy random strings (≥ 32 bytes, base64url). Rotate by replacing the secret; clients re-authenticate with the new token.

### `OIDC_SIGNING_KEY` and `OIDC_ISSUER` (required for real JWTs)

When both are set, `POST /v1/agents` returns a real EdDSA-signed JWT and `GET /.well-known/jwks.json` publishes the verifying public key. When either is missing, the Worker logs a warning and falls back to a deterministic mock string (development convenience only).

Generate a fresh Ed25519 private key and base64url-encode the raw 32 bytes:

```bash
node -e '
  const { randomBytes } = require("node:crypto");
  const k = randomBytes(32);
  process.stdout.write(k.toString("base64url") + "\n");
'
```

Set both secrets:

```bash
pnpm --filter @agentagora/cloud-api exec wrangler secret put OIDC_SIGNING_KEY
# Paste the base64url string from above.

pnpm --filter @agentagora/cloud-api exec wrangler secret put OIDC_ISSUER
# Paste the Worker's public URL, e.g.:  https://agentagora-cloud-api.example.workers.dev
```

The `kid` is derived deterministically from the public key (first 16 chars of SHA-256), so JWTs and JWKS always agree without an explicit kid registry. **Rotate** by generating a new key and replacing the secret — old JWTs become invalid at next verify and consumers must refetch JWKS.

### `STRIPE_SECRET_KEY` (required for /v1/connect/*)

Stripe API key used by the cloud-api to create Connect Express
accounts and onboarding links. Without it, `/v1/connect/*` returns
`503 not_configured`.

```bash
pnpm --filter @agentagora/cloud-api exec wrangler secret put STRIPE_SECRET_KEY
# Paste a sk_test_… key for staging or sk_live_… for production.
```

The cloud talks to Stripe via fetch (no `stripe-node` dep), so the
Worker bundle stays small. Store the live key in production only;
test keys are fine for `wrangler dev` and CI.

### `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (required for /v1/auth/github/*)

GitHub OAuth app credentials. When both are set (and `OIDC_SIGNING_KEY` is configured for state HMAC), the dashboard's "Sign in with GitHub" CTA works end-to-end. Without them, `/v1/auth/github/*` returns `503 not_configured` and the dashboard falls back to the closed-alpha bearer-paste sign-in.

Create an OAuth app at https://github.com/settings/developers ("New OAuth App"). Set the authorization callback URL to your dashboard's callback page, e.g. `https://dashboard.example.com/login/callback`.

```bash
pnpm --filter @agentagora/cloud-api exec wrangler secret put GITHUB_CLIENT_ID
# Paste the "Client ID" shown on the OAuth app page (Iv1.…).

pnpm --filter @agentagora/cloud-api exec wrangler secret put GITHUB_CLIENT_SECRET
# Paste a freshly generated client secret. Treat it like a database password:
# rotate by clicking "Generate a new client secret" and replacing the wrangler
# secret; existing OAuth-issued bearers stay valid (they're stored in
# oauth_sessions, not derived from the client secret).
```

Optional: set `GITHUB_REDIRECT_URI` if your callback URL differs from the OAuth app's default.

The state parameter passed back through GitHub is HMAC-signed with a key derived from `OIDC_SIGNING_KEY`. State has a 10-minute freshness window — leaked states past that age cannot complete a callback.

OAuth-issued bearers are 32 random bytes (base64url-encoded), persisted in the `oauth_sessions` D1 table for 30 days. They authenticate alongside `OWNER_TOKENS` bearers — both schemes coexist behind the same `OwnerAuthenticator` chain, so CI / integration test bearers (which run on raw `OWNER_TOKENS`) never break when OAuth is added.

To sweep expired sessions, call `Storage.deleteExpiredOauthSessions(now)` from a maintenance task; the index on `expires_at` makes this a fast prefix scan.

### `STRIPE_WEBHOOK_SECRET` (required for /v1/stripe/webhook)

The endpoint signing secret (`whsec_…`) printed when you create the
webhook in the Stripe dashboard. Without it, `/v1/stripe/webhook`
returns `503 not_configured`.

```bash
pnpm --filter @agentagora/cloud-api exec wrangler secret put STRIPE_WEBHOOK_SECRET
# Paste the whsec_… value from Stripe.
```

In the Stripe dashboard, point the webhook endpoint at
`https://<your-worker-url>/v1/stripe/webhook` and enable at least
`account.updated` (the only event the closed-alpha handler acts on
today; other events are ack'd as `200 ignored` so Stripe won't
retry).

---

## 4. Deploy

```bash
# Sanity check — typecheck, tests, bundle dry-run:
pnpm --filter @agentagora/cloud-api typecheck
pnpm --filter @agentagora/cloud-api test
pnpm --filter @agentagora/cloud-api check

# Ship it:
pnpm --filter @agentagora/cloud-api deploy
```

The deploy output prints the production URL (`https://agentagora-cloud-api.<account>.workers.dev` by default; override with `routes` in `wrangler.jsonc` once a custom domain is bound).

---

## 5. Smoke test

```bash
URL=https://agentagora-cloud-api.<account>.workers.dev
TOKEN=<one of the tokens you put in OWNER_TOKENS>

# Liveness:
curl "$URL/healthz"

# JWKS (consumers cache this to verify identity_jwt):
curl "$URL/.well-known/jwks.json"

# Discoverability (no auth):
curl "$URL/v1/agents"

# Audit chain for a conversation (public read):
curl "$URL/v1/conversations/<conversation_id>"

# Publish (requires OWNER_TOKENS + an Ed25519 signature over the
# RFC 8785 canonical bytes of the body):
curl -X POST "$URL/v1/agents" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-AAP-Pubkey: $PUBKEY_B64URL" \
  -H "X-AAP-Signature: $SIG_B64URL" \
  -H "Content-Type: application/json" \
  --data @example-manifest.json
```

Expected: `201` with `{ aid, identity_jwt, published_at, published_by, pubkey }`.

> Generating a signature by hand is fiddly — use the SDK's `signing` helpers (or any RFC 8785 canonicalizer + Ed25519 library). The publisher's public key is bound to the AID on first publish; subsequent updates must use the same key.

---

## 6. Rolling back

D1 migrations are forward-only (no built-in down migrations). To roll back a release:

1. `git revert` the offending Worker commit
2. `pnpm --filter @agentagora/cloud-api deploy` — code reverts immediately
3. Schema rollback (if needed) is a manual SQL operation; write a compensating `000N_revert_*.sql` and apply it

D1 keeps automatic backups; `wrangler d1 backup` can restore at the row level if a migration corrupts data. Always test migrations on `--local` first.

---

## 6b. Triaging Stripe failures (`request_id` correlation)

When `/v1/connect/*` returns `502 stripe_unavailable` or `/v1/stripe/webhook` returns `500 handler_failed`, the response body carries an opaque `request_id` (no Stripe-side trace data — security-review-2026-05 §L1). The verbose Stripe error is logged server-side. To triage:

```bash
# Tail Worker logs and grep by the request_id the client reported.
pnpm --filter @agentagora/cloud-api exec wrangler tail \
  --search "request_id=<paste id here>"
```

The matching `[connect] Stripe …` or `[stripe-webhook] handler failed …` log line carries the full Stripe error (status + body) for diagnosis.

---

## 7. Out of scope (still pending)

The current Worker covers registry + identity issuance + audit ingest + dispute intake + nonce dedup. Operationally still missing:
- R2 bucket for long-term audit cold-storage (D1 holds everything for now)
- Dispute resolution state machine + admin tooling (intake only today; ops writes resolutions directly)
- Stripe Connect onboarding endpoints (M2 Phase 4)
- Rate limiting / Sybil resistance (task #8)
- SDK opt-in for global nonce dedup (endpoint is live; SDK transport still uses per-isolate `NonceTracker`)

See `apps/cloud/api/README.md` for the per-task tracker.
